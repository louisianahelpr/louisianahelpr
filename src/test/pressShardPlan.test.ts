/**
 * The press shards are planned by MEASURED cost, and the plan fits every leg's
 * 45-minute budget with margin (lead ruling 2026-10-17).
 *
 * press-every-control 39014836855 (2026-10-17) failed leg 6 on its time budget
 * alone: shard 11 "47 row(s) not reached", shard 12 spent its whole leg on
 * /admin?view=marketing + /admin?view=social (284 found, 186 pressed). Same on
 * 38536821617 (10-14, leg 6: 18 + 1 not reached). Measured from both runs'
 * artifacts (scripts/audit/press-row-times.mjs -> press-row-times.json):
 *   - 67.9 / 62.4 min of shard time went on rows handed on and walked again
 *     from the start, because the queue was claimed in App.tsx order;
 *   - 314.5 / 370.6 of 543 min went waiting on a half-ceiling each shard held
 *     alone (pressSharedCeiling.test.ts covers the shared meter);
 *   - /admin?view=social needs 50 min of work unthrottled, over one shard.
 * The plan (pressShardPlan.mjs) splits rows over PART_CAP_MIN into parts, packs
 * units by the pacing model, and the harness walks each shard's own units
 * first. Modelled leg time with the slower of the two nights per row: 38.7 min
 * (86% of 45); with 10-17 alone 30.6, with 10-14 alone 34.0.
 *
 * This guard fails when:
 *   - any leg's modelled minutes (measured work, plus the leg's metered requests
 *     at the shared ceiling's usable rate) pass PLAN_BUDGET_MIN x PLAN_MARGIN;
 *   - PLAN_BUDGET_MIN, PLAN_SHARDS or the two-shard legs disagree with the workflow;
 *   - a unit is longer than a part may be, or two parts of a row share a leg;
 *   - the harness stops walking the plan's order, fitting units to the time
 *     left, or pressing only its part's controls.
 *
 * @mutate scripts/audit/pressShardPlan.mjs |     const parts = work > partCapMin ? Math.ceil(work / partCapMin) : 1; |     const parts = 1;
 * @mutate scripts/audit/pressShardPlan.mjs |       if (!pick \|\| after < pick.after \|\| (after === pick.after && b.minutes < pick.bin.minutes)) pick = { bin: b, after }; |       if (!pick \|\| after > pick.after) pick = { bin: b, after };
 * @mutate scripts/audit/pressShardPlan.mjs |   return [...legs.values()].map((l) => ({ ...l, paced: l.req / rate, minutes: Math.max(l.work, l.req / rate) })); |   return [...legs.values()].map((l) => ({ ...l, paced: l.req / rate, minutes: l.work }));
 * @mutate scripts/audit/pressShardPlan.mjs |         if (bins.some((o) => legOf(o.shard, width) === leg && o.units.some((x) => rowOf(x) === rowOf(u)))) continue; |         void leg;
 * @mutate scripts/audit/pressShardPlan.mjs |   return estMin * 60_000 <= budgetMs - elapsedMs; |   return true;
 * @mutate scripts/audit/press-every-control.mjs |         const queue = (await enumerate("page")).filter((_, i) => inPart(i, unit.part, unit.parts)).map((c) => | const queue = (await enumerate("page")).map((c) =>
 * @mutate scripts/audit/press-every-control.mjs |     ? shardWalkOrder(shardPlan, shardNo, { lastWave: LAST_WAVE }) |     ? shardPlan.units
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import * as harness from "../../scripts/audit/press-every-control.mjs";
import {
  PART_CAP_MIN, PART_OVERHEAD_MIN, PLAN_BUDGET_MIN, PLAN_MARGIN, PLAN_SHARDS, PLAN_WAVE_WIDTH,
  inPart, legMinutes, legRatePerMin, loadRowTimes, planShards, rowCost, shardWalkOrder, unitFits,
  type PlanRow, type RowTimes,
} from "../../scripts/audit/pressShardPlan.mjs";
import { budgetFor } from "../../scripts/e2e/request-budget.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const CEILING = budgetFor(JSON.parse(read("e2e/request-budgets.json")).budgets, "press-every-control").ceilingPerMinute as number;
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

type Route = { url: string; personas: string[]; redirect: boolean };
/** The rows a real run walks: the harness's own route set, five job rows as the run resolves. */
function realRows(): PlanRow[] {
  const h = harness as unknown as { deriveRouteSet: (o: unknown) => Route[]; parseAdminViews: () => string[] };
  const jobIds = [1, 2, 3, 4, 5].map(id);
  const set = h.deriveRouteSet({ seedJobId: jobIds[0], jobIds, helperId: id(6), customerId: id(7), adminViews: h.parseAdminViews() });
  return set.flatMap((r, routeIdx) => (r.redirect
    ? [{ routeIdx, url: r.url, persona: "-", redirect: true }]
    : r.personas.map((persona) => ({ routeIdx, url: r.url, persona, redirect: false }))));
}

describe("press shards are planned by measured cost (lead ruling 2026-10-17)", () => {
  const times = loadRowTimes();
  const rows = realRows();
  const plan = planShards({ rows, times, ceilingPerMinute: CEILING });
  const legs = legMinutes(plan, { ceilingPerMinute: CEILING });

  it("every leg's modelled time fits its budget with margin", () => {
    expect(rows.length).toBeGreaterThan(200);
    expect(legs).toHaveLength(PLAN_SHARDS / PLAN_WAVE_WIDTH);
    for (const l of legs) expect(l.minutes, `leg ${l.leg} (shards ${l.shards.join(",")}): work ${l.work.toFixed(1)}, ${Math.round(l.req)} requests`).toBeLessThanOrEqual(PLAN_BUDGET_MIN * PLAN_MARGIN);
    expect(PLAN_MARGIN).toBeLessThan(1);
  });

  it("the times are measured, from the runs named, for nearly every row", () => {
    expect(times.measuredFrom.map((m) => m.run)).toEqual(expect.arrayContaining(["39014836855", "38536821617"]));
    const walked = rows.filter((r) => !r.redirect);
    const measured = walked.filter((r) => rowCost(times, r.url, r.persona).measured).length;
    expect(measured).toBeGreaterThan(walked.length * 0.9);
    // A row never measured costs the median row, never nothing.
    expect(times.default.work).toBeGreaterThan(0);
    expect(times.default.req).toBeGreaterThan(0);
  });

  it("the pacing model charges a leg its requests at the shared ceiling's usable rate", () => {
    const synthetic: RowTimes = { measuredFrom: [], default: { work: 1, req: 10 }, rows: { "/a|admin": { min: 1, work: 1, req: legRatePerMin(CEILING) * 30 } } };
    const p = planShards({ rows: [{ routeIdx: 0, url: "/a", persona: "admin", redirect: false }], times: synthetic, ceilingPerMinute: CEILING });
    const l = legMinutes(p, { ceilingPerMinute: CEILING }).find((x) => x.req > 0)!;
    expect(l.minutes).toBeCloseTo(30, 5); // 1 min of work, 30 min of requests
  });

  it("matches the workflow: one budget, 12 shards, two side by side per leg", () => {
    const wf = read(".github/workflows/press-every-control.yml");
    const budgets = [...wf.matchAll(/TIME_BUDGET_MIN: "(\d+)"/g)].map((m) => Number(m[1]));
    expect(budgets.length).toBe(PLAN_SHARDS / PLAN_WAVE_WIDTH);
    for (const b of budgets) expect(b).toBe(PLAN_BUDGET_MIN);
    const waves = [...wf.matchAll(/run: bash scripts\/audit\/press-wave\.sh ([\d ]+)/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
    expect(waves.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: PLAN_SHARDS }, (_, i) => i + 1));
    for (const w of waves) {
      expect(w).toHaveLength(PLAN_WAVE_WIDTH);
      expect(new Set(w.map((s) => Math.ceil(s / PLAN_WAVE_WIDTH))).size).toBe(1); // a wave is one planned leg
    }
    expect(parse(wf)).toBeTruthy();
  });

  it("no unit is longer than a part may be, and no two parts of one row share a leg", () => {
    for (const u of plan.units) expect(u.est, `${u.url} ${u.persona} ${u.part}/${u.parts}`).toBeLessThanOrEqual(Math.max(PART_CAP_MIN + PART_OVERHEAD_MIN, rowCost(times, u.url, u.persona).work));
    const split = plan.units.filter((u) => u.parts > 1);
    expect(split.length).toBeGreaterThan(0); // /admin?view=social is split today
    const seen = new Set<string>();
    for (const u of split) {
      const k = `${u.routeIdx}-${u.persona}-leg${Math.ceil(u.shard! / PLAN_WAVE_WIDTH)}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
    // Parts press disjoint controls that together cover the page.
    const covered = Array.from({ length: 30 }, (_, i) => [1, 2, 3].filter((p) => inPart(i, p, 3)).length);
    expect(covered.every((n) => n === 1)).toBe(true);
  });

  it("a shard walks its own units first, then other shards' whole rows; parts stay with their shard until the last wave", () => {
    const order = shardWalkOrder(plan, 3, { lastWave: false });
    const own = plan.bins[2].units.length;
    expect(order.slice(0, own).every((u) => u.shard === 3)).toBe(true);
    expect(order.slice(own).every((u) => u.shard !== 3 && u.parts === 1)).toBe(true);
    expect(shardWalkOrder(plan, 3, { lastWave: true }).length).toBe(plan.units.length);
  });

  it("an earlier wave claims nothing it cannot finish; the last wave claims everything", () => {
    expect(unitFits({ estMin: 10, elapsedMs: 30 * 60_000, budgetMs: 45 * 60_000, lastWave: false })).toBe(true);
    expect(unitFits({ estMin: 20, elapsedMs: 30 * 60_000, budgetMs: 45 * 60_000, lastWave: false })).toBe(false);
    expect(unitFits({ estMin: 20, elapsedMs: 30 * 60_000, budgetMs: 45 * 60_000, lastWave: true })).toBe(true);
  });

  it("the harness walks the plan, fits each unit to the time left, and presses only its part", () => {
    const src = blankComments(read("scripts/audit/press-every-control.mjs"));
    expect(src).toContain("? shardWalkOrder(shardPlan, shardNo, { lastWave: LAST_WAVE })");
    expect(src).toContain("for (const unit of walkUnits) {");
    const claim = src.indexOf("if (!claimRow({ dir: QUEUE_DIR, key: rowKey })) { claimedElsewhere += 1; continue; }");
    const fits = src.indexOf("if (!unitFits({ estMin: Math.max(unit.est, unit.req / (legRatePerMin(LOAD_CEILING) / WAVE_WIDTH)), elapsedMs: Date.now() - runStart, budgetMs: TIME_BUDGET_MS, lastWave: LAST_WAVE })) continue;");
    expect(fits).toBeGreaterThan(0);
    expect(fits).toBeLessThan(claim); // decided before the row is claimed, so it stays claimable
    expect(src).toContain('const queue = (await enumerate("page")).filter((_, i) => inPart(i, unit.part, unit.parts)).map((c) =>');
    expect(src).toContain("const rowKey = unit.key;");
  });
});
