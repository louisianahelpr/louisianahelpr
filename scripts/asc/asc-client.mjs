// Minimal App Store Connect API client.
//
// Runs ONLY inside GitHub Actions, because the .p8 signing key exists only as a
// repository secret — GitHub secrets are write-only, so there is no way to hold
// this key locally and no way to do this work from a laptop.
//
// Key handling mirrors fastlane/Fastfile's extract_key_payload: the secret may
// be raw PEM, PEM with escaped newlines, base64-encoded PEM, or a JSON blob
// wrapping one of those. Accepting all four is not indulgence — the same secret
// feeds the TestFlight pipeline, and a stricter reader here would fail on a
// value that already works there.

import { createSign } from "node:crypto";

const HOST = "https://api.appstoreconnect.apple.com";

function normaliseKey(raw) {
  let v = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (v.startsWith("{")) {
    try {
      const parsed = JSON.parse(v);
      for (const f of ["key_content", "key", "private_key", "p8", "api_key"]) {
        if (parsed[f]) { v = String(parsed[f]).trim(); break; }
      }
    } catch { /* fall through — treat as a plain string */ }
  }
  if (v.includes("\\n")) v = v.replace(/\\n/g, "\n");
  if (!v.includes("BEGIN")) {
    // base64-encoded .p8
    try {
      const decoded = Buffer.from(v, "base64").toString("utf8");
      if (decoded.includes("BEGIN")) v = decoded;
    } catch { /* leave as-is; the sign call will fail loudly */ }
  }
  return v;
}

const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function mintToken() {
  const keyId = process.env.ASC_KEY_ID?.trim();
  const issuerId = process.env.ASC_ISSUER_ID?.trim();
  const key = normaliseKey(process.env.ASC_KEY_CONTENT || process.env.ASC_KEY_BASE64);
  const missing = [];
  if (!keyId) missing.push("ASC_KEY_ID");
  if (!issuerId) missing.push("ASC_ISSUER_ID");
  if (!key.includes("BEGIN")) missing.push("ASC_KEY_CONTENT/ASC_KEY_BASE64 (not a PEM after decoding)");
  if (missing.length) throw new Error(`App Store Connect credentials missing/invalid: ${missing.join(", ")}`);

  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  // 20 minutes. Apple caps this at 20 for App Store Connect API tokens.
  const payload = b64u(JSON.stringify({
    iss: issuerId, iat: now, exp: now + 20 * 60, aud: "appstoreconnect-v1",
  }));
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  // ASC requires the JOSE (r||s) form, which is what dsaEncoding: "ieee-p1363"
  // produces. Node's default DER encoding is silently rejected as a 401, which
  // is indistinguishable from a bad key — hence naming it here.
  const sig = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64u(sig)}`;
}

export async function asc(path, { method = "GET", body, token } = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${HOST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.title}: ${e.detail}`).join(" | ") || text.slice(0, 400);
    const err = new Error(`ASC ${method} ${path} → ${res.status}: ${detail}`);
    err.status = res.status;
    err.errors = json?.errors ?? [];
    throw err;
  }
  return json;
}

/** Page through a list endpoint, following `links.next`. */
export async function ascAll(path, token) {
  const out = [];
  let next = path;
  while (next) {
    const page = await asc(next, { token });
    out.push(...(page.data ?? []));
    next = page.links?.next ?? null;
  }
  return out;
}
