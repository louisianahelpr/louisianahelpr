/**
 * Start signed-in /jobs' first-screen reads from the ENTRY, beside the app's own download (same idea as homePrefetch.ts).
 *
 * Measured 2026-11-03 (B43, cwv-lab, local real-key build against prod data, 375 wide, Slow 4G + calibrated CPU,
 * median of 3): the LCP is the first job card's title, at ~6.44 s. The app drew at ~4.8 s and only THEN asked for the
 * feed (open_jobs_browse, ~4.93-5.71 s, beside the dashboard context's four reads) and, after it, the posters' names,
 * ratings and crew spots (~5.72-6.35 s). Two read rounds after the draw.
 *
 * So the entry fires the SAME reads with plain fetch: the feed's first page, the context's four reads and
 * useCurrentUser's two (profile, admin role) in parallel, then the posters' three reads off the feed's answer. useDashboardData takes each answer ONCE
 * (src/hooks/jobsPrefetchTake.ts) instead of asking again. Uses the session the app would use, sent only to the app's
 * own Supabase, as supabase-js sends it. No usable session, any failure, or an answer not in the expected shape:
 * nothing is handed over and the query reads as it always did.
 *
 * NOTHING outside the entry may import this file (see guestJobsPrefetch.ts). So the URLs and the select are COPIES of
 * the query's, and src/boot/jobsPrefetch.test.ts holds them equal to the ones supabase-js builds.
 */
import { storedSession } from "./storedSession";

export const JOBS_PREFETCH_KEY = "__lhJobsPrefetch";

/** Copy of useDashboardData's browseColumns, without its spaces (entry bytes; the test pins it). */
const FEED_SELECT =
  "id,title,description,scope_video_url,category,budget,date_needed,customer_id,status,created_at,updated_at,is_urgent,urgent_fee,is_flexible_schedule,date_window_end,is_recurring,is_group_job,helpers_needed,estimated_hours,materials_note,photos,boosted_at,boost_expires_at,expires_at,start_time,recurrence_interval,recurrence_end_date,recurrence_days,recurrence_weeks,parent_job_id,payment_status,location,latitude,longitude,pricing_mode,applicant_count,credential_tier,parish,helper_fee_flat_cents,helper_fee_percent";
/** useDashboardData's PAGE_SIZE: the first page asks for rows 0..PAGE_SIZE (one extra, to know if more exist). */
const PAGE_SIZE = 25;

/** The GET URLs supabase-js sends for the feed's first page and the dashboard context's three table reads. */
export function jobsFeedUrls(supabaseUrl: string, userId: string): { feed: string; availability: string; applied: string; blocks: string } {
  const rest = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/`;
  const feed = new URL(`${rest}open_jobs_browse`);
  feed.searchParams.set("select", FEED_SELECT);
  feed.searchParams.set("payment_status", "neq.abandoned");
  feed.searchParams.set("order", "boosted_at.desc.nullslast,created_at.desc");
  feed.searchParams.set("offset", "0");
  feed.searchParams.set("limit", String(PAGE_SIZE + 1));
  const availability = new URL(`${rest}helper_availability`);
  availability.searchParams.set("select", "day_of_week,is_available,start_time,end_time");
  availability.searchParams.set("helper_id", `eq.${userId}`);
  availability.searchParams.set("specific_date", "is.null");
  availability.searchParams.set("order", "day_of_week.asc");
  const applied = new URL(`${rest}applications`);
  applied.searchParams.set("select", "job_id");
  applied.searchParams.set("helper_id", `eq.${userId}`);
  const blocks = new URL(`${rest}user_blocks`);
  blocks.searchParams.set("select", "blocker_id,blocked_id");
  blocks.searchParams.set("or", `(blocker_id.eq.${userId},blocked_id.eq.${userId})`);
  return { feed: feed.toString(), availability: availability.toString(), applied: applied.toString(), blocks: blocks.toString() };
}

/** The GET URLs supabase-js sends for useCurrentUser's two reads (the profile row, the admin role row). */
export function currentUserUrls(supabaseUrl: string, userId: string): { profile: string; admin: string } {
  const rest = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/`;
  const profile = new URL(`${rest}profiles`);
  profile.searchParams.set("select", "*");
  profile.searchParams.set("user_id", `eq.${userId}`);
  const admin = new URL(`${rest}user_roles`);
  admin.searchParams.set("select", "role");
  admin.searchParams.set("user_id", `eq.${userId}`);
  admin.searchParams.set("role", "eq.admin");
  return { profile: profile.toString(), admin: admin.toString() };
}

/** The crew-spots read supabase-js sends for these job ids (fetchCrewSpotsOpen). */
export function crewSpotsUrl(supabaseUrl: string, jobIds: readonly string[]): string {
  const u = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/open_jobs_browse`);
  u.searchParams.set("select", "id,crew_spots_open");
  u.searchParams.set("id", `in.(${jobIds.join(",")})`);
  return u.toString();
}

type Row = Record<string, unknown>;
const rowsOf = (r: Response): Promise<Row[] | null> =>
  r.ok ? (r.json() as Promise<unknown>).then((x) => (Array.isArray(x) ? (x as Row[]) : null)) : Promise.resolve(null);

/**
 * Called by the entry (through signedInPrefetch.ts). No-op unless this is a cold load of /jobs with a live session.
 */
export function startJobsPrefetch(pathname: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path !== "/jobs" || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const session = storedSession(Date.now() / 1000);
  if (!base || !key || !session) return;
  const urls = jobsFeedUrls(base, session.userId);
  const auth = { apikey: key, Authorization: `Bearer ${session.token}` };
  const get = (url: string) => fetch(url, { headers: { ...auth, Accept: "application/json" } }).then(rowsOf);
  const rpc = (fn: string, args: Row) =>
    fetch(`${base.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { ...auth, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }).then(rowsOf);
  // A link that opens on the Posted or Working list never draws Browse's feed: its reads would only take bandwidth
  // from the list's own (B46, 11-03). The member's own reads (`me`, below) are still the list's first reads.
  const list = jobsOpensOnList(location.search);
  // A failed prefetch is not an error: the query reads for itself.
  const ctx = list ? Promise.resolve(null) : Promise.all([rpc("get_public_platform_settings", {}), get(urls.availability), get(urls.applied), get(urls.blocks)])
    .then(([fee, availability, applied, blocks]) =>
      fee && availability && applied && blocks ? { fee, availability, applied, blocks } : null)
    .catch(() => null);
  const feed = list ? Promise.resolve(null) : get(urls.feed)
    .then(async (rows) => {
      if (!rows) return null;
      // Every poster on the first page (the query's own list is this one minus anyone blocked: a subset).
      const page = rows.slice(0, PAGE_SIZE);
      const posterIds = [...new Set(page.map((j) => j.customer_id).filter((id): id is string => typeof id === "string"))];
      const crewIds = page.filter((j) => j.is_group_job).map((j) => j.id as string);
      if (posterIds.length === 0) return { rows, posterIds, crewIds, profiles: [], stats: [], crew: [] };
      const [profiles, stats, crew] = await Promise.all([
        rpc("get_safe_profiles", { user_ids: posterIds }),
        rpc("get_public_profile_stats", { p_user_ids: posterIds }),
        crewIds.length ? get(crewSpotsUrl(base, crewIds)) : Promise.resolve([] as Row[]),
      ]);
      // The page alone is still worth handing over: the posters' reads then run in the query, as before.
      return profiles && stats && crew ? { rows, posterIds, crewIds, profiles, stats, crew } : { rows };
    })
    .catch(() => null);
  // The feed's loading state also waits on useCurrentUser (the profile and the admin role, read together): measured
  // the cards' last wait after the draw (~0.85 s) once the feed itself was prefetched.
  const mine = currentUserUrls(base, session.userId);
  const me = Promise.all([get(mine.profile), get(mine.admin)])
    .then(([profile, admin]) => (profile && admin ? { profile, admin } : null))
    .catch(() => null);
  (window as unknown as Record<string, unknown>)[JOBS_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, feed, ctx, me };
}

/**
 * True when a cold /jobs URL opens on the Posted or Working list: JobsSection.resolveJobsTab's rule (a list ?tab=, or
 * no ?tab= and one of the old My Jobs link params, MY_JOBS_LINK_PARAMS), copied because nothing here may import the
 * page. src/boot/jobsPrefetch.test.ts holds the two equal for every link shape.
 */
export function jobsOpensOnList(search: string): boolean {
  const p = new URLSearchParams(search);
  const tab = p.get("tab");
  return tab ? tab === "posted" || tab === "working" : ["job", "filter", "highlight", "q", "quotes"].some((k) => p.has(k));
}
