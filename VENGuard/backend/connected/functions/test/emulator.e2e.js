/**
 * End-to-end test against the Firebase emulators (no real project, no real devices):
 *   npx firebase emulators:exec --only auth,firestore,database,functions "node functions/test/emulator.e2e.js"
 * Simulates a device and a customer and checks the full remote-close round trip and the security rules.
 */
"use strict";
const assert = require("node:assert");
const admin = require("firebase-admin");
const K = require("../device-keys");

const PROJECT = "demo-venguard";
const REGION = "asia-southeast1";
const MASTER = "test-master-key-0123456789abcdef0123456789";
const FN = `http://127.0.0.1:5001/${PROJECT}/${REGION}`;
const AUTH = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const RTDB = `http://127.0.0.1:9000`;
const NS = `?ns=${PROJECT}-default-rtdb`;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
admin.initializeApp({ projectId: PROJECT, databaseURL: `http://127.0.0.1:9000${NS}` });
const db = admin.firestore();
const { Timestamp } = admin.firestore;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 15000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error("Timed out waiting for " + what); await sleep(250); } }
async function json(r) { const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { raw: t, status: r.status }; } }
async function idTokenFor(customToken) { const r = await json(await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) })); return r.idToken; }
const rtdbUrl = (path, tok) => `${RTDB}${path}.json${NS}${tok ? "&auth=" + tok : ""}`;
async function deviceToken(id, secretFor = id) {
  const body = JSON.stringify({ id, ts: Date.now() });
  const sig = K.signBody(K.deviceSecret(MASTER, secretFor), body);
  return fetch(`${FN}/deviceToken`, { method: "POST", headers: { "content-type": "application/json", "X-VG-Signature": sig }, body });
}
async function callable(name, data, tok) { return json(await fetch(`${FN}/${name}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify({ data }) })); }

(async () => {
  const DEV = "VG-TEST01", OTHER = "VG-TEST02";
  // Seed: one site with an active Connected plan, one paired device.
  await db.collection("sites").doc("s1").set({ name: "Test Home", type: "home", ownerUid: "u1", memberUids: ["u1"], contacts: [], plan: { expiresAt: Timestamp.fromMillis(Date.now() + 864e5) } });
  await db.collection("devices").doc(DEV).set({ siteId: "s1", memberUids: ["u1"], label: "Kitchen", online: false });
  await db.collection("devices").doc(OTHER).set({ siteId: "s2", memberUids: ["u2"], label: "Kitchen", online: false });

  // 1. Device sign-in: wrong secret refused, right secret accepted.
  assert.strictEqual((await deviceToken(DEV, OTHER)).status, 401, "token with another device's secret must be refused");
  const tokRes = await json(await deviceToken(DEV));
  assert.ok(tokRes.token, "device gets a custom token");
  const devTok = await idTokenFor(tokRes.token);
  const otherTok = await idTokenFor((await json(await deviceToken(OTHER))).token);
  console.log("✓ device sign-in (HMAC) works and rejects a wrong key");

  // 2. Device reports state → mirrored to Firestore for the app.
  let r = await fetch(rtdbUrl(`/devices/${DEV}/state`, devTok), { method: "PUT", body: JSON.stringify({ valve: "open", gasLEL: 3, alarm: false, detectorBattery: 88, valveBattery: 80 }) });
  assert.strictEqual(r.status, 200, "device can write its own state");
  await until(async () => (await db.collection("devices").doc(DEV).get()).data().state, "state mirror");
  console.log("✓ device state reaches the app database");

  // Rules: bad state shape refused; writing another device's state refused.
  r = await fetch(rtdbUrl(`/devices/${DEV}/state`, devTok), { method: "PUT", body: JSON.stringify({ valve: "opened", gasLEL: 3, alarm: false }) });
  assert.notStrictEqual(r.status, 200, "invalid valve value must be refused");
  r = await fetch(rtdbUrl(`/devices/${DEV}/state`, otherTok), { method: "PUT", body: JSON.stringify({ valve: "closed", gasLEL: 0, alarm: false }) });
  assert.notStrictEqual(r.status, 200, "a device must not write another device's state");
  console.log("✓ database rules refuse bad and cross-device writes");

  // 3. Customer asks to close; non-member and device tokens refused.
  const u1 = await idTokenFor(await admin.auth().createCustomToken("u1"));
  const u2 = await idTokenFor(await admin.auth().createCustomToken("u2"));
  const denied = await callable("requestClose", { deviceId: DEV }, u2);
  assert.ok(denied.error, "a non-member cannot close someone else's gas");
  const asDevice = await callable("requestClose", { deviceId: DEV }, devTok);
  assert.ok(asDevice.error, "a device token cannot call customer functions");
  const ok = await callable("requestClose", { deviceId: DEV }, u1);
  assert.ok(ok.result && ok.result.commandId, "member can request close: " + JSON.stringify(ok));
  const cid = ok.result.commandId;
  console.log("✓ close request accepted only from a member");

  // 4. The device sees the command (and the other device can't).
  const cmd = await json(await fetch(rtdbUrl(`/devices/${DEV}/cmd/${cid}`, devTok)));
  assert.strictEqual(cmd.type, "close", "device receives a close command");
  assert.notStrictEqual((await fetch(rtdbUrl(`/devices/${DEV}/cmd`, otherTok))).status, 200, "another device can't read these commands");
  r = await fetch(rtdbUrl(`/devices/${DEV}/cmd/${cid}`, devTok), { method: "PUT", body: JSON.stringify({ type: "open" }) });
  assert.notStrictEqual(r.status, 200, "nobody can write commands into the database, not even the device");
  console.log("✓ command delivered to the right device only; commands can't be forged");

  // Status is not "done" until the device confirms.
  assert.strictEqual((await db.doc(`devices/${DEV}/commands/${cid}`).get()).data().status, "delivered");

  // 5. Device closes the valve and acknowledges → done, event logged, command removed.
  r = await fetch(rtdbUrl(`/devices/${DEV}/ack/${cid}`, devTok), { method: "PUT", body: JSON.stringify({ result: "closed" }) });
  assert.strictEqual(r.status, 200, "device can acknowledge its own command: " + (await r.text()));
  await until(async () => (await db.doc(`devices/${DEV}/commands/${cid}`).get()).data().status === "done", "ack");
  await until(async () => !(await db.collection("sites/s1/events").where("type", "==", "remote_close").get()).empty, "remote_close event");
  await until(async () => (await json(await fetch(rtdbUrl(`/devices/${DEV}/cmd/${cid}`, devTok)))) === null, "command cleanup");
  console.log("✓ close confirmed only after the device ack; event logged");

  // 6. Leak detected on the device → leak event for the app.
  await fetch(rtdbUrl(`/devices/${DEV}/state`, devTok), { method: "PUT", body: JSON.stringify({ valve: "closed", gasLEL: 34, alarm: true, detectorBattery: 88, valveBattery: 80 }) });
  await until(async () => !(await db.collection("sites/s1/events").where("type", "==", "leak").get()).empty, "leak event");
  console.log("✓ leak on the device shows up as an alert event");

  // 7. Firestore rules: customer reads own device, can't read others', can't write commands directly.
  const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
  const asUser = (tok) => ({ headers: { authorization: "Bearer " + tok, "content-type": "application/json" } });
  assert.strictEqual((await fetch(`${FS}/devices/${DEV}`, asUser(u1))).status, 200, "member reads own device");
  assert.strictEqual((await fetch(`${FS}/devices/${DEV}`, asUser(u2))).status, 403, "non-member can't read the device");
  r = await fetch(`${FS}/devices/${DEV}/commands?documentId=forged`, { method: "POST", ...asUser(u1), body: JSON.stringify({ fields: { type: { stringValue: "open" } } }) });
  assert.strictEqual(r.status, 403, "nobody writes commands directly");
  assert.strictEqual((await fetch(`${FS}/sites/s1/events`, asUser(u2))).status, 403, "non-member can't list a site's events");
  console.log("✓ app database rules: own data only, read-only");
  console.log("\nAll end-to-end checks passed.");
  process.exit(0);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
