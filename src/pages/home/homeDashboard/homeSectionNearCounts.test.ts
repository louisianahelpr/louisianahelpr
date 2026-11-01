/**
 * Owner request 2026-11-01 (via the lead): Home's "Your sections" cards get live counts. Jobs keeps "N need you" when
 * something needs the member, otherwise "N open near you"; Declutter says "N items near you"; a 0 keeps the current
 * line. The counts are head-only count reads with Browse's own rules, loaded after Home's first paint.
 *
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts | const jobsNear = jobTodos === 0 && (near.jobs ?? 0) > 0 ? | const jobsNear = (near.jobs ?? 0) > 0 ?
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts | const declutterNear = (near.declutter ?? 0) > 0 ? | const declutterNear = near.declutter !== undefined ?
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |     enabled: !!uid && settled && !applied.loading, |     enabled: !!uid && !applied.loading,
 * @mutate src/pages/home/homeDashboard/sectionNearCounts.ts |     .neq("seller_id", userId); |     ;
 * @mutate src/pages/home/homeDashboard/sectionNearCounts.ts |     .select("id", { count: "exact", head: true }) |     .select("id")
 * @mutate src/pages/home/homeDashboard/sectionNearCounts.ts |     appliedJobIds: [...appliedJobIds].sort(), |     appliedJobIds: [],
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const calls = vi.hoisted(() => [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>);
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const rec = { table, ops: [] as Array<[string, unknown[]]> };
    calls.push(rec);
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "neq", "or", "lte", "not", "in", "eq", "gte", "gt"]) {
      chain[op] = (...args: unknown[]) => {
        rec.ops.push([op, args]);
        return chain;
      };
    }
    chain.then = (res: (v: unknown) => unknown) => res({ data: null, error: null, count: 7, status: 200 });
    return chain;
  };
  return { supabase: { from } };
});

const { sectionCardLines } = await import("./useHomeSummary");
const { fetchDeclutterNearCount, fetchOpenJobsNearCount } = await import("./sectionNearCounts");

const ROOT = resolve(__dirname, "../../../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const UID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
});

describe("Home's section cards: live near-you counts (owner 2026-11-01)", () => {
  const current = { jobs: "Hire help or find work", declutter: "Sell or find a deal" };

  it("Jobs says N open near you when nothing needs the member", () => {
    expect(sectionCardLines(current, 0, { jobs: 12 }).jobs).toBe("12 open near you");
  });

  it("Jobs keeps its need-you line when something needs the member", () => {
    expect(sectionCardLines({ ...current, jobs: "2 need you" }, 2, { jobs: 12 }).jobs).toBe("2 need you");
  });

  it("Declutter says N items near you (one item reads singular)", () => {
    expect(sectionCardLines(current, 0, { declutter: 9 }).declutter).toBe("9 items near you");
    expect(sectionCardLines(current, 0, { declutter: 1 }).declutter).toBe("1 item near you");
  });

  it("a 0 or a count not in yet keeps the current line, so a card never looks empty", () => {
    expect(sectionCardLines(current, 0, { jobs: 0, declutter: 0 })).toEqual(current);
    expect(sectionCardLines(current, 0, {})).toEqual(current);
  });

  it("the Declutter count is a head-only read of what Browse lists, minus the member's own", async () => {
    await expect(fetchDeclutterNearCount(UID)).resolves.toBe(7);
    const [c] = calls;
    expect(c.table).toBe("declutter_items");
    expect(c.ops).toContainEqual(["select", ["id", { count: "exact", head: true }]]);
    expect(c.ops).toContainEqual(["in", ["status", ["live", "reserved"]]]);
    expect(c.ops).toContainEqual(["neq", ["seller_id", UID]]);
  });

  it("the Jobs count is Browse's own head-only read, without the member's posts, applied or dismissed jobs", async () => {
    localStorage.setItem("helpr_dismissed_jobs", JSON.stringify(["d1"]));
    await expect(fetchOpenJobsNearCount(UID, ["a2", "a1"])).resolves.toBe(7);
    const [c] = calls;
    expect(c.table).toBe("open_jobs_browse");
    expect(c.ops).toContainEqual(["select", ["id", { count: "exact", head: true }]]);
    expect(c.ops).toContainEqual(["neq", ["customer_id", UID]]);
    expect(c.ops).toContainEqual(["not", ["id", "in", "(a1,a2)"]]);
    expect(c.ops).toContainEqual(["not", ["id", "in", "(d1)"]]);
  });

  it("the counts wait for the page to settle and load with their own module (not Home's first screen)", () => {
    const src = code("src/pages/home/homeDashboard/useHomeSummary.ts");
    expect(src).toMatch(/const nearCountsApi = \(\) => loadModule\(\(\) => import\("\.\/sectionNearCounts"\)\)/);
    expect(src).not.toMatch(/^import[^\n]*sectionNearCounts/m);
    const enabled = [...src.matchAll(/enabled: !!uid && settled\b/g)];
    expect(enabled.length).toBe(2);
    // The line keeps two lines' room, so the count replacing it does not move the page.
    expect(code("src/pages/home/HomeDashboard.tsx")).toMatch(/data-tile-line[^>]*min-h-\[2\.75em\]/);
  });
});
