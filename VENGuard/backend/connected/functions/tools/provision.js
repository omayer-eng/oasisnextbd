#!/usr/bin/env node
/**
 * Factory provisioning: prints the secret to flash and the sticker code for each device ID.
 *   DEVICE_MASTER_KEY=... node tools/provision.js VG-0001A3 VG-0001A4
 * Run only on the in-house flashing computer. Never commit or share the master key.
 */
"use strict";
const K = require("../device-keys");
const master = process.env.DEVICE_MASTER_KEY;
if (!master || master.length < 32) { console.error("Set DEVICE_MASTER_KEY (at least 32 characters)."); process.exit(1); }
const ids = process.argv.slice(2);
if (!ids.length) { console.error("Usage: node tools/provision.js VG-XXXXXX [...]"); process.exit(1); }
console.log("device_id,secret_hex_to_flash,sticker_code,qr_text");
for (const id of ids) {
  if (!K.DEVICE_ID.test(id)) { console.error("Bad device ID:", id); process.exit(1); }
  const code = K.claimCode(master, id);
  console.log([id, K.deviceSecret(master, id).toString("hex"), code, `VENGUARD:${id}:${code}`].join(","));
}
