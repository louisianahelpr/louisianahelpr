/**
 * Start Home's first-screen reads from the ENTRY, beside the app's own download (same idea as declutterPrefetch.ts).
 *
 * Measured 2026-11-01 (B78, production build on the HTTP/2 lab, 375 wide, Slow 4G 1.6 Mbps / 150 ms, x4 CPU, mocked
 * signed-in member): Home's largest paint (the first-job card) waited for useFirstJobState, whose reads started only
 * once the whole app had downloaded and rendered (~2.8 s) and ran one after another (applications count, then jobs
 * count, then alert settings: ~0.47 s), so the card painted at ~3.3 s.
 *
 * So the entry fires the SAME three REST reads with plain fetch, in parallel, and useFirstJobState's queryFn takes the
 * answer once instead of asking again (src/pages/home/homeDashboard/homePrefetchTake.ts). Uses the session the app
 * would use, sent only to the app's own Supabase, as supabase-js sends it. No usable session, any failure, or an
 * answer not in the expected shape: nothing is handed over and the query reads as it always did.
 *
 * NOTHING outside the entry may import this file (see guestJobsPrefetch.ts). So the URLs are COPIES of the query's,
 * and src/boot/homePrefetch.test.ts holds them equal to the ones supabase-js builds.
 */
import { storedSession } from "./storedSession";
import { JOBS_PREFETCH_KEY, currentUserUrls } from "./jobsPrefetch";

export const HOME_PREFETCH_KEY = "__lhHomePrefetch";
/** The member's own "does my page open?" answer for Home's Your page card (homePrefetchTake.ts takes it). */
export const HOME_PAGE_PREFETCH_KEY = "__lhHomePagePrefetch";

/** The REST URLs supabase-js sends for useFirstJobState's three reads (see the test). */
export function homeFirstJobUrls(supabaseUrl: string, userId: string): { applications: string; jobs: string; prefs: string } {
  const rest = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/`;
  const applications = new URL(`${rest}applications`);
  applications.searchParams.set("select", "id");
  applications.searchParams.set("helper_id", `eq.${userId}`);
  const jobs = new URL(`${rest}jobs`);
  jobs.searchParams.set("select", "id");
  jobs.searchParams.set("or", `(customer_id.eq.${userId},helper_id.eq.${userId})`);
  const prefs = new URL(`${rest}notification_preferences`);
  prefs.searchParams.set("select", "job_matches,email_job_matches");
  prefs.searchParams.set("user_id", `eq.${userId}`);
  return { applications: applications.toString(), jobs: jobs.toString(), prefs: prefs.toString() };
}

/** A head-only count read's total, as supabase-js reads it off Content-Range; null when there is none. */
function countOf(r: Response): number | null {
  if (!r.ok) return null;
  const n = Number.parseInt(r.headers.get("content-range")?.split("/")[1] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Called by the entry. No-op unless this is a cold load of /home, or of `/` (B79: a member there is sent on to /home,
 * by MarketingRedirect on the web and NativeRedirect in the app), with a live session.
 */
export function startHomePrefetch(pathname: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if ((path !== "/home" && path !== "/") || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const session = storedSession(Date.now() / 1000);
  if (!base || !key || !session) return;
  const urls = homeFirstJobUrls(base, session.userId);
  const auth = { apikey: key, Authorization: `Bearer ${session.token}` };
  const count = (url: string) => fetch(url, { method: "HEAD", headers: { ...auth, Prefer: "count=exact" } }).then(countOf);
  const answer = Promise.all([
    count(urls.applications),
    count(urls.jobs),
    fetch(urls.prefs, { headers: { ...auth, Accept: "application/json" } }).then((r) => (r.ok ? (r.json() as Promise<unknown>) : null)),
  ])
    .then(([appCount, jobCount, prefs]) => {
      // maybeSingle(): no row is null, one row is that row, more is an error (left to the query's own read).
      if (appCount === null || jobCount === null || !Array.isArray(prefs) || prefs.length > 1) return null;
      return { appCount, jobCount, prefs: (prefs[0] ?? null) as unknown };
    })
    // A failed prefetch is not an error: the query reads for itself.
    .catch(() => null);
  const w = window as unknown as Record<string, unknown>;
  w[HOME_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, answer };
  // Q2705 (Builder 2, 11-15; cwv-lab /home, helper persona, Slow 4G + 4x, 375): /home's largest paint was the Your page
  // card's line, which waited on two reads in a row that started only once the app had drawn: the profile row
  // (useCurrentUser, 3.6-4.5 s) and then public_profile_by_handle for its handle (4.5-5.2 s); the line painted at 5.2 s.
  // So the entry asks both here as well, the page off the profile's handle (as profilePrefetch.ts does for /profile).
  // useCurrentUser takes the profile and admin-role rows through the same hand-over /jobs fills (jobsPrefetchTake.ts,
  // "me"); Home's card takes the page (homePrefetchTake.ts). Each is handed out once; anything odd reads as always.
  const rest = `${base.replace(/\/$/, "")}/rest/v1/`;
  const rows = (url: string) =>
    fetch(url, { headers: { ...auth, Accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((x) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : null));
  const mine = currentUserUrls(base, session.userId);
  const profile = rows(mine.profile).catch(() => null);
  const me = Promise.all([profile, rows(mine.admin).catch(() => null)])
    .then(([p, admin]) => (p && admin ? { profile: p, admin } : null));
  const page = profile
    .then(async (p) => {
      const handle = p && p.length === 1 ? p[0].handle : null;
      if (typeof handle !== "string" || !handle) return null;
      const r = await fetch(`${rest}rpc/public_profile_by_handle`, {
        method: "POST",
        headers: { ...auth, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ p_handle: handle }),
      });
      // A refused or failed read hands nothing over (the card's own read decides); a 200 "null" is a real "no page".
      return r.ok ? { handle, data: (await r.json()) as unknown } : null;
    })
    // A failed prefetch is not an error: the card reads for itself.
    .catch(() => null);
  w[JOBS_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, me };
  w[HOME_PAGE_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, page };
}
