/**
 * The key shapes this repo must never commit (Q75), in ONE place.
 *
 * Two scanners read them:
 *   - scripts/secret-scan.mjs (the pre-commit hook and the CI second pass),
 *     pure node, so the hook runs on a machine without gitleaks installed;
 *   - gitleaks, through .gitleaks.toml, whose [[rules]] repeat these ids and
 *     regexes VERBATIM. src/test/secretScanGate.test.ts fails if the two drift
 *     (an id or a regex in one and not the other).
 *
 * Every regex is written in the subset that Go RE2 (gitleaks) and JavaScript
 * both read the same way: no lookbehind, no inline flags, no named groups.
 *
 * The Supabase publishable key (sb_publishable_...), the legacy anon JWT and
 * the project URL are public by design (they ship in the web bundle), so they
 * are ALLOWED below and in .gitleaks.toml's allowlist. The service_role JWT and
 * sb_secret_ keys bypass RLS and are the ones that matter.
 */

// base64url of `"role":"service_role"` at each of the three byte alignments a
// JWT payload can put it at, trimmed of the characters the neighbouring bytes
// change. Any key order in the payload lands on one of the three.
const SERVICE_ROLE_B64 = "(?:InJvbGUiOiJzZXJ2aWNlX3JvbGUi|Jyb2xlIjoic2VydmljZV9yb2xl|icm9sZSI6InNlcnZpY2Vfcm9s)";
// The same for `"role":"anon"`: the anon JWT is public, like the publishable key.
export const ANON_ROLE_B64 = "(?:InJvbGUiOiJhbm9u|Jyb2xlIjoiYW5v|icm9sZSI6ImFub24i)";

/** @type {{ id: string, description: string, regex: string }[]} */
export const SECRET_SHAPES = [
  {
    id: "lh-supabase-secret-key",
    description: "Supabase secret API key (sb_secret_), bypasses RLS",
    regex: "\\bsb_secret_[A-Za-z0-9_-]{20,}",
  },
  {
    id: "lh-supabase-service-role-jwt",
    description: "Supabase legacy service_role JWT, bypasses RLS",
    regex: `eyJ[A-Za-z0-9_-]*\\.ey[A-Za-z0-9_-]*${SERVICE_ROLE_B64}[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]{16,}`,
  },
  {
    id: "lh-supabase-access-token",
    description: "Supabase personal access token (sbp_), full management API",
    regex: "\\bsbp_[a-f0-9]{40}",
  },
  {
    id: "lh-supabase-signed-storage-url",
    description: "Supabase storage signed URL token (bearer read of a private object)",
    regex: "/storage/v1/object/sign/[^?\\s\"'`]+\\?token=eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{16,}",
  },
  {
    id: "lh-stripe-secret-key",
    description: "Stripe secret or restricted key (sk_/rk_, live or test)",
    regex: "\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}",
  },
  {
    id: "lh-stripe-webhook-secret",
    description: "Stripe webhook signing secret (whsec_)",
    regex: "\\bwhsec_[A-Za-z0-9+/]{24,}",
  },
  {
    id: "lh-resend-api-key",
    description: "Resend API key (re_)",
    regex: "\\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{16,}",
  },
  {
    id: "lh-sentry-token",
    description: "Sentry org or user auth token (sntrys_/sntryu_)",
    regex: "\\bsntry[su]_[A-Za-z0-9+/=_-]{30,}",
  },
  {
    id: "lh-private-key-body",
    description: "PEM private key WITH its body (Apple .p8 / APNs / ASC / any), not the bare header",
    regex: "-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----(?:\\\\n|\\s)*[A-Za-z0-9+/]{40,}",
  },
  {
    id: "lh-github-token",
    description: "GitHub token (ghp_/gho_/ghu_/ghs_/ghr_/github_pat_)",
    regex: "\\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})",
  },
  {
    id: "lh-google-api-key",
    description: "Google API key (AIza)",
    regex: "\\bAIza[0-9A-Za-z_-]{35}",
  },
];

/**
 * Matches that are NOT secrets. Tested against the matched text, and for the
 * MapKit token against its line. Keep in step with [allowlist] in .gitleaks.toml
 * (the guard checks each of these regexes appears there verbatim).
 */
// @two-way src/test/secretScanGate.test.ts:const staleAllow =
export const ALLOWED_MATCHES = [
  // Public by design: publishable key and anon JWT ship in the web bundle.
  "sb_publishable_[A-Za-z0-9_-]+",
  `eyJ[A-Za-z0-9_-]*\\.ey[A-Za-z0-9_-]*${ANON_ROLE_B64}`,
  // Docs placeholders: a run of x/X where the key body would be.
  "(?:x{8,}|X{8,})",
];
// @two-way src/test/secretScanGate.test.ts:const staleAllow =
export const ALLOWED_LINES = [
  // MapKit JS token: VITE_ var, shipped to every browser by design.
  "VITE_APPLE_MAPKIT_TOKEN",
];

/**
 * Scan text; returns findings with the value REDACTED (only id, line, length).
 * Never return or log the matched value: the whole point is that it stays out
 * of terminals, CI logs and reports. Scans the whole text, not line by line,
 * because a PEM key body sits on the lines AFTER its header.
 */
export function scanText(text) {
  const allowM = ALLOWED_MATCHES.map((s) => new RegExp(s));
  const allowL = ALLOWED_LINES.map((s) => new RegExp(s));
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const lines = text.split("\n");
  const findings = [];
  for (const shape of SECRET_SHAPES) {
    for (const m of text.matchAll(new RegExp(shape.regex, "g"))) {
      if (allowM.some((r) => r.test(m[0]))) continue;
      const line = lineOf(m.index);
      if (allowL.some((r) => r.test(lines[line - 1]))) continue;
      findings.push({ id: shape.id, line, length: m[0].length });
    }
  }
  return findings;
}
