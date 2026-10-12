/**
 * GUARD (Q1321): the Supabase PERFORMANCE advisor is held to an EXACT
 * per-class baseline (scripts/ci/performance-advisor-baseline.json) by
 * scripts/check-performance-advisor.mjs, so a new unused index or a new
 * overlapping permissive policy fails, and a fix that lowers a class without
 * lowering its baseline fails too. This file proves the check can fail in
 * both directions, on the repo's real baseline file.
 *
 * Measured 2026-10-12 19:32Z with get_advisors (performance): unused_index
 * 119, multiple_permissive_policies 46 (32 once
 * 20261012193325_fold_redundant_permissive_policies deploys: it folds 14,
 * permission matrix unchanged in src/test/pglite/foldPermissivePolicies.pglite.mjs),
 * auth_db_connections_absolute 1.
 */
// @mutate scripts/check-performance-advisor.mjs |     else if (n < b) out.under.push( |     else if (false) out.under.push(
// @mutate scripts/check-performance-advisor.mjs |     else if (n > b) out.over.push( |     else if (false) out.over.push(
// @mutate scripts/check-performance-advisor.mjs |     if (b === undefined) out.over.push( |     if (false) out.over.push(
// @mutate scripts/check-performance-advisor.mjs |     if (!(name in counts) && b > 0) out.under.push( |     if (false) out.under.push(
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

type Lint = { name: string; level?: string; findings?: { metadata?: Record<string, unknown> }[]; count?: number };
type Baseline = { counts: Record<string, number>; measured: string; note: string };
type Result = { over: string[]; under: string[]; total: number };
type Mod = {
  loadBaseline: () => Baseline;
  lintsOf: (b: unknown) => Lint[];
  countsOf: (l: Lint[]) => Record<string, number>;
  compare: (c: Record<string, number>, b: Baseline) => Result;
};
const load = async () => (await import(/* @vite-ignore */ resolve(__dirname, "../../scripts/check-performance-advisor.mjs"))) as Mod;

/** An advisor run that reports exactly the baseline. */
const runAt = (counts: Record<string, number>): Lint[] =>
  Object.entries(counts).map(([name, n]) => ({ name, findings: Array.from({ length: n }, (_, i) => ({ metadata: { name: `x${i}` } })) }));

describe("performance advisor baseline (Q1321): exact per class, both directions", () => {
  it("the baseline is the real measurement, not an empty file (floor)", async () => {
    const b = (await load()).loadBaseline();
    expect(b.counts.unused_index).toBeGreaterThan(50);
    expect(b.counts.multiple_permissive_policies).toBeGreaterThan(10);
    expect(b.measured).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("a run at the baseline passes", async () => {
    const m = await load();
    const b = m.loadBaseline();
    const r = m.compare(m.countsOf(runAt(b.counts)), b);
    expect(r.over).toEqual([]);
    expect(r.under).toEqual([]);
    expect(r.total).toBe(Object.values(b.counts).reduce((s, n) => s + n, 0));
  });

  it("one more finding in a class fails as OVER; one fewer fails as UNDER", async () => {
    const m = await load();
    const b = m.loadBaseline();
    const more = m.compare(m.countsOf(runAt({ ...b.counts, multiple_permissive_policies: b.counts.multiple_permissive_policies + 1 })), b);
    expect(more.over).toEqual([expect.stringMatching(/^multiple_permissive_policies: .* \(\+1\)$/)]);
    const fewer = m.compare(m.countsOf(runAt({ ...b.counts, unused_index: b.counts.unused_index - 1 })), b);
    expect(fewer.under).toEqual([expect.stringMatching(/^unused_index: .*lower the baseline$/)]);
  });

  it("a class the baseline does not name fails; a named class that vanished fails", async () => {
    const m = await load();
    const b = m.loadBaseline();
    const extra = m.compare(m.countsOf(runAt({ ...b.counts, unindexed_foreign_keys: 2 })), b);
    expect(extra.over).toEqual([expect.stringMatching(/^unindexed_foreign_keys: 2 finding\(s\), a class the baseline does not name$/)]);
    const { auth_db_connections_absolute: _gone, ...rest } = b.counts;
    void _gone;
    const missing = m.compare(m.countsOf(runAt(rest)), b);
    expect(missing.under).toEqual([expect.stringMatching(/^auth_db_connections_absolute: 0 finding/)]);
  });

  it("reads both result shapes, and a lint that only carries a count", async () => {
    const m = await load();
    expect(m.lintsOf({ result: { lints: [] } })).toEqual([]);
    expect(m.lintsOf({ lints: [{ name: "a" }] })).toHaveLength(1);
    expect(() => m.lintsOf({})).toThrow();
    expect(m.countsOf([{ name: "auth_db_connections_absolute", count: 1 }, { name: "unused_index", findings: [{}, {}] }])).toEqual({
      auth_db_connections_absolute: 1,
      unused_index: 2,
    });
  });
});
