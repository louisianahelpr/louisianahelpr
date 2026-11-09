/**
 * Jobs audit 11-08 #9 and #11, migration 20261108203000.
 *
 * Behaviour (real Postgres): src/test/pglite/continueDayLapsedAndRefund.pglite.mjs (2026-11-08: 10 PASS; 5 FAIL with
 * NEW_MIGRATION=skip; 5 plants each red).
 *
 *   - #9: the evening "not marked done" kinds go once from the evening on until the stalled ladder has nudged (not only
 *     within 6 hours), and a late send names the day, never "today";
 *   - #11: a new continue day is refused while a refund request on the job is live (members only), and the app has
 *     words for it.
 *
 * @mutate supabase/migrations/20261108203000_continue_day_lapsed_evening_and_refund.sql | (v_now < a.evening_at + interval '6 hours' OR NOT a.nudged) THEN 'evening_not_done_poster' | v_now < a.evening_at + interval '6 hours' THEN 'evening_not_done_poster'
 * @mutate supabase/migrations/20261108203000_continue_day_lapsed_evening_and_refund.sql |   BEFORE INSERT ON public.job_continue_days | BEFORE UPDATE ON public.job_continue_days
 * @mutate src/lib/lifecycleErrorCopy.ts |     continue_day_refund_open: | continue_day_refund_gone:
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrorCopy";

const defs = effectiveDefs("supabase/migrations");
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const sweep = flat(defs.get("sweep_job_continue_day_reminders")?.stmt ?? "");
const FIX = flat(readFileSync("supabase/migrations/20261108203000_continue_day_lapsed_evening_and_refund.sql", "utf8"));

describe("a lapsed continue day still gets its evening check-in (Jobs audit 11-08 #9)", () => {
  it("the newest sweep is this migration's", () => {
    expect(defs.get("sweep_job_continue_day_reminders")?.file).toMatch(/^20261108203000_/);
  });
  it("both evening kinds run until the stalled ladder has nudged", () => {
    for (const k of ["evening_not_done_helpr", "evening_not_done_poster"]) {
      expect(sweep).toContain(`(CASE WHEN v_now >= a.evening_at AND (v_now < a.evening_at + interval '6 hours' OR NOT a.nudged) THEN '${k}' END)`);
    }
    expect(sweep).toContain("EXISTS (SELECT 1 FROM public.job_completion_nudges n WHERE n.job_id = j.id AND n.first_sent_at IS NOT NULL) AS nudged");
  });
  it("a late send names the day", () => {
    expect((sweep.match(/WHEN \(v_now AT TIME ZONE 'America\/Chicago'\)::date > rec\.new_date THEN/g) ?? []).length).toBe(3);
  });
});

describe("no continue day while a refund request is live (Jobs audit 11-08 #11)", () => {
  it("a BEFORE INSERT trigger on job_continue_days refuses it for members", () => {
    expect(FIX).toMatch(/CREATE TRIGGER trg_refuse_continue_day_while_refund_live BEFORE INSERT ON public\.job_continue_days FOR EACH ROW EXECUTE FUNCTION public\.refuse_continue_day_while_refund_live\(\)/);
    const fn = flat(defs.get("refuse_continue_day_while_refund_live")?.stmt ?? "");
    expect(fn).toContain("IF public.is_server_context() THEN RETURN NEW; END IF;");
    expect(fn).toContain("public.refund_request_is_live(r.status, r.dispute_id)");
    expect(fn).toContain("RAISE EXCEPTION 'continue_day_refund_open'");
  });
  it("the app explains it", () => {
    expect((RPC_ERROR_COPY as unknown as Record<string, Record<string, string>>).propose_job_continue_day.continue_day_refund_open).toMatch(/refund request/);
  });
});
