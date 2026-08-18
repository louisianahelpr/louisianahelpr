#!/usr/bin/env node
/**
 * Generate an Apple MapKit JS token (VITE_APPLE_MAPKIT_TOKEN).
 *
 * A MapKit JS "token" is not a value Apple hands you — it is a JWT you sign
 * yourself with the .p8 private key from your MapKit JS key. It expires, so
 * this script exists to be re-run rather than the token being treated as a
 * permanent secret.
 *
 * Usage:
 *   node scripts/mapkit-token.mjs <path-to.p8> <KEY_ID> <TEAM_ID> [days]
 *
 * Example:
 *   node scripts/mapkit-token.mjs ~/Downloads/AuthKey_ABCD123456.p8 ABCD123456 XYZ9876543 180
 *
 * Then paste the output into .env as:
 *   VITE_APPLE_MAPKIT_TOKEN="<output>"
 *
 * NO `origin` CLAIM — deliberate, and the thing most guides get wrong here.
 * Apple lets you pin a token to a web origin, and for a plain website you
 * should. This app is ALSO a Capacitor build whose WebView origin is
 * `capacitor://localhost`, which is not a value Apple's origin check accepts.
 * Pinning the origin would make maps work on the website and fail silently in
 * the iOS app. Leaving it unset keeps one token working on both surfaces.
 *
 * The token is PUBLIC by design — VITE_ vars are compiled into the client
 * bundle and MapKit JS tokens are meant to be visible. The .p8 that signs it
 * is NOT: keep it out of the repo. Anyone holding the .p8 can mint tokens
 * against your Apple account until you revoke the key.
 */
import { readFileSync } from "node:fs";
import { createSign, sign as cryptoSign } from "node:crypto";

const [p8Path, keyId, teamId, daysRaw] = process.argv.slice(2);

if (!p8Path || !keyId || !teamId) {
  console.error("usage: node scripts/mapkit-token.mjs <path-to.p8> <KEY_ID> <TEAM_ID> [days]");
  process.exit(1);
}

const days = Number(daysRaw ?? 180);
if (!Number.isFinite(days) || days <= 0 || days > 365) {
  console.error(`days must be 1-365 (Apple's maximum lifetime); got ${daysRaw}`);
  process.exit(1);
}

for (const [label, value] of [["KEY_ID", keyId], ["TEAM_ID", teamId]]) {
  if (!/^[A-Z0-9]{10}$/.test(value)) {
    console.error(`${label} should be 10 uppercase alphanumeric characters; got "${value}"`);
    process.exit(1);
  }
}

let privateKey;
try {
  privateKey = readFileSync(p8Path, "utf8");
} catch (err) {
  console.error(`could not read ${p8Path}: ${err.message}`);
  process.exit(1);
}
if (!privateKey.includes("BEGIN PRIVATE KEY")) {
  console.error(`${p8Path} does not look like a PKCS#8 .p8 key (no "BEGIN PRIVATE KEY" header)`);
  process.exit(1);
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const now = Math.floor(Date.now() / 1000);

const signingInput =
  b64url({ alg: "ES256", kid: keyId, typ: "JWT" }) +
  "." +
  b64url({ iss: teamId, iat: now, exp: now + days * 86400 });

// `ieee-p1363` gives the raw r||s signature JOSE wants. Node's default is DER,
// which MapKit rejects — and it fails as "invalid token" with no hint why.
const signature = cryptoSign("sha256", Buffer.from(signingInput), {
  key: privateKey,
  dsaEncoding: "ieee-p1363",
}).toString("base64url");

const expires = new Date((now + days * 86400) * 1000).toISOString().slice(0, 10);
process.stderr.write(`MapKit JS token — expires ${expires} (${days} days)\n\n`);
process.stdout.write(`${signingInput}.${signature}\n`);
