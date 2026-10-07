/**
 * Start a returning visitor's first-screen reads from the ENTRY, beside the
 * app's own download (Q1171).
 *
 * Measured 2026-10-07 (local build, prod data, poster, scripts/perf/cwv-lab.mjs,
 * 375 Slow 4G + CPU): /jobs drew at ~3.9 s and only then asked Supabase for
 * its rows (profile, roles, applications, offers, reviews, violations, all at
 * ~4.0 s, back at ~4.8 s), so LCP was 4.88 s. The guest /browse already starts
 * its list from the entry (guestJobsPrefetch, Q206); signed-in screens had no
 * such path because each screen's reads are many and their shapes live deep
 * in the app.
 *
 * So the app LEARNS them instead of this file copying them: on each signed-in
 * cold load, src/lib/bootReads.ts records the read-only Supabase requests the
 * first screen made in its first seconds (method, URL, body, the Accept and
 * Prefer headers; never a token), per path, for that user. On the NEXT cold
 * load of the same path this module replays them at once with the stored
 * session's access token and leaves the promises on `window`; the app's
 * fetch takes each matching response ONCE (same URL, body, headers and token,
 * within MAX_AGE_MS) instead of asking again. A request that no longer
 * matches is simply not taken: one wasted read, and the next load re-learns.
 *
 * Only GETs and `rpc/get_*` POSTs to this project's REST endpoint are ever
 * recorded or replayed, only for the user the list was learned from, and only
 * while the stored access token is still valid (an expired one is the token
 * refresh's job, Q1170). NOTHING outside the entry may import this file (it
 * must not import src/lib either: routePreload's rule); the keys are copied in
 * src/lib/bootReads.ts and src/test/signedInBootReads.test.ts holds them equal.
 */

export const BOOT_READS_STORE_KEY = "lh_boot_reads_v1";
export const BOOT_READS_WINDOW_KEY = "__lhBootReads";
/** Paths whose first screen is worth replaying (the signed-in first screens). */
export const BOOT_READ_PATHS = ["/home", "/jobs", "/posts", "/messages", "/profile"];
export const MAX_REPLAYED = 12;

export type StoredRead = { m: "GET" | "POST"; u: string; b?: string; a?: string; p?: string };
type Store = Record<string, { uid: string; at: number; reads: StoredRead[] }>;

function storedSession(ref: string): { token: string; uid: string } | null {
  try {
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const s = JSON.parse(raw) as { access_token?: unknown; expires_at?: unknown; user?: { id?: unknown } };
    if (typeof s.access_token !== "string" || typeof s.expires_at !== "number" || typeof s.user?.id !== "string") return null;
    // Valid for at least another minute, or supabase-js will refresh first.
    if (s.expires_at * 1000 - Date.now() < 60_000) return null;
    return { token: s.access_token, uid: s.user.id };
  } catch {
    /* storage blocked or corrupt: no replay, the app reads as it always did */
    return null;
  }
}

/** Called by the entry. No-op unless a signed-in cold load of a learned path. */
export function startSignedInBootReads(pathname: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (!BOOT_READ_PATHS.includes(path) || typeof fetch !== "function") return;
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!base || !key) return;
  const ref = new URL(base).hostname.split(".")[0];
  const session = storedSession(ref);
  if (!session) return;
  let entry: Store[string] | undefined;
  try {
    entry = (JSON.parse(localStorage.getItem(BOOT_READS_STORE_KEY) ?? "{}") as Store)[path];
  } catch {
    /* corrupt store: nothing to replay; the app overwrites it */
    return;
  }
  if (!entry || entry.uid !== session.uid || !Array.isArray(entry.reads)) return;
  const pending: Record<string, Promise<Response>> = {};
  for (const r of entry.reads.slice(0, MAX_REPLAYED)) {
    if (!r || (r.m !== "GET" && r.m !== "POST") || typeof r.u !== "string" || !r.u.startsWith("/rest/v1/")) continue;
    if (r.m === "POST" && !/^\/rest\/v1\/rpc\/get_[a-z0-9_]+$/.test(r.u)) continue;
    const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${session.token}` };
    if (r.a) headers.Accept = r.a;
    if (r.p) headers.Prefer = r.p;
    if (r.m === "POST") headers["Content-Type"] = "application/json";
    const p = fetch(base + r.u, { method: r.m, headers, body: r.m === "POST" ? r.b ?? "{}" : undefined });
    // A failed replay is not an error: the app asks Supabase itself.
    p.catch(() => undefined);
    pending[bootReadKey(r)] = p;
  }
  (window as unknown as Record<string, unknown>)[BOOT_READS_WINDOW_KEY] = { at: Date.now(), token: session.token, pending };
}

/** The match key; src/lib/bootReads.ts builds the same one from a live request. */
export function bootReadKey(r: StoredRead): string {
  return `${r.m} ${r.u}\n${r.b ?? ""}\n${r.a ?? ""}\n${r.p ?? ""}`;
}
