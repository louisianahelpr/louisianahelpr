/**
 * Keep the shared test accounts ENROLLED in public.test_accounts (Q552).
 *
 * With the launch switch on (`seed_jobs_hidden_publicly()` = true on prod
 * since 2026-10-07), an is_seed profile or job is hidden from every caller
 * that is not a row in public.test_accounts. That table's user_id has
 * `REFERENCES auth.users(id) ON DELETE CASCADE`, and the enrolment was a
 * one-time backfill (migration 20261007033530, frozen to accounts created
 * before 2026-10-07 04:30Z). On 2026-10-09 the six shared accounts were
 * deleted and re-created by hand with new ids: the cascade dropped their rows
 * and nothing put them back. Measured on prod 2026-10-12: test_accounts held
 * ONE row (f2098932), none of poster-e2e, helper-e2e, the seed admin,
 * incomplete, audit-web, eli.test.helper or the 50 prod-seed accounts. So the
 * journey helper saw only the one real open job (the is_seed Cleaning fixture
 * was hidden from them: e2e-journeys 38181872855 "filter by category"), and the
 * journey poster got "Profile not found" on helper-e2e (get_safe_profiles
 * returned 0 rows: "poster saves the Helpr").
 *
 * ensureTestAccountsEnrolled() is the repair, run with the service role by
 * every harness that relies on the accounts seeing each other: the journeys'
 * session mint (e2e/journeys/fixtures.ts) and `prod-seed --apply`. It refuses
 * any account whose profile is not is_seed, so it can never enrol a real
 * person. scripts/check-test-account-strikes.mjs is the detector
 * (findUnenrolled), and fails nightly when a shared account is not enrolled.
 */

/**
 * The shared accounts every prod harness signs in as (e2e/journeys/fixtures.ts
 * roles poster/helper/admin/incomplete plus the two older audit accounts).
 * scripts/check-test-account-strikes.mjs re-exports this list; the journeys'
 * mint enrols only an address on it.
 */
export const SHARED_TEST_ACCOUNTS = [
  "helpr-e2e-poster-0902@mailinator.com",
  "helpr-e2e-helper-0902@mailinator.com",
  "helpr-audit-web-0824@mailinator.com",
  "eli.test.helper@louisianahelpr.com",
  "helpr-seed-incomplete-0912@mailinator.com",
  "helpr-seed-admin-0912@louisianahelpr.com",
];

/** Pure: is `email` one of the shared test accounts (case-insensitive)? */
export function isSharedTestAccount(email) {
  return typeof email === "string" && SHARED_TEST_ACCOUNTS.includes(email.trim().toLowerCase());
}

/** Pure: the profile rows whose user_id has no test_accounts row. */
export function findUnenrolled(profiles, enrolledRows) {
  const enrolled = new Set((enrolledRows ?? []).map((r) => r?.user_id));
  return (profiles ?? []).filter((p) => !enrolled.has(p?.user_id));
}

/**
 * Enrol every id in `userIds` that is not enrolled yet, then read back and
 * prove all of them are. Throws on: an id with no profile, a profile that is
 * not is_seed (REFUSED, nothing written), or an enrolment that did not stick.
 *
 * @param {{ supabaseUrl: string, serviceKey: string, userIds: string[], note: string, fetchImpl?: typeof fetch }} o
 * @returns {Promise<{ checked: number, added: string[] }>}
 */
export async function ensureTestAccountsEnrolled({ supabaseUrl, serviceKey, userIds, note, fetchImpl = fetch }) {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (ids.length === 0) throw new Error("testAccountEnrolment: no user ids given");
  const base = supabaseUrl.replace(/\/$/, "");
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const call = async (method, path, body, prefer) => {
    const res = await fetchImpl(`${base}/rest/v1/${path}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`testAccountEnrolment: ${method} ${path.split("?")[0]} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : [];
  };
  const list = `in.(${ids.join(",")})`;

  const profiles = await call("GET", `profiles?user_id=${list}&select=user_id,is_seed`);
  const missing = ids.filter((id) => !profiles.some((p) => p.user_id === id));
  if (missing.length) throw new Error(`testAccountEnrolment: no profile for ${missing.join(", ")}`);
  const real = profiles.filter((p) => p.is_seed !== true);
  if (real.length) throw new Error(`testAccountEnrolment: REFUSED, not is_seed: ${real.map((p) => p.user_id).join(", ")} (only test accounts are ever enrolled)`);

  const before = await call("GET", `test_accounts?user_id=${list}&select=user_id`);
  const toAdd = findUnenrolled(profiles, before).map((p) => p.user_id);
  if (toAdd.length) {
    await call(
      "POST",
      "test_accounts?on_conflict=user_id",
      toAdd.map((user_id) => ({ user_id, note })),
      "resolution=ignore-duplicates,return=minimal",
    );
  }
  const after = await call("GET", `test_accounts?user_id=${list}&select=user_id`);
  const still = findUnenrolled(profiles, after);
  if (still.length) throw new Error(`testAccountEnrolment: still not enrolled after the insert: ${still.map((p) => p.user_id).join(", ")}`);
  return { checked: ids.length, added: toAdd };
}
