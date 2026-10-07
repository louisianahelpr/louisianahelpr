import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bring the test account up to the current Terms, exactly as its own "I Agree"
 * tap would (same two writes, as the user, under RLS). A Terms bump otherwise
 * puts the non-dismissible TermsReconsentDialog over every authed page, and
 * every sweep that mints here measures or presses that modal instead of the
 * page: loading-states-refresh breached 331 times on 2026-09-23 for this
 * reason. test-signin-link's `--keep-consent` skips it for a run that wants the dialog.
 * LATEST_TERMS_VERSION is read from src/lib/consent.ts, the app's own value.
 */
export function latestConsentVersions(src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/lib/consent.ts"), "utf8")) {
  const terms = src.match(/export const LATEST_TERMS_VERSION = "([^"]+)"/)?.[1];
  const privacy = src.match(/export const LATEST_PRIVACY_VERSION = "([^"]+)"/)?.[1];
  if (!terms || !privacy) throw new Error("acceptCurrentTerms: cannot read LATEST_*_VERSION from src/lib/consent.ts");
  return { terms, privacy };
}

/** "Oct 2026" -> 202610 (comparable), or null for a version that is not "Mon YYYY". */
export function versionRank(v) {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[1]);
  return mon < 0 ? null : Number(m[2]) * 100 + mon + 1;
}

export async function acceptCurrentTerms(supabaseUrl, anonKey, accessToken, userId) {
  const { terms, privacy } = latestConsentVersions();
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const cur = await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=terms_version_accepted`, { headers });
  const [row] = cur.ok ? await cur.json() : [];
  if (row?.terms_version_accepted === terms) return; // TERMS-CONSENT already current
  // Never DOWNGRADE: a checkout behind origin/main reads an older version from
  // its own consent.ts, and writing it put the shared test accounts back on
  // the re-agree modal (2026-10-07: a stale shared checkout wrote "Sep 2026"
  // over "Oct 2026" twice). The account already holds a newer acceptance, so
  // this checkout is the stale one: refuse loudly instead of writing.
  const held = versionRank(row?.terms_version_accepted), ours = versionRank(terms);
  if (held !== null && ours !== null && held > ours) {
    throw new Error(`acceptCurrentTerms: ${userId} already accepted terms ${row.terms_version_accepted}, newer than this checkout's ${terms}: this checkout is behind origin/main (git pull / use a current worktree); refusing to downgrade`);
  }
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=user_id`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ terms_version_accepted: terms, terms_accepted_at: new Date().toISOString() }),
  });
  const landed = res.ok ? await res.json() : [];
  if (!landed.length) {
    throw new Error(`acceptCurrentTerms: could not accept terms ${terms} for ${userId} (HTTP ${res.status}); the sweep would measure the re-consent modal`);
  }
  await fetch(`${supabaseUrl}/rest/v1/legal_acceptances`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, terms_version: terms, privacy_version: privacy }),
  });
  process.stderr.write(`acceptCurrentTerms: accepted terms ${terms} for ${userId}\n`);
}
