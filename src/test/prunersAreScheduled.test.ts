/**
 * CLASS GUARD (Q167): every cleanup_/prune_/sweep_ function is actually run.
 *
 * THE BUG (measured on prod, 2026-09-23): cleanup_stripe_webhook_events() and
 * cleanup_observability_tables() existed with no cron.job, trigger or caller,
 * while three webhook functions said events "prune at 30 days". 9 webhook rows
 * and 221 analytics rows sat past their windows. Fixed by
 * 20260923143321_schedule_unscheduled_pruners.sql.
 *
 * THE CLASS, from the migrations: every function named cleanup_*, prune_* or
 * sweep_* that no later migration drops must appear inside some
 * cron.schedule(...) call, or be listed in MANUAL with its reason. Two-way:
 * a MANUAL entry that is scheduled, or no longer defined, fails too.
 *
 * @mutate supabase/migrations/20260923143321_schedule_unscheduled_pruners.sql | PERFORM cron.schedule('cleanup-stripe-webhook-events', | PERFORM cron.unschedule_x('cleanup-stripe-webhook-events',
 * @mutate supabase/migrations/20260925231818_cron_work_visibility.sql | CREATE FUNCTION public.cleanup_stripe_webhook_events() | CREATE FUNCTION public.cleanup_stripe_webhook_events_gone()
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
const sql = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8")))
  .join("\n");

/** Pruners that are deliberately run by hand, each with why. Empty on 2026-09-23. */
// @two-way src/test/prunersAreScheduled.test.ts:listed as manual but scheduled or gone
const MANUAL: Record<string, string> = {};

const NAME = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?((?:cleanup|prune|sweep)_\w+)\s*\(/gi;
const DROP = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?((?:cleanup|prune|sweep)_\w+)/gi;

// Dropped = its last DROP comes after its last CREATE. A DROP followed by a
// CREATE is a return-type change (CJ-007, 20260925231818), not a removal.
const lastAt = (re: RegExp) => {
  const at = new Map<string, number>();
  for (const m of sql.matchAll(re)) at.set(m[1].toLowerCase(), m.index!);
  return at;
};
const created = lastAt(NAME);
const droppedAt = lastAt(DROP);
const pruners = [...created.keys()]
  .filter((n) => !((droppedAt.get(n) ?? -1) > created.get(n)!))
  .sort();
const scheduled = (name: string) => new RegExp(`cron\\.schedule\\s*\\([^;]*\\b${name}\\b`, "i").test(sql);

describe("every prune/cleanup/sweep function runs (Q167)", () => {
  it("finds the pruners (the parse is not empty)", () => {
    expect(pruners).toContain("cleanup_stripe_webhook_events");
    expect(pruners.length).toBeGreaterThan(10);
  });

  it("each one is scheduled by cron or listed as manual", () => {
    const unrun = pruners.filter((n) => !scheduled(n) && !(n in MANUAL));
    expect(unrun).toEqual([]);
  });

  it("MANUAL lists only defined, unscheduled pruners", () => {
    const stale = Object.keys(MANUAL).filter((n) => !pruners.includes(n) || scheduled(n));
    expect(stale).toEqual([]);
  });
});
