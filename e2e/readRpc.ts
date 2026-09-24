/**
 * Which Supabase RPC POSTs are READS.
 *
 * PostgREST answers every `supabase.rpc()` with a POST, so a test firewall
 * that refuses all POSTs refuses the app's reads too. On 2026-09-20 that put
 * SEVEN prod-audit explore cases into their screens' own load-failure states
 * and filed them as production defects — /jobs, the three helper-side job
 * details (`get_jobs_for_my_applications`, `get_my_pending_direct_offers`,
 * `get_safe_profiles`), /profile?tab=saved_helpers (`get_my_saved_helpers`)
 * and /admin?view=payouts (`get_payout_batches`). Worse than the false alarm:
 * a screen stuck in its error state has no controls left to press, so those
 * screens were not being explored at all.
 *
 * The rule is this codebase's own naming convention, CHECKED against the
 * database rather than assumed: on prod 2026-09-20, of every `public` function
 * named `get_ / list_ / count_ / search_ / admin_get_ / admin_list_`, exactly
 * two were VOLATILE. Both are named below and stay refused.
 *
 * Kept free of imports (no Playwright, no Supabase) so `src/test` can hold the
 * convention to account — `src/test/readNamedRpcsAreNotVolatile.test.ts` reads
 * the migrations and fails the day a read-named function is not declared
 * STABLE or IMMUTABLE.
 */

/** Read-verb prefixes on an RPC path. */
export const READ_RPC_PREFIX = /^\/rest\/v1\/rpc\/(get_|list_|count_|search_|admin_get_|admin_list_)/;

/**
 * Read-NAMED but VOLATILE, verified `pg_proc.provolatile = 'v'` on prod
 * 2026-09-20: each records something as a side effect (an export, a
 * rate-limited search), so the name alone is not enough to let it through.
 */
export const READ_NAMED_BUT_VOLATILE = new Set(["get_helper_earnings_export", "search_profiles_by_name"]);

/** True for a Supabase RPC POST a write firewall may let through as a read. */
export function isReadRpcPath(pathname: string): boolean {
  if (!READ_RPC_PREFIX.test(pathname)) return false;
  const name = pathname.slice("/rest/v1/rpc/".length).split("?")[0];
  return !READ_NAMED_BUT_VOLATILE.has(name);
}

/**
 * A Storage SIGN request (`createSignedUrl`) is a POST, but it only issues a
 * short-lived read link to an object the caller's RLS already lets it see.
 * On 2026-09-24 both firewalls refused it: admin-views put /admin?view=credentials
 * into "Couldn't load preview", and after that spec was fixed alone, the
 * messy-input explore (run 35987833531) filed the same screen as a "section/data
 * load failure" 8 times. Only `/object/sign/` — an upload is POST `/object/<bucket>/…`.
 */
export function isStorageSignPath(pathname: string): boolean {
  return /^\/storage\/v1\/object\/sign\//.test(pathname);
}
