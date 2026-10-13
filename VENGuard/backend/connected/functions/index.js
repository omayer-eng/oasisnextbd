/**
 * VenGuard Connected — cloud backend (Firebase, Node 20).
 *
 * Safety principles (VenGuard HCD v4):
 *  - The cloud is never part of the safety loop. Devices detect and close on their own, offline.
 *  - Remote commands are CLOSE ONLY. There is no "open" command anywhere in this system, and the
 *    firmware must reject anything else. Gas is reopened only by the lever at the stove.
 *  - The app shows "closed" only when the device confirms it (ack or reported valve state).
 *
 * Channels
 *  - Device ↔ cloud: Firebase Realtime Database (RTDB). The device holds one streaming connection,
 *    listens for close commands at /devices/{id}/cmd (delivered within seconds), writes its state only
 *    when it changes, and a heartbeat once a minute. No polling, so the cost per device stays low.
 *  - App ↔ cloud: Cloud Firestore (read-only for customers) + the callable functions below.
 *
 * Contract for firmware: ../DEVICE_API.md. Setup and costs: ../README.md.
 */
"use strict";

const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onValueWritten, onValueCreated } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const crypto = require("crypto");
const K = require("./device-keys");

// In the local emulator, use the same database namespace the rules are loaded into. Production uses the project's default instance.
admin.initializeApp(process.env.FUNCTIONS_EMULATOR === "true" && process.env.FIREBASE_DATABASE_EMULATOR_HOST
  ? { databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${process.env.GCLOUD_PROJECT}-default-rtdb` } : undefined);
const db = admin.firestore();
const rtdb = admin.database();
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

const REGION = "asia-southeast1"; // Singapore: closest region offering both Realtime Database and Functions
// Database triggers must run in the database's region: Singapore in production; the local emulator only fires us-central1.
const RTDB_REGION = process.env.FUNCTIONS_EMULATOR === "true" ? "us-central1" : REGION;
setGlobalOptions({ region: REGION, maxInstances: 20 });

const DEVICE_MASTER_KEY = defineSecret("DEVICE_MASTER_KEY");
const SMS_API_URL = defineSecret("SMS_API_URL");
const SMS_API_KEY = defineSecret("SMS_API_KEY");
const SMS_SENDER_ID = defineSecret("SMS_SENDER_ID");
const SSLC_STORE_ID = defineSecret("SSLC_STORE_ID");
const SSLC_STORE_PASSWORD = defineSecret("SSLC_STORE_PASSWORD");
const SMS = [SMS_API_URL, SMS_API_KEY, SMS_SENDER_ID];

const OFFLINE_AFTER_MS = 3 * 60e3;   // no heartbeat for 3 min = offline
const COMMAND_TTL_MS = 30 * 60e3;    // a queued close expires after 30 min
const PLAN_PRICE_BDT = 550;
const SIG_WINDOW_MS = 5 * 60e3;

/* ===========================================================================
 * 1. Device sign-in  —  POST /deviceToken
 *    Body: {"id":"VG-0001A3","ts":<unix ms>}   Header X-VG-Signature: hex HMAC(deviceSecret, rawBody)
 *    Returns a Firebase custom token for uid "dev_<id>". The device exchanges it for an ID token
 *    (and refresh token) with the standard Firebase Auth REST API, then talks to RTDB directly.
 * ========================================================================= */
exports.deviceToken = onRequest({ secrets: [DEVICE_MASTER_KEY], cors: false }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  let body;
  try { body = JSON.parse(req.rawBody.toString("utf8")); } catch (e) { return res.status(400).json({ ok: false }); }
  const id = String(body.id || "");
  const sig = Buffer.from(String(req.get("X-VG-Signature") || ""), "hex");
  if (!K.DEVICE_ID.test(id) || Math.abs(Date.now() - Number(body.ts)) > SIG_WINDOW_MS) return res.status(401).json({ ok: false });
  const expected = K.hmac(K.deviceSecret(DEVICE_MASTER_KEY.value(), id), req.rawBody.toString("utf8"));
  if (!K.safeEqual(sig, expected)) return res.status(401).json({ ok: false });
  const token = await admin.auth().createCustomToken(K.deviceUid(id), { device: true, deviceId: id });
  res.json({ ok: true, token });
});

/* ===========================================================================
 * 2. Device → cloud mirrors (RTDB triggers)
 * ========================================================================= */

/** State changed on the device (the device writes only on change). */
exports.onDeviceState = onValueWritten({ ref: "/devices/{id}/state", secrets: SMS, region: RTDB_REGION }, async (ev) => {
  const id = ev.params.id;
  if (!K.DEVICE_ID.test(id) || !ev.data.after.exists()) return;
  const st = K.sanitizeState(ev.data.after.val() || {});
  const before = ev.data.before.exists() ? K.sanitizeState(ev.data.before.val() || {}) : null;
  const dref = db.collection("devices").doc(id);
  const dev = await dref.get();
  await dref.set({ state: st, online: true, lastSeen: Timestamp.now() }, { merge: true });
  const siteId = dev.exists && dev.data().siteId;
  if (!siteId) return;
  if (st.alarm && !(before && before.alarm)) {
    await addEvent(siteId, id, "leak");
    await alertSite(siteId, id, "leak");
  }
  if (before && before.valve === "closed" && st.valve === "open" && !st.alarm) await addEvent(siteId, id, "reset");
  // A closed valve also settles any close command still waiting for an ack.
  if (st.valve === "closed") await settleCommands(id, "closed");
});

/** Events the device pushes: test, battery_low, tamper (leak and reset come from state). */
exports.onDeviceEvent = onValueCreated({ ref: "/devices/{id}/events/{eid}", secrets: SMS, region: RTDB_REGION }, async (ev) => {
  const id = ev.params.id;
  const e = ev.data.val() || {};
  const type = ({ test: "test", battery_low: "batt", tamper: "tamper" })[e.type];
  await rtdb.ref(`/devices/${id}/events/${ev.params.eid}`).remove(); // keep RTDB small; Firestore keeps the history
  const dev = await db.collection("devices").doc(id).get();
  if (!type || !dev.exists || !dev.data().siteId) return;
  await addEvent(dev.data().siteId, id, type, type === "batt" ? { n: K.clampInt(e.level, 0, 100) } : {});
  if (type === "batt") await alertSite(dev.data().siteId, id, "batt");
});

/** The device acknowledges a close command (only after the valve confirms). */
exports.onDeviceAck = onValueCreated({ ref: "/devices/{id}/ack/{cid}", region: RTDB_REGION }, async (ev) => {
  const { id, cid } = ev.params;
  const a = ev.data.val() || {};
  const cref = db.collection("devices").doc(id).collection("commands").doc(cid);
  const c = await cref.get();
  await Promise.all([rtdb.ref(`/devices/${id}/ack/${cid}`).remove(), rtdb.ref(`/devices/${id}/cmd/${cid}`).remove()]);
  if (!c.exists || c.data().status === "done") return;
  const ok = a.result === "closed" || a.result === "already_closed";
  await cref.update({ status: ok ? "done" : "failed", result: String(a.result || "").slice(0, 32), ackAt: Timestamp.now() });
  const dev = await db.collection("devices").doc(id).get();
  if (ok && dev.exists && dev.data().siteId) await addEvent(dev.data().siteId, id, "remote_close", { who: c.data().requestedByName || "" });
});

async function settleCommands(id, result) {
  const open = await db.collection("devices").doc(id).collection("commands").where("status", "==", "delivered").get();
  for (const c of open.docs) {
    await c.ref.update({ status: "done", result, ackAt: Timestamp.now() });
    await rtdb.ref(`/devices/${id}/cmd/${c.id}`).remove();
    const dev = await db.collection("devices").doc(id).get();
    if (dev.exists && dev.data().siteId) await addEvent(dev.data().siteId, id, "remote_close", { who: c.data().requestedByName || "" });
  }
}

/* ===========================================================================
 * 3. Remote close (app)  —  callable requestClose({ deviceId })
 * ========================================================================= */
exports.requestClose = onCall(async (req) => {
  const uid = requireAuth(req);
  const deviceId = String(req.data && req.data.deviceId || "");
  if (!K.DEVICE_ID.test(deviceId)) throw new HttpsError("not-found", "Device not found.");
  const dref = db.collection("devices").doc(deviceId);
  const dev = await dref.get();
  if (!dev.exists || !(dev.data().memberUids || []).includes(uid)) throw new HttpsError("not-found", "Device not found.");
  const site = await db.collection("sites").doc(dev.data().siteId).get();
  if (!planActive(site.data())) throw new HttpsError("failed-precondition", "Remote close is part of the Connected plan.");

  // Rate limit: 5 close requests per person per 10 minutes.
  const recent = await dref.collection("commands").where("requestedBy", "==", uid)
    .where("requestedAt", ">", Timestamp.fromMillis(Date.now() - 10 * 60e3)).count().get();
  if (recent.data().count >= 5) throw new HttpsError("resource-exhausted", "Too many requests. Wait a few minutes.");

  const user = await db.collection("users").doc(uid).get();
  const expiresAt = Date.now() + COMMAND_TTL_MS;
  const cref = await dref.collection("commands").add({
    type: "close", status: "delivered",
    requestedBy: uid, requestedByName: (user.exists && user.data().name) || maskPhone(req.auth.token.phone_number),
    requestedAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(expiresAt)
  });
  // The device listens here: it acts within seconds if online, or when it reconnects (until expiry).
  await rtdb.ref(`/devices/${deviceId}/cmd/${cref.id}`).set({ type: "close", exp: expiresAt });
  logger.info("close requested", { deviceId, uid, commandId: cref.id });
  return { commandId: cref.id };
});

/* ===========================================================================
 * 4. Pairing  —  callable claimDevice({ deviceId, claimCode, siteName? })
 * ========================================================================= */
exports.claimDevice = onCall({ secrets: [DEVICE_MASTER_KEY] }, async (req) => {
  const uid = requireAuth(req);
  const deviceId = String(req.data.deviceId || "").toUpperCase();
  const code = String(req.data.claimCode || "").replace(/\D/g, "");
  if (!K.DEVICE_ID.test(deviceId) || !K.safeEqual(Buffer.from(code), Buffer.from(K.claimCode(DEVICE_MASTER_KEY.value(), deviceId)))) {
    throw new HttpsError("invalid-argument", "The device ID or code is not right. Check the sticker on the valve.");
  }
  return db.runTransaction(async (tx) => {
    const dref = db.collection("devices").doc(deviceId);
    const dev = await tx.get(dref);
    const owned = await tx.get(db.collection("sites").where("ownerUid", "==", uid).limit(1));
    if (dev.exists && dev.data().siteId) throw new HttpsError("already-exists", "This VenGuard is already on an account. Contact VenGuard support to move it.");
    let siteRef, members = [uid];
    if (!owned.empty && !req.data.siteName) { siteRef = owned.docs[0].ref; members = owned.docs[0].data().memberUids; }
    else {
      siteRef = db.collection("sites").doc();
      tx.set(siteRef, {
        name: String(req.data.siteName || "Home").slice(0, 60), type: "home", ownerUid: uid, memberUids: [uid],
        contacts: [], plan: { expiresAt: Timestamp.fromMillis(0) }, createdAt: FieldValue.serverTimestamp()
      });
    }
    tx.set(dref, { siteId: siteRef.id, memberUids: members, label: "Kitchen", online: false, pairedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { siteId: siteRef.id };
  });
});

/* ===========================================================================
 * 5. Family alert contacts  —  callable saveContacts({ siteId, contacts })
 * ========================================================================= */
exports.saveContacts = onCall(async (req) => {
  const uid = requireAuth(req);
  const sref = db.collection("sites").doc(String(req.data.siteId || "x"));
  const site = await sref.get();
  if (!site.exists || !site.data().memberUids.includes(uid)) throw new HttpsError("not-found", "Not found.");
  const list = (Array.isArray(req.data.contacts) ? req.data.contacts : []).slice(0, 3).map((c) => {
    const phone = K.normPhone(c.phone);
    if (!phone) throw new HttpsError("invalid-argument", "Enter valid Bangladesh mobile numbers.");
    return { name: String(c.name || "").slice(0, 40), phone, sms: c.sms !== false };
  });
  await sref.update({ contacts: list });
  return { ok: true };
});

/* ===========================================================================
 * 6. Connected plan renewal via SSLCommerz (bKash, Nagad, cards)
 * ========================================================================= */
exports.startRenewal = onCall({ secrets: [SSLC_STORE_ID, SSLC_STORE_PASSWORD] }, async (req) => {
  const uid = requireAuth(req);
  const siteId = String(req.data.siteId || "x");
  const site = await db.collection("sites").doc(siteId).get();
  if (!site.exists || !site.data().memberUids.includes(uid)) throw new HttpsError("not-found", "Not found.");
  const tran = "VGC-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
  await db.collection("payments").doc(tran).set({ siteId, uid, amount: PLAN_PRICE_BDT, status: "started", createdAt: FieldValue.serverTimestamp() });
  const appUrl = process.env.APP_URL || "https://oasisnextbd.github.io/OASIS_official_website/VENGuard/app/";
  const form = new URLSearchParams({
    store_id: SSLC_STORE_ID.value(), store_passwd: SSLC_STORE_PASSWORD.value(), total_amount: String(PLAN_PRICE_BDT), currency: "BDT",
    tran_id: tran, success_url: appUrl, fail_url: appUrl, cancel_url: appUrl,
    ipn_url: `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/sslcIpn`,
    cus_name: "VenGuard customer", cus_phone: String(req.auth.token.phone_number || "").replace(/^\+88/, "") || "01000000000",
    cus_email: "noemail@venguard.example", cus_add1: "N/A", cus_city: "Dhaka", cus_country: "Bangladesh", shipping_method: "NO",
    product_name: "VenGuard Connected plan (1 year)", product_category: "Subscription", product_profile: "non-physical-goods"
  });
  const j = await (await fetch(sslcBase() + "/gwprocess/v4/api.php", { method: "POST", body: form })).json();
  if (j.status !== "SUCCESS") { logger.error("sslc init", j); throw new HttpsError("unavailable", "Payment could not start. Try again later."); }
  return { paymentUrl: j.GatewayPageURL };
});

exports.sslcIpn = onRequest({ secrets: [SSLC_STORE_ID, SSLC_STORE_PASSWORD] }, async (req, res) => {
  const tran = String(req.body.tran_id || "x"), valId = String(req.body.val_id || "");
  const pref = db.collection("payments").doc(tran);
  const pay = await pref.get();
  if (!pay.exists || !valId) return res.status(200).send("ignored");
  const v = await (await fetch(`${sslcBase()}/validator/api/validationserverAPI.php?format=json&val_id=${encodeURIComponent(valId)}&store_id=${encodeURIComponent(SSLC_STORE_ID.value())}&store_passwd=${encodeURIComponent(SSLC_STORE_PASSWORD.value())}`)).json();
  if (!(v.status === "VALID" || v.status === "VALIDATED") || v.tran_id !== tran || Number(v.amount) < PLAN_PRICE_BDT) return res.status(200).send("invalid");
  await db.runTransaction(async (tx) => {
    const p = await tx.get(pref);
    const sref = db.collection("sites").doc(p.data().siteId);
    const s = await tx.get(sref);
    if (p.data().status === "paid") return;
    const from = Math.max(Date.now(), s.data().plan && s.data().plan.expiresAt ? s.data().plan.expiresAt.toMillis() : 0);
    tx.update(sref, { "plan.expiresAt": Timestamp.fromMillis(from + 365 * 864e5) });
    tx.update(pref, { status: "paid", paidAt: FieldValue.serverTimestamp(), bankTran: v.bank_tran_id || "", method: v.card_type || "" });
  });
  res.status(200).send("ok");
});
function sslcBase() { return process.env.SSLC_SANDBOX === "true" ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com"; }

/* ===========================================================================
 * 7. Presence sweep — every 2 minutes, from the heartbeats in RTDB (/hb/{deviceId} = unix ms)
 * ========================================================================= */
exports.presenceSweep = onSchedule({ schedule: "every 2 minutes", secrets: SMS }, async () => {
  const hb = (await rtdb.ref("/hb").get()).val() || {};
  const now = Date.now();
  const paired = await db.collection("devices").where("siteId", "!=", null).get();
  for (const d of paired.docs) {
    const x = d.data(), last = Number(hb[d.id] || 0), alive = now - last <= OFFLINE_AFTER_MS;
    if (x.online && !alive) {
      await d.ref.update({ online: false });
      await addEvent(x.siteId, d.id, "offline");
      await alertSite(x.siteId, d.id, "offline");
    } else if (!x.online && alive) {
      await d.ref.update({ online: true, lastSeen: Timestamp.fromMillis(last) });
      if (x.lastSeen) await addEvent(x.siteId, d.id, "online");
    } else if (alive && (!x.lastSeen || now - x.lastSeen.toMillis() > 10 * 60e3)) {
      await d.ref.update({ lastSeen: Timestamp.fromMillis(last) }); // refresh "last update" at most every 10 min
    }
  }
  // Expire stale close commands.
  const stale = await db.collectionGroup("commands").where("status", "==", "delivered").where("expiresAt", "<", Timestamp.now()).get();
  for (const c of stale.docs) { await c.ref.update({ status: "expired" }); await rtdb.ref(`/devices/${c.ref.parent.parent.id}/cmd/${c.id}`).remove(); }
});

/* ===========================================================================
 * Events and alerts
 * ========================================================================= */
function addEvent(siteId, deviceId, type, data) {
  return db.collection("sites").doc(siteId).collection("events").add({ deviceId, type, data: data || {}, at: Timestamp.now() });
}
const SMS_TEXT = {
  leak: (place) => `VenGuard: ${place}-এ গ্যাস পাওয়া গেছে। ভালভ নিজেই গ্যাস বন্ধ করেছে। জানালা খুলুন, সুইচ বা আগুন জ্বালাবেন না। দরকার হলে ১০২/৯৯৯।`,
  offline: (place) => `VenGuard: ${place}-এর যন্ত্রটি ইন্টারনেটে নেই। সুরক্ষা তবুও চালু আছে। ওয়াই-ফাই/বিদ্যুৎ দেখুন।`,
  batt: (place) => `VenGuard: ${place}-এর ব্যাটারি কম। শীঘ্রই বদলান।`
};
async function alertSite(siteId, deviceId, kind) {
  try {
    const site = (await db.collection("sites").doc(siteId).get()).data();
    if (!site || !planActive(site) || !SMS_TEXT[kind]) return;
    const key = db.collection("sites").doc(siteId).collection("alertLog").doc(deviceId + "_" + kind);
    const last = await key.get();
    if (last.exists && Date.now() - last.data().at.toMillis() < 30 * 60e3) return; // no repeats within 30 min
    await key.set({ at: Timestamp.now() });
    const dev = (await db.collection("devices").doc(deviceId).get()).data() || {};
    const place = `${site.name} (${dev.label || "Kitchen"})`;
    for (const c of (site.contacts || []).filter((x) => x.sms)) await sendSms(c.phone, SMS_TEXT[kind](place));
  } catch (e) { logger.error("alert", siteId, deviceId, kind, e); }
}
async function sendSms(phone, message) {
  const url = SMS_API_URL.value();
  if (!url) return;
  // Adjust the payload to your Bangladeshi SMS gateway's API.
  await fetch(url, { method: "POST", body: new URLSearchParams({ api_key: SMS_API_KEY.value(), senderid: SMS_SENDER_ID.value(), number: "88" + phone, message, type: "unicode" }) });
}

/* ---------------- helpers ---------------- */
function requireAuth(req) { if (!req.auth || req.auth.token.device) throw new HttpsError("unauthenticated", "Please sign in."); return req.auth.uid; }
function planActive(site) { return !!(site && site.plan && site.plan.expiresAt && site.plan.expiresAt.toMillis() > Date.now()); }
function maskPhone(p) { p = String(p || ""); return p ? "…" + p.slice(-3) : "Family member"; }
