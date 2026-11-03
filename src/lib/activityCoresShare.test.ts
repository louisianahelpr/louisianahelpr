/**
 * B46 (11-03, Q1158): one get_my_activity_cores answer serves BOTH cores (Posted and Working) when they ask moments
 * apart, not only while the read is in flight. Measured (cwv-lab, signed in, 375, cold /jobs?tab=posted): the first
 * read answered at 7.48 s and the other core asked 0.2 s later, so the whole payload was fetched twice.
 *
 * What must still hold: a part that already took an answer and asks again is REFETCHING (after an action) and reads
 * afresh; another member never gets the answer; it is shared only for ACTIVITY_CORES_SHARE_MS; a failed read (null)
 * is never handed on.
 */
// @mutate src/lib/activityCores.ts |   if (inFlight?.userId === userId && !(part && inFlight.served.has(part))) { |   if (inFlight?.userId === userId) {
// @mutate src/lib/activityCores.ts |     const fresh = inFlight.doneAt === null \|\| Date.now() - inFlight.doneAt <= ACTIVITY_CORES_SHARE_MS; |     const fresh = inFlight.doneAt === null;
// @mutate src/lib/activityCores.ts |     const fresh = inFlight.doneAt === null \|\| Date.now() - inFlight.doneAt <= ACTIVITY_CORES_SHARE_MS; |     const fresh = true;
// @mutate src/lib/activityCores.ts |     else inFlight = null; |
// @mutate src/hooks/useActivityData.ts |   const cores = await fetchActivityCores(userId, "applied"); |   const cores = await fetchActivityCores(userId, "posted");
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { ACTIVITY_CORES_SHARE_MS, fetchActivityCores, forgetActivityCoresRead } from "./activityCores";

const PAYLOAD = {
  posted_jobs: [], poster_applications: [], offer_targets: [], my_applications: [],
  application_jobs: [], direct_offers: [], violations: [], reviews: [],
};
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

beforeEach(() => {
  forgetActivityCoresRead();
  rpc.mockReset();
  rpc.mockImplementation(async () => ({ data: PAYLOAD, error: null }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("one cores answer serves both cores (B46, Q1158)", () => {
  it("the other core asking just after the answer landed reuses it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await fetchActivityCores(A, "posted");
    vi.setSystemTime(Date.now() + 200);
    expect(await fetchActivityCores(A, "applied")).toEqual(PAYLOAD);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("a part asking again is a refetch and reads afresh", async () => {
    await fetchActivityCores(A, "posted");
    await fetchActivityCores(A, "posted");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("past the share window the other core reads afresh", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await fetchActivityCores(A, "posted");
    vi.setSystemTime(Date.now() + ACTIVITY_CORES_SHARE_MS + 1);
    await fetchActivityCores(A, "applied");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("another member never gets the answer", async () => {
    await fetchActivityCores(A, "posted");
    await fetchActivityCores(B, "applied");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("a failed read is never handed on", async () => {
    rpc.mockImplementationOnce(async () => ({ data: null, error: { code: "PGRST202", message: "x" } }));
    expect(await fetchActivityCores(A, "posted")).toBeNull();
    expect(await fetchActivityCores(A, "applied")).toEqual(PAYLOAD);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("both cores are still joined while the read is in flight", async () => {
    const [p, a] = await Promise.all([fetchActivityCores(A, "posted"), fetchActivityCores(A, "applied")]);
    expect(p).toBe(a);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("the two fetchers name their own part", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../hooks/useActivityData.ts"), "utf8"));
    const posted = src.slice(src.indexOf("export async function fetchPostedActivity("));
    const applied = src.slice(src.indexOf("export async function fetchAppliedActivity("));
    expect(posted.length).toBeGreaterThan(1000);
    expect(posted.slice(0, 1500)).toMatch(/fetchActivityCores\(userId, "posted"\)/);
    expect(applied.slice(0, 1500)).toMatch(/fetchActivityCores\(userId, "applied"\)/);
  });
});
