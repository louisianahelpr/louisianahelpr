/**
 * Q2705 (Builder 2, 11-15): /home's largest paint on a phone (cwv-lab, helper persona, Slow 4G + 4x CPU, 375) was the
 * Your page card's line. It waited on two reads in a row that started only once the app had drawn: the profile row
 * (useCurrentUser) and then public_profile_by_handle for that handle. The entry now asks both beside the app's
 * download (src/boot/homePrefetch.ts): useCurrentUser takes the profile and admin-role rows through the /jobs hand-over
 * ("me", src/hooks/jobsPrefetchTake.ts), and Home's card read takes the page (homePrefetchTake.ts), each once.
 *
 * @mutate src/boot/homePrefetch.ts |   w[JOBS_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, me }; |
 * @mutate src/boot/homePrefetch.ts |   w[HOME_PAGE_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, page }; |
 * @mutate src/boot/homePrefetch.ts |       const handle = p && p.length === 1 ? p[0].handle : null; |       const handle = p && p.length >= 1 ? p[0].handle : null;
 * @mutate src/boot/homePrefetch.ts |       return r.ok ? { handle, data: (await r.json()) as unknown } : null; |       return { handle, data: r.ok ? ((await r.json()) as unknown) : null };
 * @mutate src/pages/home/homeDashboard/homePrefetchTake.ts |   w[PAGE_KEY] = undefined; |
 * @mutate src/pages/home/homeDashboard/homePrefetchTake.ts |   if (!s \|\| s.userId !== userId \|\| now - s.at > HOME_PREFETCH_MAX_AGE_MS) return null; |   if (!s) return null;
 * @mutate src/pages/home/homeDashboard/homePrefetchTake.ts |   return a && a.handle === handle && "data" in a ? { data: a.data } : null; |   return a && "data" in a ? { data: a.data } : null;
 * @mutate src/pages/home/HomeDashboard.tsx |       queryFn: async () => fetchPublicProfile(myHandle, myId ? await takeHomeOwnPagePrefetch(myId, myHandle) : null), |       queryFn: async () => fetchPublicProfile(myHandle),
 * @mutate src/lib/profileLink/api.ts |   const boot = given ?? (await takeProfilePage(handle)); |   const boot = await takeProfilePage(handle);
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => {
      rpc.calls.push(name);
      return { data: { display_name: "from server", listings: [] }, error: null };
    },
  },
}));

import { HOME_PAGE_PREFETCH_KEY, startHomePrefetch } from "./homePrefetch";
import { JOBS_PREFETCH_KEY } from "./jobsPrefetch";
import { HOME_PREFETCH_MAX_AGE_MS, takeHomeOwnPagePrefetch } from "@/pages/home/homeDashboard/homePrefetchTake";
import { takeJobsMePrefetch } from "@/hooks/jobsPrefetchTake";
import { fetchPublicProfile } from "@/lib/profileLink/api";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const UID = "11111111-2222-4333-8444-555555555555";
const w = window as unknown as Record<string, unknown>;
const ok = (body: unknown) => ({ ok: true, headers: new Headers({ "content-range": "*/0" }), json: async () => body }) as unknown as Response;
const bad = () => ({ ok: false, headers: new Headers(), json: async () => ({}) }) as unknown as Response;
const PAGE = { display_name: "Pat", listings: [] };

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
function stubFetch(answer: (url: string) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return answer(url);
  }));
}
const answering = (o: { profile?: unknown; admin?: unknown; page?: Response } = {}) => (url: string) =>
  url.includes("/profiles?") ? ok(o.profile ?? [{ user_id: UID, handle: "pat" }])
  : url.includes("/user_roles?") ? ok(o.admin ?? [])
  : url.includes("rpc/public_profile_by_handle") ? (o.page ?? ok(PAGE))
  : url.includes("/notification_preferences?") ? ok([])
  : ok(null);

function signIn() {
  vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
  localStorage.setItem("sb-proj-auth-token", JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: UID } }));
}

afterEach(() => {
  for (const k of ["__lhHomePrefetch", HOME_PAGE_PREFETCH_KEY, JOBS_PREFETCH_KEY]) w[k] = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  rpc.calls.length = 0;
});

describe("cold /home asks the profile and its own page from the entry (Q2705)", () => {
  it("the profile and admin-role rows go out at once, then the page for the profile's handle, as the member", async () => {
    signIn();
    stubFetch(answering());
    startHomePrefetch("/home");
    const now = calls.map((c) => c.url);
    expect(now.some((u) => u.includes("/profiles?select=*&user_id=eq."))).toBe(true);
    expect(now.some((u) => u.includes("/user_roles?select=role&user_id=eq.") && u.includes("role=eq.admin"))).toBe(true);
    expect(await takeHomeOwnPagePrefetch(UID, "pat")).toEqual({ data: PAGE });
    const page = calls.find((c) => c.url.endsWith("/rest/v1/rpc/public_profile_by_handle"));
    expect(page?.init?.method).toBe("POST");
    expect(JSON.parse(String(page?.init?.body))).toEqual({ p_handle: "pat" });
    expect((page?.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    // Inventory floor: the three first-card reads, the two account reads and the page.
    expect(calls.length).toBeGreaterThan(5);
  });

  it("useCurrentUser's hand-over gets the profile and admin rows, once, for this member only", async () => {
    signIn();
    stubFetch(answering({ admin: [{ role: "admin" }] }));
    startHomePrefetch("/home");
    expect(await takeJobsMePrefetch("someone-else")).toBeNull();
    startHomePrefetch("/home");
    expect(await takeJobsMePrefetch(UID)).toEqual({ profile: { user_id: UID, handle: "pat" }, isAdmin: true });
    expect(await takeJobsMePrefetch(UID), "a refetch reaches the server").toBeNull();
  });

  it("a 200 null is a real 'no page' (the hidden line); taken once", async () => {
    signIn();
    stubFetch(answering({ page: ok(null) }));
    startHomePrefetch("/home");
    expect(await takeHomeOwnPagePrefetch(UID, "pat")).toEqual({ data: null });
    expect(await takeHomeOwnPagePrefetch(UID, "pat"), "second take").toBeNull();
  });

  it("another member, another handle, an old answer, a refused read or an odd profile hands nothing over", async () => {
    signIn();
    const cases: [string, () => Promise<unknown>][] = [
      ["another member", async () => { stubFetch(answering()); startHomePrefetch("/home"); return takeHomeOwnPagePrefetch("someone-else", "pat"); }],
      ["another handle", async () => { stubFetch(answering()); startHomePrefetch("/home"); return takeHomeOwnPagePrefetch(UID, "sam"); }],
      ["old", async () => { stubFetch(answering()); startHomePrefetch("/home"); return takeHomeOwnPagePrefetch(UID, "pat", Date.now() + HOME_PREFETCH_MAX_AGE_MS + 1); }],
      ["page refused", async () => { stubFetch(answering({ page: bad() })); startHomePrefetch("/home"); return takeHomeOwnPagePrefetch(UID, "pat"); }],
      ["two profile rows", async () => { stubFetch(answering({ profile: [{ handle: "pat" }, { handle: "pat" }] })); startHomePrefetch("/home"); return takeHomeOwnPagePrefetch(UID, "pat"); }],
      ["no handle", async () => { stubFetch(answering({ profile: [{ user_id: UID, handle: null }] })); startHomePrefetch("/home"); return takeHomeOwnPagePrefetch(UID, "pat"); }],
      ["offline", async () => { vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); })); startHomePrefetch("/home"); return takeHomeOwnPagePrefetch(UID, "pat"); }],
    ];
    expect(cases.length).toBeGreaterThan(6);
    for (const [why, run] of cases) expect(await run(), why).toBeNull();
  });

  it("the card's read uses a given answer and asks the server nothing; without one it asks", async () => {
    expect(await fetchPublicProfile("pat", { data: null })).toBeNull();
    expect(await fetchPublicProfile("pat", { data: { ...PAGE, listings: [{ id: "l", price_cents: 500 }] } })).toMatchObject({ listings: [{ id: "l", current_price_cents: 500 }] });
    expect(rpc.calls).toEqual([]);
    expect(await fetchPublicProfile("pat")).toMatchObject({ display_name: "from server" });
    expect(rpc.calls).toEqual(["public_profile_by_handle"]);
  });

  it("Home's prefetch of the card's query takes the entry's answer, and the keys match", () => {
    const home = code("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain("...publicPageQuery(myHandle),");
    expect(home).toContain("queryFn: async () => fetchPublicProfile(myHandle, myId ? await takeHomeOwnPagePrefetch(myId, myHandle) : null),");
    expect(code("src/pages/home/homeDashboard/homePrefetchTake.ts")).toContain(`const PAGE_KEY = "${HOME_PAGE_PREFETCH_KEY}";`);
    expect(code("src/hooks/jobsPrefetchTake.ts")).toContain(`const KEY = "${JOBS_PREFETCH_KEY}";`);
    expect(code("src/hooks/useCurrentUser.ts")).toContain("const pre = await takeJobsMePrefetch(userId);");
  });
});
