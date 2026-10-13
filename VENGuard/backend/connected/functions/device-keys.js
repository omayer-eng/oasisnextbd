/**
 * Device key helpers shared by the cloud functions, the factory provisioning tool and tests.
 * deviceSecret = HMAC-SHA256(masterKey, "device:" + id)   → flashed into the device, never stored in the cloud
 * claimCode    = 6 digits from HMAC-SHA256(masterKey, "claim:" + id) → printed on the QR sticker
 */
"use strict";
const crypto = require("crypto");

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
const DEVICE_ID = /^VG-[A-Z0-9]{4,12}$/;

const deviceSecret = (master, id) => hmac(master, "device:" + id);
const claimCode = (master, id) => String(hmac(master, "claim:" + id).readUInt32BE(0) % 1e6).padStart(6, "0");

/** Signature a device sends in X-VG-Signature when asking for a token: HMAC of the exact request body. */
const signBody = (secret, rawBody) => hmac(secret, rawBody).toString("hex");
/** Firebase Auth uid for a device. Database rules match on this. */
const deviceUid = (id) => "dev_" + id;

function clampInt(v, lo, hi) { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0; }

function sanitizeState(s) {
  const valve = ["open", "closed"].includes(s.valve) ? s.valve : "unknown";
  return {
    valve,
    gasLEL: clampInt(s.gasLEL, 0, 100),
    alarm: !!s.alarm,
    detectorBattery: clampInt(s.detectorBattery, 0, 100),
    valveBattery: clampInt(s.valveBattery, 0, 100),
    rfLinkOk: s.rfLinkOk !== false
  };
}

function normPhone(v) {
  const d = String(v || "").replace(/\D/g, "").replace(/^880/, "0").replace(/^88(?=01)/, "");
  return /^01[3-9]\d{8}$/.test(d) ? d : "";
}

module.exports = { hmac, safeEqual, DEVICE_ID, deviceSecret, claimCode, signBody, deviceUid, clampInt, sanitizeState, normPhone };
