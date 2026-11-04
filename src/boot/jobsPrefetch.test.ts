/**
 * B43 (11-03, Q1158): the entry starts signed-in /jobs' first-screen reads (the feed's first page, the dashboard
 * context's four reads, then the posters' three) beside the app download, and useDashboardData takes each answer once
 * instead of asking again. The prefetch is a plain fetch (the entry must not import Supabase), so its URLs are
 * hand-built; this builds the query's reads with supabase-js itself and requires the same URLs, so the copies cannot
 * drift.
 */
// @mutate src/boot/jobsPrefetch.ts |   if (path !== "/jobs" \|\| typeof fetch !== "function") return; |   if (typeof fetch !== "function") return;
// @mutate src/boot/jobsPrefetch.ts |   feed.searchParams.set("limit", String(PAGE_SIZE + 1)); |   feed.searchParams.set("limit", String(PAGE_SIZE));
// @mutate src/boot/jobsPrefetch.ts |   availability.searchParams.set("specific_date", "is.null"); |
// @mutate src/boot/jobsPrefetch.ts |   blocks.searchParams.set("or", `(blocker_id.eq.${userId},blocked_id.eq.${userId})`); |   blocks.searchParams.set("or", `(blocker_id.eq.${userId})`);
// @mutate src/boot/jobsPrefetch.ts |       fee && availability && applied && blocks ? { fee, availability, applied, blocks } : null) |       ({ fee: fee ?? [], availability: availability ?? [], applied: applied ?? [], blocks: blocks ?? [] }))
// @mutate src/hooks/jobsPrefetchTake.ts |   s[part] = undefined; |
// @mutate src/hooks/jobsPrefetchTake.ts |   if (!p \|\| now - s.at > JOBS_PREFETCH_MAX_AGE_MS \|\| s.userId !== userId) return null; |   if (!p \|\| now - s.at > JOBS_PREFETCH_MAX_AGE_MS) return null;
// @mutate src/hooks/jobsPrefetchTake.ts |   return posterIds.every((id) => typeof id !== "string" \|\| p.has(id)) && crewIds.every((id) => c.has(id)); |   return true;
// @mutate src/hooks/useDashboardData.ts |         feedPre = offset === 0 && user ? await takeJobsFeedPrefetch(user.id) : null; |         feedPre = user ? await takeJobsFeedPrefetch(user.id) : null;
// @mutate src/boot/signedInPrefetch.ts |   startJobsPrefetch(pathname); |
// @mutate src/hooks/jobsPrefetchTake.ts |   return { profile, isAdmin: x.admin[0]?.role === "admin" }; |   return { profile, isAdmin: x.admin.length > 0 \|\| x.profile.length > 0 };
// @mutate src/hooks/jobsPrefetchTake.ts |   if (profile && profile.user_id !== userId) return null; |
// @mutate src/boot/jobsPrefetch.ts |   admin.searchParams.set("role", "eq.admin"); |
// @mutate src/boot/jobsPrefetch.ts |   const feed = list ? Promise.resolve(null) : get(urls.feed) |   const feed = get(urls.feed)
// @mutate src/boot/jobsPrefetch.ts |   const ctx = list ? Promise.resolve(null) : Promise.all( |   const ctx = Promise.all(
// @mutate src/boot/jobsPrefetch.ts |   return tab ? tab === "posted" \|\| tab === "working" : ["job", "filter", "highlight", "q", "quotes"].some((k) => p.has(k)); |   return tab ? tab === "posted" : ["job", "filter", "highlight", "q"].some((k) => p.has(k));
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { JOBS_PREFETCH_KEY, crewSpotsUrl, currentUserUrls, jobsFeedUrls, jobsOpensOnList, startJobsPrefetch } from "./jobsPrefetch";
import {
  JOBS_PREFETCH_MAX_AGE_MS,
  coversPosters,
  takeJobsCtxPrefetch,
  takeJobsFeedPrefetch,
  takeJobsMePrefetch,
} from "@/hooks/jobsPrefetchTake";
import { blankComments } from "@/test/helpers/blankNonCode";
import { walkSource } from "@/test/helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const UID = "11111111-2222-4333-8444-555555555555";
const BASE = "https://proj.supabase.co";
const session = (expiresInS: number, id = UID) =>
  JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id } });
const res = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response;
const slot = () => (window as unknown as Record<string, { at: number } | undefined>)[JOBS_PREFETCH_KEY];

afterEach(() => {
  (window as unknown as Record<string, unknown>)[JOBS_PREFETCH_KEY] = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  localStorage.clear();
});

function signIn(expiresInS = 3600, id = UID) {
  vi.stubEnv("VITE_SUPABASE_URL", BASE);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
  localStorage.setItem("sb-proj-auth-token", session(expiresInS, id));
}

const rows = [
  { id: "j1", customer_id: "p1", is_group_job: false },
  { id: "j2", customer_id: "p2", is_group_job: true },
  { id: "j3", customer_id: "p1", is_group_job: false },
];
/** A fetch answering every read the prefetch makes. */
const answering = (over: Partial<Record<string, unknown>> = {}) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    const pick = (k: string, v: unknown) => res(k in over ? over[k] : v, !(k in over && over[k] === "fail"));
    if (url.includes("/rpc/get_safe_profiles")) return pick("profiles", [{ user_id: "p1", full_name: "A" }]);
    if (url.includes("/rpc/get_public_profile_stats")) return pick("stats", []);
    if (url.includes("/rpc/get_public_platform_settings")) return pick("fee", [{ helper_fee_percent: 12 }]);
    if (url.includes("crew_spots_open")) return pick("crew", [{ id: "j2", crew_spots_open: 1 }]);
    if (url.includes("/open_jobs_browse")) return pick("feed", rows);
    if (url.includes("/helper_availability")) return pick("availability", []);
    if (url.includes("/applications")) return pick("applied", []);
    if (url.includes("/user_blocks")) return pick("blocks", []);
    if (url.includes("/profiles")) return pick("profile", [{ user_id: UID, full_name: "Me" }]);
    if (url.includes("/user_roles")) return pick("admin", []);
    void init;
    return res(null, false);
  });

describe("signed-in /jobs' first reads start from the entry (B43, Q1158)", () => {
  it("its URLs are the ones supabase-js builds for the feed's first page and the context's reads", () => {
    const sb = createClient(BASE, "k");
    const url = (q: unknown) => (q as { url: URL }).url.toString();
    // The query's select, read out of useDashboardData itself.
    const dash = code("src/hooks/useDashboardData.ts");
    const select = /const browseColumns =[\s\S]*?"(id, title, description[^"]+)";/.exec(dash)?.[1];
    expect(select, "browseColumns literal").toBeTruthy();
    expect(dash).toContain("const PAGE_SIZE = 25;");
    const want = {
      feed: url(sb.from("open_jobs_browse").select(select!).neq("payment_status", "abandoned")
        .order("boosted_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).range(0, 25)),
      availability: url(sb.from("helper_availability").select("day_of_week, is_available, start_time, end_time")
        .eq("helper_id", UID).is("specific_date", null).order("day_of_week")),
      applied: url(sb.from("applications").select("job_id").eq("helper_id", UID)),
      blocks: url(sb.from("user_blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${UID},blocked_id.eq.${UID}`)),
    };
    expect(jobsFeedUrls(BASE, UID)).toEqual(want);
    expect(currentUserUrls(BASE, UID)).toEqual({
      profile: url(sb.from("profiles").select("*").eq("user_id", UID).maybeSingle()),
      admin: url(sb.from("user_roles").select("role").eq("user_id", UID).eq("role", "admin").maybeSingle()),
    });
    const cur = code("src/hooks/useCurrentUser.ts");
    expect(cur).toContain('supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle()');
    expect(cur).toContain('supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle()');
    expect(cur).toMatch(/const pre = await takeJobsMePrefetch\(userId\);\s*if \(pre\) return \{ profile: pre\.profile as Profile \| null, isAdmin: pre\.isAdmin, adminCheckFailed: false \};/);
    expect(crewSpotsUrl(BASE, ["a", "b"])).toBe(url(sb.from("open_jobs_browse").select("id, crew_spots_open").in("id", ["a", "b"])));
    // ...and the query asks exactly those chains.
    expect(dash).toMatch(/\.from\("open_jobs_browse"\)\s*\.select\(columns\)\s*\.neq\("payment_status", "abandoned"\)\s*\.order\("boosted_at", \{ ascending: false, nullsFirst: false \}\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.range\(offset, offset \+ PAGE_SIZE\)/);
    expect(dash).toMatch(/\.from\("helper_availability"\)\s*\.select\("day_of_week, is_available, start_time, end_time"\)\s*\.eq\("helper_id", userId\)\s*\.is\("specific_date", null\)\s*\.order\("day_of_week"\)/);
    expect(dash).toMatch(/\.from\("applications"\)\s*\.select\("job_id"\)\s*\.eq\("helper_id", userId\)/);
    expect(dash).toContain('supabase.rpc("get_public_platform_settings")');
    expect(dash).toContain('supabase.rpc("get_safe_profiles", { user_ids: posterIds })');
    expect(code("src/lib/userBlocks.ts")).toMatch(/\.from\("user_blocks"\)\s*\.select\("blocker_id, blocked_id"\)\s*\.or\(`blocker_id\.eq\.\$\{currentUserId\},blocked_id\.eq\.\$\{currentUserId\}`\)/);
    expect(code("src/lib/reviewStats.ts")).toMatch(/supabase\.rpc\("get_public_profile_stats", \{\s*p_user_ids: ids,?\s*\}\)/);
    expect(code("src/lib/crewSpots.ts")).toMatch(/\.from\("open_jobs_browse"\)\s*\.select\("id, crew_spots_open"\)\s*\.in\("id", \[\.\.\.jobIds\]\)/);
  });

  it("the entry starts it only for a member on /jobs, and only the entry's door imports the boot module", () => {
    const entry = code("src/entry.ts");
    expect(entry).toMatch(/if \(hasToken\(\) && \/\^\\\/\(declutter\(\\\/item\\\/\[\\w-\]\+\)\?\|home\|jobs\)\?\\\/\?\$\/\.test\(window\.location\.pathname\)\) \{\s*void signedInPrefetch\(\)/);
    expect(code("src/boot/signedInPrefetch.ts")).toContain("startJobsPrefetch(pathname);");
    expect(code("src/hooks/jobsPrefetchTake.ts")).toContain(`const KEY = "${JOBS_PREFETCH_KEY}";`);
    const importers = walkSource([resolve(ROOT, "src")])
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /(from ["']|import\(["'])(@\/boot|\.\/boot|\.\.?\/)[^"']*jobsPrefetch["']/.test(code(f.replace(ROOT + "/", ""))))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(importers).toEqual(["src/boot/signedInPrefetch.ts"]);
    // The feed query takes the first page only, and the context its four reads.
    const dash = code("src/hooks/useDashboardData.ts");
    expect(dash).toContain("feedPre = offset === 0 && user ? await takeJobsFeedPrefetch(user.id) : null;");
    expect(dash).toContain("const pre = await takeJobsCtxPrefetch(userId);");
    expect(dash).toContain("const postersPre = feedPre && coversPosters(feedPre, posterIds, crewIds) ? feedPre : null;");
  });

  it("fires nothing for a guest, another route, or a session about to expire", () => {
    const f = answering();
    vi.stubGlobal("fetch", f);
    vi.stubEnv("VITE_SUPABASE_URL", BASE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
    startJobsPrefetch("/jobs");
    expect(f, "guest").not.toHaveBeenCalled();
    signIn(30);
    startJobsPrefetch("/jobs");
    expect(f, "expiring session").not.toHaveBeenCalled();
    signIn();
    for (const p of ["/home", "/jobs/abc", "/", "/declutter"]) startJobsPrefetch(p);
    expect(f, "other routes").not.toHaveBeenCalled();
    expect(slot()).toBeUndefined();
  });

  it("hands the feed, its posters and the context over once, to the same member, with the token sent only to Supabase", async () => {
    signIn();
    const f = answering();
    vi.stubGlobal("fetch", f);
    startJobsPrefetch("/jobs/");
    const feed = await takeJobsFeedPrefetch(UID);
    expect(feed?.rows).toEqual(rows);
    expect(feed?.posterIds).toEqual(["p1", "p2"]);
    expect(feed?.crewIds).toEqual(["j2"]);
    expect(feed?.crew).toEqual([{ id: "j2", crew_spots_open: 1 }]);
    const ctx = await takeJobsCtxPrefetch(UID);
    expect(ctx?.fee).toEqual([{ helper_fee_percent: 12 }]);
    expect(await takeJobsFeedPrefetch(UID), "once").toBeNull();
    expect(await takeJobsCtxPrefetch(UID), "once").toBeNull();
    expect(slot(), "slot kept while one part is untaken").toBeDefined();
    for (const [u, init] of f.mock.calls) {
      expect(String(u).startsWith(`${BASE}/rest/v1/`)).toBe(true);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    }
    expect(await takeJobsMePrefetch(UID)).toEqual({ profile: { user_id: UID, full_name: "Me" }, isAdmin: false });
    // Feed + 4 context reads + 2 of the member's own + 3 poster reads.
    expect(f).toHaveBeenCalledTimes(10);
  });

  it("refuses another member, a stale answer, or an answer not in the read's shape", async () => {
    signIn();
    vi.stubGlobal("fetch", answering());
    startJobsPrefetch("/jobs");
    expect(await takeJobsFeedPrefetch("someone-else")).toBeNull();
    startJobsPrefetch("/jobs");
    expect(await takeJobsCtxPrefetch(UID, Date.now() + JOBS_PREFETCH_MAX_AGE_MS + 1)).toBeNull();

    vi.stubGlobal("fetch", answering({ feed: { not: "rows" }, blocks: "fail" }));
    startJobsPrefetch("/jobs");
    expect(await takeJobsFeedPrefetch(UID), "feed not rows").toBeNull();
    expect(await takeJobsCtxPrefetch(UID), "one context read failed: none handed over").toBeNull();

    // The posters' reads failed: the page alone is still handed over, without posters.
    vi.stubGlobal("fetch", answering({ profiles: "fail" }));
    startJobsPrefetch("/jobs");
    const feed = await takeJobsFeedPrefetch(UID);
    expect(feed).toEqual({ rows });
    expect(coversPosters(feed!, ["p1"], [])).toBe(false);
  });

  it("the member's own rows: admin only on a real admin row; anything odd reads as always", async () => {
    signIn();
    vi.stubGlobal("fetch", answering({ admin: [{ role: "admin" }] }));
    startJobsPrefetch("/jobs");
    expect((await takeJobsMePrefetch(UID))?.isAdmin).toBe(true);
    expect(await takeJobsMePrefetch(UID), "once").toBeNull();
    for (const over of [{ admin: "fail" }, { profile: "fail" }, { profile: [{ user_id: "other" }] }, { profile: [{ user_id: UID }, { user_id: UID }] }, { admin: { role: "admin" } }]) {
      vi.stubGlobal("fetch", answering(over));
      startJobsPrefetch("/jobs");
      expect(await takeJobsMePrefetch(UID), JSON.stringify(over)).toBeNull();
    }
    vi.stubGlobal("fetch", answering({ profile: [] }));
    startJobsPrefetch("/jobs");
    expect(await takeJobsMePrefetch(UID), "no profile row is null, as maybeSingle").toEqual({ profile: null, isAdmin: false });
    expect(await takeJobsMePrefetch("someone-else")).toBeNull();
  });

  it("uses the posters' answer only when it covers every id the query asks for", () => {
    const pre = { rows: [], posterIds: ["p1", "p2"], crewIds: ["j2"], profiles: [], stats: [], crew: [] };
    expect(coversPosters(pre, ["p1"], [])).toBe(true);
    expect(coversPosters(pre, ["p1", null as unknown as string], ["j2"])).toBe(true);
    expect(coversPosters(pre, ["p3"], [])).toBe(false);
    expect(coversPosters(pre, ["p1"], ["j9"])).toBe(false);
  });

  it("a prefetch still in flight never holds the query past its short wait", async () => {
    vi.useFakeTimers();
    (window as unknown as Record<string, unknown>)[JOBS_PREFETCH_KEY] = {
      at: Date.now(), userId: UID, feed: new Promise(() => {}), ctx: new Promise(() => {}),
    };
    const p = takeJobsFeedPrefetch(UID);
    await vi.advanceTimersByTimeAsync(3_001);
    expect(await p).toBeNull();
  });
});

// Inventory floor: the boot module builds at least the four first-round URLs.
it("jobsPrefetch builds every first-round URL", () => {
  expect(Object.keys(jobsFeedUrls(BASE, UID)).length).toBeGreaterThan(3);
});

describe("a link that opens on a list skips Browse's feed reads (B46, Q1158)", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("the rule is JobsSection's own, for every link shape", async () => {
    const { resolveJobsTab } = await import("@/pages/jobs/JobsSection");
    const links = ["", "?tab=posted", "?tab=working", "?tab=browse", "?tab=nonsense", "?job=a", "?filter=hired", "?highlight=a1",
      "?q=lawn", "?quotes=1", "?tab=browse&job=a", "?tab=posted&job=a", "?status=open", "?ref=email"];
    let lists = 0;
    for (const s of links) {
      const params = new URLSearchParams(s);
      const raw = params.get("tab");
      const page = resolveJobsTab(params, raw === "posted" || raw === "working" ? raw : "browse");
      if (page !== "browse") lists++;
      expect(jobsOpensOnList(s), `${s || "(none)"} draws ${page}`).toBe(page !== "browse");
    }
    expect(lists).toBeGreaterThan(5);
  }, 60_000);

  it("?tab=posted reads only the member's own rows; plain /jobs still reads the feed", async () => {
    signIn();
    const f = answering();
    vi.stubGlobal("fetch", f);
    window.history.replaceState(null, "", "/jobs?tab=posted");
    startJobsPrefetch("/jobs");
    await new Promise((r) => setTimeout(r, 0));
    const asked = f.mock.calls.map((c) => String(c[0]));
    expect(asked.some((u) => u.includes("/profiles"))).toBe(true);
    expect(asked.some((u) => u.includes("/open_jobs_browse") || u.includes("helper_availability") || u.includes("get_public_platform_settings"))).toBe(false);

    f.mockClear();
    window.history.replaceState(null, "", "/jobs");
    startJobsPrefetch("/jobs");
    await new Promise((r) => setTimeout(r, 0));
    expect(f.mock.calls.map((c) => String(c[0])).some((u) => u.includes("/open_jobs_browse"))).toBe(true);
  });
});
