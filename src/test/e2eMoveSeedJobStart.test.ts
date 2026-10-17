// @mutate e2e/moveSeedJobStart.ts | &is_seed=eq.true&select=id,is_seed | &select=id,is_seed
// @mutate e2e/moveSeedJobStart.ts | rows[0].id !== jobId \|\| rows[0].is_seed !== true | rows[0].id !== jobId
// @mutate e2e/moveSeedJobStart.ts | const ZONE = "America/Chicago"; | const ZONE = "UTC";
// @mutate e2e/journeys/04-admin-safety.spec.ts | const slot = slotAhead(20); | const slot = slotAhead(4);
// @mutate e2e/journeys/04-admin-safety.spec.ts | await expect(progress, `${jobTitle}'s card did not open when its heading was clicked`).toBeVisible({ timeout: 30_000 }); | void progress;
// @mutate e2e/journeys/04-admin-safety.spec.ts | startAt = await moveSeedJobStart(SUPABASE_URL, jobId, 90_000, "the no-show job"); | startAt = slot.at;

/*
 * The no-show journey (04-admin-safety J11) hires on a job 20+ minutes out,
 * because accept_application refuses a hire within 15 minutes of the start
 * (job_starts_too_soon; e2e-journeys 39071660168 died on it at
 * accept_application). It then moves the start to ~90 s ahead with
 * e2e/moveSeedJobStart.ts, a harness concession like ageJobPastEarlyAccess.
 * The 15-minute rule itself is proven by
 * src/test/pglite/offerDeadlineBeforeStart.pglite.mjs and is untouched here.
 *
 * This guard holds the concession to a test-owned row (the PATCH is filtered
 * on is_seed, must match exactly one row, and that row must come back
 * is_seed), to Louisiana's clock, and holds the journey to hiring OUTSIDE
 * the 15-minute window and moving the start only after the hire.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { moveSeedJobStart, louisianaSlot } from "../../e2e/moveSeedJobStart";

const ROOT = join(__dirname, "..", "..");
const SPEC = "e2e/journeys/04-admin-safety.spec.ts";
const JOB = "job-1";

type Call = { url: string; init: RequestInit };
let calls: Call[];
let answer: unknown[];

beforeEach(() => {
  calls = [];
  answer = [{ id: JOB, is_seed: true }];
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("moveSeedJobStart only ever moves one is_seed job, on Louisiana's clock", () => {
  it("PATCHes that one job, filtered on is_seed, as the service role, to the next whole minute 90 s out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T21:40:10Z")); // 4:40:10 PM CDT
    const at = await moveSeedJobStart("https://x.supabase.co/", JOB, 90_000);
    expect(at.toISOString()).toBe("2026-10-17T21:42:00.000Z");
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/rest/v1/jobs");
    expect(u.searchParams.get("id")).toBe(`eq.${JOB}`);
    expect(u.searchParams.get("is_seed")).toBe("eq.true");
    expect(calls[0].init.method).toBe("PATCH");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer service-key");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ date_needed: "2026-10-17", start_time: "16:42:00" });
  });

  it("refuses when no row, two rows, or a non-seed row comes back", async () => {
    for (const rows of [[], [{ id: JOB, is_seed: true }, { id: "job-2", is_seed: true }], [{ id: JOB, is_seed: false }]]) {
      answer = rows;
      await expect(moveSeedJobStart("https://x.supabase.co", JOB)).rejects.toThrow(/want exactly one is_seed job/);
    }
  });

  it("reads the day and time in Louisiana, across midnight UTC", () => {
    expect(louisianaSlot(new Date("2026-10-18T03:30:00Z"))).toEqual({ isoDay: "2026-10-17", hhmm: "22:30" });
  });
});

describe("the no-show journey hires outside the 15-minute window, then moves the start", () => {
  const src = blankComments(readFileSync(join(ROOT, SPEC), "utf8"));
  const body = src.slice(src.indexOf('title("no-show"'));

  it("posts its job at least 16 minutes out, and moves the start only after the hire completes", () => {
    const sites = [...src.matchAll(/moveSeedJobStart\s*\(/g)];
    expect(sites.length).toBeGreaterThan(0);
    const m = /const slot = slotAhead\((\d+)\)/.exec(body);
    expect(m, "J11 posts its job with slotAhead(n)").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(16);
    const hire = body.indexOf("rpc/accept_job_offer");
    const move = body.indexOf("moveSeedJobStart(");
    expect(hire).toBeGreaterThan(0);
    expect(move, "the start moves after the Helpr's accept, never before the hire").toBeGreaterThan(hire);
  });

  it("opens the card (its Job progress rail visible) before looking for No-Show: a shut card has no chips (e2e-journeys 39073227265)", () => {
    const open = src.slice(src.indexOf("async function openCard("));
    const fnBody = open.slice(0, open.indexOf("\n}\n") + 2);
    expect(fnBody.length).toBeGreaterThan(40);
    expect(fnBody).toMatch(/getByRole\("group", \{ name: \/Job progress\/ \}\)/);
    expect(fnBody).toMatch(/expect\(progress[^)]*\)\.toBeVisible\(/);
  });
});
