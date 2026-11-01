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

export const HOME_PREFETCH_KEY = "__lhHomePrefetch";

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
  (window as unknown as Record<string, unknown>)[HOME_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, answer };
}
