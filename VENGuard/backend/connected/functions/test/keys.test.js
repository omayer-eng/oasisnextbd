"use strict";
const test = require("node:test");
const assert = require("node:assert");
const K = require("../device-keys");

const MASTER = "test-master-key-0123456789abcdef0123456789";

test("device secrets are stable and distinct per device", () => {
  assert.strictEqual(K.deviceSecret(MASTER, "VG-0001A3").toString("hex"), K.deviceSecret(MASTER, "VG-0001A3").toString("hex"));
  assert.notStrictEqual(K.deviceSecret(MASTER, "VG-0001A3").toString("hex"), K.deviceSecret(MASTER, "VG-0001A4").toString("hex"));
});

test("claim codes are six digits", () => {
  for (const id of ["VG-0001A3", "VG-0001A4", "VG-ZZZZ"]) assert.match(K.claimCode(MASTER, id), /^\d{6}$/);
});

test("a token request signed by the device verifies; another device's or a tampered one does not", () => {
  const secret = K.deviceSecret(MASTER, "VG-0001A3");
  const body = JSON.stringify({ id: "VG-0001A3", ts: 1760000000000 });
  const sig = Buffer.from(K.signBody(secret, body), "hex");
  assert.ok(K.safeEqual(sig, K.hmac(secret, body)));
  assert.ok(!K.safeEqual(sig, K.hmac(K.deviceSecret(MASTER, "VG-0001A4"), body)));
  assert.ok(!K.safeEqual(sig, K.hmac(secret, body.replace("A3", "A4"))));
});

test("device uid matches the database rules prefix", () => {
  assert.strictEqual(K.deviceUid("VG-0001A3"), "dev_VG-0001A3");
});

test("state is clamped and only open/closed valve values pass", () => {
  assert.deepStrictEqual(K.sanitizeState({ valve: "OPEN!", gasLEL: 400, detectorBattery: -5, valveBattery: "77", alarm: 1 }),
    { valve: "unknown", gasLEL: 100, alarm: true, detectorBattery: 0, valveBattery: 77, rfLinkOk: true });
});

test("Bangladesh phone numbers normalise", () => {
  assert.strictEqual(K.normPhone("+880 1712-345678"), "01712345678");
  assert.strictEqual(K.normPhone("01212345678"), "");
});
