/**
 * JOBS-19: an unanswered date or time request vanished at the start with no word. The sweep's behaviour is proved by
 * src/test/pglite/scheduleChangeExpiryNotice.pglite.mjs; this keeps the cron calling it.
 *
 * @mutate supabase/functions/auto-expire-jobs/index.ts | supabase.rpc("expire_unanswered_schedule_changes") | supabase.rpc("expire_unanswered_offers")
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

describe("an unanswered schedule request is told, not silent", () => {
  it("auto-expire-jobs runs the sweep and counts a failure as a defect", () => {
    const cron = blankComments(readFileSync(join(process.cwd(), "supabase/functions/auto-expire-jobs/index.ts"), "utf8"));
    expect(cron).toContain('supabase.rpc("expire_unanswered_schedule_changes")');
    expect(cron).toContain("defects.record(`expire_unanswered_schedule_changes:");
  });

  it("the sweep claims the row before it notifies", () => {
    const defs = effectiveDefs(join(process.cwd(), "supabase", "migrations"));
    expect(defs.size).toBeGreaterThan(500);
    const fn = blankSqlComments(defs.get("expire_unanswered_schedule_changes")?.stmt ?? "");
    expect(fn.indexOf("SET status = 'expired'")).toBeGreaterThan(0);
    expect(fn.indexOf("INSERT INTO public.notifications")).toBeGreaterThan(fn.indexOf("SET status = 'expired'"));
  });
});
