/**
 * A signed-in member's request never leaves the device signed OUT
 * (Sentry/error_logs 2026-10-09: "permission denied for table backout_notices",
 * "... job_schedule_change_requests", "... referral_codes", "... login_history",
 * "permission denied for function get_job_offer_targets / get_my_saved_helpers"
 * on signed-in screens, after a token refresh failed on the network).
 *
 * Driven on the REAL supabase-js client (memory storage, stubbed network),
 * built with the same guard client.ts passes as `global.fetch`. The stored
 * session's access token has expired and /auth/v1/token fails on the wire,
 * so auth-js answers `session: null`; without the guard supabase-js sends the
 * publishable key as the bearer and PostgREST runs the read as anon.
 *
 * The class is every data surface the client builds requests for
 * (GUARDED_SURFACES: rest via from() and rpc(), functions, storage); each is
 * driven here, and the list is checked against the surfaces the client
 * actually exposes.
 *
 * @mutate src/lib/signedInRequestGuard.ts |         if (holdsRefreshableSession(stored)) { |         if (false) {
 * @mutate src/lib/signedInRequestGuard.ts |       const carriesNoMemberToken = authorization === null \|\| authorization === anonBearer; |       const carriesNoMemberToken = authorization === null;
 * @mutate src/lib/signedInRequestGuard.ts |     if (path.startsWith(`/${surface}/v1/`)) return surface; |     if (path.startsWith(`/${surface}/v2/`)) return surface;
 * @mutate src/integrations/supabase/client.ts |     fetch: guardSignedInRequests({ |     fetch: signOutAwareFetch, unused: ({
 * @mutate src/lib/signedInRequestGuard.ts |           heldSinceRefresh = true; |
 * @mutate src/lib/signedInRequestGuard.ts |   const base = normalisedBase(opts.supabaseUrl) ?? opts.supabaseUrl.replace(/\/+$/, ""); |   const base = opts.supabaseUrl.replace(/\/+$/, "");
 * @mutate src/integrations/supabase/client.ts |   if (!takeHeldSinceRefresh()) return; |   if (takeHeldSinceRefresh() \|\| true) return;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { blankComments } from "@/test/helpers/blankNonCode";
import { isNetworkFailure } from "@/lib/networkFailure";
import { isPermissionDenied } from "@/lib/permissionDenied";
import { GUARDED_SURFACES, HELD_MESSAGE, defaultAuthStorageKey, guardSignedInRequests, takeHeldSinceRefresh } from "./signedInRequestGuard";

const BASE = "https://proj.supabase.co";
const KEY = "sb_publishable_testkey";
const STORAGE_KEY = defaultAuthStorageKey(BASE);
const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const user = { id: "u1", aud: "authenticated", role: "authenticated", email: "u1@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const sessionExpiringAt = (expiresAtS: number) => ({ access_token: "member-jwt", refresh_token: "rt-1", token_type: "bearer", expires_in: 3600, expires_at: expiresAtS, user });
const nowS = () => Math.floor(Date.now() / 1000);

type Sent = { url: string; authorization: string | null };

/**
 * The network: /auth/v1/token fails on the wire (the 21:45Z owner incident);
 * every data request is recorded and answered the way PostgREST answers anon
 * on a table with no anon grant, so an unguarded run is visibly red.
 */
function stubNetwork(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/auth/v1/token")) throw new TypeError("Failed to fetch");
    const authorization = new Headers(init?.headers).get("Authorization");
    sent.push({ url, authorization });
    if (authorization === `Bearer ${KEY}` || authorization === null) {
      return new Response(JSON.stringify({ code: "42501", message: "permission denied for table backout_notices", details: null, hint: null }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return sent;
}

function buildClient(): SupabaseClient {
  // The same wiring client.ts uses: the guard over the app's fetch, reading
  // the auth client's own storage under its own key. db.retry off only so the
  // test does not wait out postgrest's 1+2+4 s backoff on the held reads.
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init);
  return createClient(BASE, KEY, {
    auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    db: { retry: false } as never,
    global: { fetch: guardSignedInRequests({ supabaseUrl: BASE, publishableKey: KEY, storage, storageKey: STORAGE_KEY, fetchImpl }) },
  });
}

/** One request per guarded surface, each through the client's own API. */
async function driveEverySurface(client: SupabaseClient) {
  const out: Record<string, { message: string } | null> = {};
  const rest = await client.from("backout_notices").select("id");
  out.rest = rest.error;
  const rpc = await client.rpc("get_job_offer_targets", {});
  out.rpc = rpc.error;
  const fn = await client.functions.invoke("create-payment", { body: {} });
  out.functions = fn.error ? { message: String((fn.error as Error).message ?? fn.error), ...(fn.error as object) } : null;
  const st = await client.storage.from("job-photos").list("x");
  out.storage = st.error ? { message: st.error.message } : null;
  return out;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mem.clear();
});

describe("a signed-in request is never sent as anon", () => {
  it("holds every surface while the stored session cannot refresh: nothing leaves with the publishable key, and the error is a network failure, not 'permission denied'", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = stubNetwork();
    mem.set(STORAGE_KEY, JSON.stringify(sessionExpiringAt(nowS() - 60)));
    const client = buildClient();
    // auth-js retries a refresh that failed on the wire with backoff for up to
    // 30 s before answering; fake timers walk through that wait.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const settle = async <T,>(p: Promise<T>): Promise<T> => {
      await vi.advanceTimersByTimeAsync(120_000);
      return p;
    };
    const { data } = await settle(client.auth.getSession());
    expect(data.session).toBeNull(); // auth-js's own answer: the precondition of the incident

    const errors = await settle(driveEverySurface(client));
    vi.useRealTimers();

    const dataRequests = sent.filter((s) => !s.url.includes("/auth/v1/"));
    expect(dataRequests.filter((s) => s.authorization === `Bearer ${KEY}` || s.authorization === null)).toEqual([]);
    for (const [surface, err] of Object.entries(errors)) {
      expect(err, surface).toBeTruthy();
      expect(isPermissionDenied(err), surface).toBe(false);
    }
    // The PostgREST surfaces carry the held message itself: network-class copy.
    expect(errors.rest?.message).toContain(HELD_MESSAGE);
    expect(isNetworkFailure(errors.rest)).toBe(true);
    expect(isNetworkFailure(errors.rpc)).toBe(true);
    expect(mem.has(STORAGE_KEY)).toBe(true); // nothing signed the member out
    spy.mockRestore();
  });

  it("a visitor with no stored session is untouched: requests go out with the publishable key as before", async () => {
    const sent = stubNetwork();
    const client = buildClient();
    await client.from("open_jobs_browse").select("id");
    await client.functions.invoke("public-fn", { body: {} });
    const data = sent.filter((s) => !s.url.includes("/auth/v1/"));
    expect(data.map((s) => s.url.split("/").slice(3, 5).join("/"))).toEqual(["rest/v1", "functions/v1"]);
    expect(data[0].authorization).toBe(`Bearer ${KEY}`);
  });

  it("a member with a live session is untouched: every surface carries the member's own token", async () => {
    const sent = stubNetwork();
    mem.set(STORAGE_KEY, JSON.stringify(sessionExpiringAt(nowS() + 3600)));
    const client = buildClient();
    const errors = await driveEverySurface(client);
    const data = sent.filter((s) => !s.url.includes("/auth/v1/"));
    expect(data).toHaveLength(4);
    expect(data.every((s) => s.authorization === "Bearer member-jwt")).toBe(true);
    expect(errors.rest).toBeNull();
  });

  it("the surfaces it guards are the client's own data surfaces, and client.ts builds the client with the guard", () => {
    expect(GUARDED_SURFACES.length).toBeGreaterThan(2);
    const client = createClient(BASE, KEY, { auth: { storage, persistSession: false } });
    // Every guarded surface is a URL the client really builds.
    const built = [
      (client as unknown as { rest: { url: string } }).rest.url,
      (client as unknown as { functionsUrl: URL }).functionsUrl.href,
      (client as unknown as { storageUrl: URL }).storageUrl.href,
    ];
    for (const surface of GUARDED_SURFACES) expect(built.some((u) => u.includes(`/${surface}/v1`)), surface).toBe(true);
    const src = blankComments(readFileSync(resolve(process.cwd(), "src/integrations/supabase/client.ts"), "utf8"));
    expect(src).toMatch(/global:\s*\{\s*fetch:\s*guardSignedInRequests\(\{/);
    // Recovery (review of the hold): after a hold, the next refresh refetches the failed active queries.
    expect(src).toMatch(/onAuthStateChange\(\(event\) => \{\s*if \(event !== 'TOKEN_REFRESHED' && event !== 'SIGNED_IN'\) return;\s*if \(!takeHeldSinceRefresh\(\)\) return;/);
    expect(src).toMatch(/refetchQueries\(\{ type: 'active', predicate: \(q\) => q\.state\.status === 'error' \}\)/);
    expect(src).toMatch(/storage:\s*authStorage,\s*storageKey:\s*defaultAuthStorageKey\(SUPABASE_URL\)/);
  });

  it("a hold raises the recovery flag once; a request that is not held leaves it down", async () => {
    takeHeldSinceRefresh();
    const sent = stubNetwork();
    mem.set(STORAGE_KEY, JSON.stringify(sessionExpiringAt(nowS() + 3600)));
    const guarded = guardSignedInRequests({ supabaseUrl: BASE, publishableKey: KEY, storage, storageKey: STORAGE_KEY, fetchImpl: (i, n) => fetch(i, n) });
    await guarded(`${BASE}/rest/v1/jobs`, { headers: { Authorization: "Bearer member-jwt" } });
    expect(takeHeldSinceRefresh()).toBe(false);
    await expect(guarded(`${BASE}/rest/v1/jobs`, { headers: { Authorization: `Bearer ${KEY}` } })).rejects.toThrow(HELD_MESSAGE);
    expect(takeHeldSinceRefresh()).toBe(true);
    expect(takeHeldSinceRefresh()).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("the project URL is matched the way supabase-js builds it (host case, trailing slash), never by raw text", async () => {
    stubNetwork();
    mem.set(STORAGE_KEY, JSON.stringify(sessionExpiringAt(nowS() + 3600)));
    for (const written of ["https://PROJ.supabase.co/", "https://proj.supabase.co//"]) {
      const guarded = guardSignedInRequests({ supabaseUrl: written, publishableKey: KEY, storage, storageKey: STORAGE_KEY, fetchImpl: (i, n) => fetch(i, n) });
      await expect(guarded(`${BASE}/rest/v1/jobs`, { headers: { Authorization: `Bearer ${KEY}` } }), written).rejects.toThrow(HELD_MESSAGE);
    }
  });
});
