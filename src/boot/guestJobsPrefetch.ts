/**
 * Start the guest /browse job list from the ENTRY, beside the app's own
 * download (Q206 b).
 *
 * Measured 2026-09-26 (production build, 375, 1.6 Mbps / 150 ms RTT, 4x CPU,
 * real prod backend, scripts/perf/measure-load.mjs): the DashboardGuest chunk
 * was in at 2.0 s, but the jobs request only STARTED at 3.8 s, because the
 * query is issued when DashboardGuest mounts, after the whole app graph has
 * downloaded and rendered. The first card landed at 4.9 s.
 *
 * So the entry fires the same REST read with a plain fetch (it must not import
 * Supabase, see routePreload's rules), and DashboardGuest's queryFn takes that
 * promise once instead of asking again. If the prefetch fails or is old, the
 * queryFn asks Supabase as it always did; nothing depends on this succeeding.
 *
 * Guest only: a signed-in visitor on /browse is redirected to /home.
 *
 * NOTHING outside the entry may import this file: a lazy page importing it
 * makes it (and routePreload) a shared chunk the page must wait for, which
 * put every route's page chunk in round 3 (scripts/perf/critical-path.mjs
 * caught it). So the select is a COPY of DashboardGuest's
 * (src/lib/guestJobsQuery.ts), the promise is handed over on `window`, and
 * src/test/guestJobsPrefetch.test.ts holds this URL equal to the one
 * supabase-js builds from that select, so the copies cannot drift.
 */
import { hasToken } from "./routePreload";

/** Copy of GUEST_JOBS_SELECT in src/lib/guestJobsQuery.ts (see above). */
const SELECT =
  "id, title, description, category, budget, date_needed, location, latitude, longitude, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status, pricing_mode, credential_tier, parish";
const LIMIT = 40;

/** The REST URL supabase-js sends for DashboardGuest's query (see the test). */
export function guestJobsRestUrl(supabaseUrl: string): string {
  const u = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/open_jobs_browse`);
  u.searchParams.set("select", SELECT.replace(/\s+/g, ""));
  u.searchParams.set("payment_status", "neq.abandoned");
  u.searchParams.set("order", "boosted_at.desc.nullslast,created_at.desc");
  u.searchParams.set("limit", String(LIMIT));
  return u.toString();
}

/** Where the entry leaves the in-flight read for DashboardGuest to take. */
export const GUEST_JOBS_PREFETCH_KEY = "__lhGuestJobsPrefetch";

/** Called by the entry. No-op unless this is a signed-out cold load of /browse. */
export function startGuestJobsPrefetch(pathname: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path !== "/browse" || hasToken() || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!base || !key) return;
  (window as unknown as Record<string, unknown>)[GUEST_JOBS_PREFETCH_KEY] = {
    at: Date.now(),
    rows: fetch(guestJobsRestUrl(base), { headers: { apikey: key, Authorization: `Bearer ${key}` } })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((rows) => (Array.isArray(rows) ? rows : null))
      // A failed prefetch is not an error: DashboardGuest asks Supabase itself.
      .catch(() => null),
  };
}
