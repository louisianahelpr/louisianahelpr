/**
 * speed7 (Builder 2, 11-15): signed-in /jobs drew its skeleton first and the cards only in a second render (~450 ms of
 * CPU at 4x on a phone), although the entry's reads (src/boot/jobsPrefetch.ts) had answered before the app's code
 * finished downloading. Now the three first-screen queries (useCurrentUser's "me", the dashboard context and the feed's
 * first page) take an answer ALREADY in hand as initialData, so the first draw has the cards.
 *
 * Held here: an answer that has arrived is readable during a render, once, only for its member and only while fresh;
 * one still in flight is not seeded; the feed seed is the same page the queryFn builds (blocked posters out, posters'
 * names in) and takes nothing when the posters' reads do not cover the page; each query really spreads its seed.
 */
// @mutate src/hooks/jobsPrefetchTake.ts |   take(part, userId, now); |
// @mutate src/hooks/jobsPrefetchTake.ts |   if (!s \|\| !s[part] \|\| !done \|\| now - s.at > JOBS_PREFETCH_MAX_AGE_MS \|\| s.userId !== userId) return undefined; |   if (!s \|\| !s[part] \|\| !done) return undefined;
// @mutate src/hooks/jobsPrefetchTake.ts |     s?.[part]?.then((value) => { settled[part] = { value }; }, () => undefined); |
// @mutate src/hooks/useDashboardData.ts |   if (rawJobs.length === 0 \|\| !coversPosters(pre, posterIds, crewIds)) return undefined; |   if (rawJobs.length === 0) return undefined;
// @mutate src/hooks/useDashboardData.ts |   const { rows: rawJobs, hasMore } = splitFeedPage(pre.rows as unknown as BrowseJobRow[], (j) => blockedUserIds.has(j.customer_id)); |   const { rows: rawJobs, hasMore } = splitFeedPage(pre.rows as unknown as BrowseJobRow[], () => false);
// @mutate src/hooks/useCurrentUser.ts |     ...seedFromSettledMe(user?.id), |
// @mutate src/hooks/useDashboardData.ts |     ...seedFromSettled((id) => takeSettledJobsCtx( |     ...((id: unknown) => ({}))((id: string) => takeSettledJobsCtx(
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const KEY = "__lhJobsPrefetch";
const UID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const w = window as unknown as Record<string, unknown>;

afterEach(() => {
  w[KEY] = undefined;
  vi.resetModules();
});

const job = (id: string, customer_id: string) => ({ id, customer_id, title: `Job ${id}`, is_group_job: false, date_needed: null, expires_at: null });
const feedAnswer = () => ({
  rows: [job("j1", "p1"), job("j2", "blocked")],
  posterIds: ["p1", "blocked"],
  crewIds: [],
  profiles: [{ user_id: "p1", full_name: "Pat Poster", avatar_url: null, subscription_tier: null }],
  stats: [],
  crew: [],
});
const ctxAnswer = () => ({ fee: [{ helper_fee_percent: 12 }], availability: [], applied: [], blocks: [{ blocker_id: UID, blocked_id: "blocked" }] });
const meAnswer = () => ({ profile: [{ user_id: UID, full_name: "Me" }], admin: [] });

/** Fill the entry's slot, then load the take module (its .then runs as it loads, as with the page's code). */
async function load(parts: Record<string, Promise<unknown>>, userId = UID, at = Date.now()) {
  w[KEY] = { at, userId, ...parts };
  const mod = await import("@/hooks/jobsPrefetchTake");
  await new Promise((r) => setTimeout(r, 0));
  return mod;
}

describe("an entry answer already in hand seeds the first render", () => {
  it("is handed out once, then the query's own take finds nothing", async () => {
    const m = await load({ me: Promise.resolve(meAnswer()) });
    const got = m.takeSettledJobsMe(UID);
    expect(got?.value).toEqual({ profile: { user_id: UID, full_name: "Me" }, isAdmin: false });
    expect(m.takeSettledJobsMe(UID)).toBeUndefined();
    expect(await m.takeJobsMePrefetch(UID)).toBeNull();
  });

  it("is never handed to another member, nor when stale", async () => {
    const m = await load({ me: Promise.resolve(meAnswer()) }, OTHER);
    expect(m.takeSettledJobsMe(UID)).toBeUndefined();
    vi.resetModules();
    const n = await load({ me: Promise.resolve(meAnswer()) }, UID, Date.now() - 60_000);
    expect(n.takeSettledJobsMe(UID)).toBeUndefined();
  });

  it("does not seed from an answer still in flight, and leaves it for the query", async () => {
    let answer: (v: unknown) => void = () => {};
    const m = await load({ me: new Promise((r) => { answer = r; }) });
    expect(m.takeSettledJobsMe(UID)).toBeUndefined();
    answer(meAnswer());
    expect((await m.takeJobsMePrefetch(UID))?.profile).toEqual({ user_id: UID, full_name: "Me" });
  });

  it("takes nothing when the user of the answer refuses it", async () => {
    const m = await load({ feed: Promise.resolve(feedAnswer()) });
    expect(m.takeSettledJobsFeed(UID, () => undefined)).toBeUndefined();
    expect((await m.takeJobsFeedPrefetch(UID))?.rows).toHaveLength(2);
  });
});

describe("the feed seed is the page the query would build", () => {
  async function seeded(feed: unknown) {
    const m = await load({ feed: Promise.resolve(feed), ctx: Promise.resolve(ctxAnswer()) });
    const { contextFromRows, seedFeedPage } = await import("@/hooks/useDashboardData");
    const c = ctxAnswer();
    const ctx = m.takeSettledJobsCtx(UID, (x) => contextFromRows(UID, x.fee as never, x.availability as never, x.applied as never, x.blocks as never));
    expect(ctx?.value.blockedUserIds).toEqual(new Set([c.blocks[0].blocked_id]));
    return { m, page: m.takeSettledJobsFeed(UID, (pre) => seedFeedPage(pre, ctx!.value.blockedUserIds))?.value };
  }

  it("drops blocked posters and joins the posters' names", async () => {
    const { page } = await seeded(feedAnswer());
    expect(page?.jobs.map((j) => j.id)).toEqual(["j1"]);
    expect(page?.jobs[0].posterName).toBe("Pat P.");
    expect(page?.nextOffset).toBeNull();
  });

  it("seeds nothing, and leaves the answer for the query, when the posters' reads do not cover the page", async () => {
    const { m, page } = await seeded({ ...feedAnswer(), posterIds: ["blocked"] });
    expect(page).toBeUndefined();
    expect(await m.takeJobsFeedPrefetch(UID)).not.toBeNull();
  });
});

describe("each first-screen query spreads its seed", () => {
  it("useCurrentUser, the context and the feed", () => {
    const user = code("src/hooks/useCurrentUser.ts");
    const dash = code("src/hooks/useDashboardData.ts");
    expect(user).toMatch(/useQuery\(\{[\s\S]*?\.\.\.seedFromSettledMe\(user\?\.id\),[\s\S]*?\}\);/);
    expect(dash).toMatch(/\.\.\.seedFromSettled\(\(id\) => takeSettledJobsCtx\(/);
    expect(dash).toMatch(/\.\.\.seedFromSettled\(\(id\) => \{[\s\S]*?takeSettledJobsFeed\(id, \(pre\) => seedFeedPage\(pre, ctxNow\.blockedUserIds\)\)/);
    const seeds = (dash.match(/\.\.\.seedFromSettled\(/g) ?? []).length;
    expect(seeds).toBeGreaterThan(1);
  });
});
