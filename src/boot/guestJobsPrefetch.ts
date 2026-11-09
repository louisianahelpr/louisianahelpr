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

/** Copy of GUEST_JOBS_SELECT in src/lib/guestJobsQuery.ts (see above), without its spaces: entry bytes. */
const SELECT =
  "id,title,description,scope_video_url,category,budget,date_needed,location,latitude,longitude,customer_id,status,created_at,updated_at,is_urgent,urgent_fee,is_flexible_schedule,date_window_end,is_recurring,is_group_job,helpers_needed,estimated_hours,materials_note,photos,boosted_at,boost_expires_at,expires_at,start_time,recurrence_interval,recurrence_end_date,parent_job_id,payment_status,pricing_mode,credential_tier,parish,helper_fee_flat_cents,helper_fee_percent";
const LIMIT = 40;

/** The REST URL supabase-js sends for DashboardGuest's query (see the test). */
export function guestJobsRestUrl(supabaseUrl: string): string {
  const u = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/open_jobs_browse`);
  u.searchParams.set("select", SELECT);
  u.searchParams.set("payment_status", "neq.abandoned");
  u.searchParams.set("order", "boosted_at.desc.nullslast,created_at.desc");
  u.searchParams.set("limit", String(LIMIT));
  return u.toString();
}

/** Where the entry leaves the in-flight read for DashboardGuest to take. */
export const GUEST_JOBS_PREFETCH_KEY = "__lhGuestJobsPrefetch";

/**
 * F010 (owner's UI audit 11-09): the landing's "Open jobs near you" read started only after the Supabase chunk arrived
 * (measured live: 2.0 s at 1440, 3.6 s at 375). On a signed-out "/" the entry fires that read too, with a plain fetch,
 * and LiveJobsSection takes the promise. Copy of LIVE_JOBS_SELECT in src/components/landing/LiveJobsSection.tsx,
 * without its spaces; src/test/guestJobsPrefetch.test.ts holds this URL equal to the one supabase-js builds there.
 */
const LANDING_SELECT =
  "id,title,budget,date_needed,parish,category,pricing_mode,urgent_fee,helpers_needed,is_group_job,helper_fee_flat_cents,helper_fee_percent";
const LANDING_LIMIT = 4;

/** The REST URL supabase-js sends for LiveJobsSection's query (see the test). */
export function landingJobsRestUrl(supabaseUrl: string): string {
  const u = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/open_jobs_browse`);
  u.searchParams.set("select", LANDING_SELECT);
  u.searchParams.set("order", "created_at.desc");
  u.searchParams.set("limit", String(LANDING_LIMIT));
  return u.toString();
}

/** Where the entry leaves the landing's in-flight read for LiveJobsSection to take. */
export const LANDING_JOBS_PREFETCH_KEY = "__lhLandingJobsPrefetch";

/** Called by the entry. No-op unless this is a signed-out cold load of /browse (or, for the landing's read, "/"). */
export function startGuestJobsPrefetch(pathname: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if ((path !== "/browse" && path !== "/") || hasToken() || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!base || !key) return;
  const landing = path === "/";
  (window as unknown as Record<string, unknown>)[landing ? LANDING_JOBS_PREFETCH_KEY : GUEST_JOBS_PREFETCH_KEY] = {
    at: Date.now(),
    rows: fetch(landing ? landingJobsRestUrl(base) : guestJobsRestUrl(base), { headers: { apikey: key, Authorization: `Bearer ${key}` } })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((rows) => (Array.isArray(rows) ? rows : null))
      // A failed prefetch is not an error: DashboardGuest (or LiveJobsSection) asks Supabase itself.
      .catch(() => null),
  };
}
