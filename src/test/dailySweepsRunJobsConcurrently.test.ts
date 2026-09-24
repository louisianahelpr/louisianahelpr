/**
 * The daily per-job sweeps finish inside pg_net's 30s budget.
 *
 * review-nag-cron and stalled-completion-reminder walked their jobs one at a
 * time, three REST round trips each (~1–3s per job on prod, edge_logs
 * 2026-09-23 16:26Z), and both logged "Cron HTTP timeout ... 30000 ms"
 * (ledger 0813c5f8, 25d66912). Each now runs its jobs through
 * forEachBounded; this checks the helper really overlaps work, visits every
 * item, and that neither sweep has gone back to a serial loop.
 */
// @mutate supabase/functions/_shared/forEachBounded.ts | Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker) | [worker()]
// @mutate supabase/functions/review-nag-cron/index.ts |     await forEachBounded(jobs, SWEEP_CONCURRENCY, async (job) => { |     await forEachBounded(jobs, 1, async (job) => {
// @mutate supabase/functions/stalled-completion-reminder/index.ts |     await forEachBounded(scan.rows, SWEEP_CONCURRENCY, async (job) => { |     await forEachBounded(scan.rows, 1, async (job) => {
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forEachBounded, SWEEP_CONCURRENCY } from "../../supabase/functions/_shared/forEachBounded";

const ROOT = join(__dirname, "..", "..");
const SWEEPS = ["review-nag-cron", "stalled-completion-reminder"];

describe("daily sweeps run their jobs concurrently", () => {
  it("forEachBounded overlaps work up to the limit and visits every item once", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    const items = Array.from({ length: 20 }, (_, i) => i);
    await forEachBounded(items, 4, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(i);
      inFlight--;
    });
    expect(peak).toBe(4);
    expect(seen.sort((a, b) => a - b)).toEqual(items);
    await expect(forEachBounded([1], 4, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await forEachBounded([], 4, async () => { throw new Error("never"); });
  });

  it("the shared limit overlaps work and both timed-out sweeps use it", () => {
    expect(SWEEP_CONCURRENCY).toBeGreaterThan(1);
    expect(SWEEPS.length).toBeGreaterThan(1);
    for (const fn of SWEEPS) {
      const src = readFileSync(join(ROOT, "supabase/functions", fn, "index.ts"), "utf8");
      expect(src, `${fn} walks its jobs serially again`).toMatch(/await forEachBounded\([\w.]+, SWEEP_CONCURRENCY, async \(job\) => \{/);
      expect(src, `${fn} has a serial per-job loop`).not.toMatch(/for \(const job of /);
    }
  });
});
