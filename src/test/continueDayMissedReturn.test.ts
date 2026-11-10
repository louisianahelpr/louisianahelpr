/**
 * Owner decision #4 (11-08), Jobs audit 11-08 #4: a continue day whose time passed without "Mark done" gets a way out.
 * The poster's "Didn't come back" (photos + note) and the Helpr's "Can't come back" (note) both go to
 * report_continue_day_missed (migration 20261108214605): the day closes 'lapsed', a job_missed_returns report and a
 * REAL admin queue row (job_completion_nudges escalated, unresolved: Admin -> Stuck jobs) are written, the other side
 * and the admins are told (no admin alert for test data), no money moves, and the job is held (auto-release, stalled
 * ladder, approve ask) until an admin acts.
 *
 * Behaviour (real Postgres): src/test/pglite/continueDayMissedReturn.pglite.mjs (2026-11-08: 29 PASS; 25 FAIL with
 * NEW_MIGRATION=skip; all 10 plants red). The hold in the edge sweeps: src/test/edge/continueDayHold.test.ts.
 *
 * @mutate supabase/migrations/20261108214605_continue_day_missed_return.sql |   IF NOT v_test THEN |   IF true THEN
 * @mutate supabase/migrations/20261108214605_continue_day_missed_return.sql |   AFTER UPDATE OF resolved_at ON public.job_completion_nudges | AFTER INSERT ON public.job_completion_nudges
 * @mutate src/lib/continueDayMissed.ts |   return row.status === "set" && !done && Date.now() >= startMs + CONTINUE_DAY_MISSED_AFTER_HOURS * 3_600_000; |   return row.status === "set" && !done;
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { newestTriggerText } from "./helpers/migrationTriggers";
import { CONTINUE_DAY_MISSED_AFTER_HOURS, continueDayMissedOpen } from "@/lib/continueDayMissed";
import { CONTINUE_DAY_HOLD_GRACE_HOURS } from "../../supabase/functions/_shared/continueDay";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrorCopy";

const defs = effectiveDefs("supabase/migrations");
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const rpc = flat(defs.get("report_continue_day_missed")?.stmt ?? "");

describe("a missed continue day goes to the admin queue (owner #4, 11-08)", () => {
  it("the newest RPC, triggers and queue are this migration's", () => {
    for (const fn of ["report_continue_day_missed", "refuse_continue_day_while_missed_open", "resolve_missed_return_on_review", "resolve_missed_return_on_job_change", "admin_stalled_job_queue"]) {
      expect(defs.get(fn)?.file, fn).toMatch(/^20261108214605_/);
    }
  });
  it("the RPC: end users only, a lapsed SET day, the real queue row, test data pages nobody", () => {
    expect(rpc).toContain("IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'");
    expect(rpc).toContain("WHERE c.job_id = v_job.id AND c.status = 'set'");
    expect(rpc).toContain("AT TIME ZONE 'America/Chicago') + interval '6 hours' THEN RAISE EXCEPTION 'continue_day_missed_too_soon'");
    expect(rpc).toContain("UPDATE public.job_continue_days SET status = 'lapsed'");
    expect(rpc).toContain("ON CONFLICT (job_id) DO UPDATE SET escalated_at = now(), resolved_at = NULL, resolved_by = NULL");
    expect(rpc).toContain("IF NOT v_test THEN");
    // No money column is written.
    expect(rpc).not.toMatch(/UPDATE public\.jobs/);
  });
  it("the report closes itself when the admin acts, and blocks a new day meanwhile", () => {
    const trg = (name: string) => flat(newestTriggerText("supabase/migrations", name));
    expect(trg("trg_resolve_missed_return_on_review")).toMatch(/^AFTER UPDATE OF resolved_at ON public\.job_completion_nudges/);
    expect(trg("trg_resolve_missed_return_on_job_change")).toMatch(/^AFTER UPDATE OF status ON public\.jobs/);
    expect(trg("trg_refuse_continue_day_while_missed_open")).toMatch(/^BEFORE INSERT ON public\.job_continue_days/);
  });
  it("the lapse instant is the edge hold's (start + CONTINUE_DAY_HOLD_GRACE_HOURS) and the app's", () => {
    expect(CONTINUE_DAY_HOLD_GRACE_HOURS).toBe(6);
    expect(CONTINUE_DAY_MISSED_AFTER_HOURS).toBe(CONTINUE_DAY_HOLD_GRACE_HOURS);
  });
  it("the app offers it only on a SET day past start + 6 h, not marked done", () => {
    const at = (h: number) => {
      const d = new Date(Date.now() - h * 3600e3);
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
      const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
      return { new_date: `${g("year")}-${g("month")}-${g("day")}`, new_start_time: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}:00` };
    };
    expect(continueDayMissedOpen({ status: "set", ...at(7) }, null)).toBe(true);
    expect(continueDayMissedOpen({ status: "set", ...at(5) }, null)).toBe(false);
    expect(continueDayMissedOpen({ status: "proposed", ...at(30) }, null)).toBe(false);
    expect(continueDayMissedOpen({ status: "set", ...at(30) }, "2026-11-08T00:00:00Z")).toBe(false);
    expect(continueDayMissedOpen(null, null)).toBe(false);
  });
  it("every refusal has words", () => {
    const copy = (RPC_ERROR_COPY as unknown as Record<string, Record<string, string>>).report_continue_day_missed ?? {};
    const codes = [...new Set(rpc.match(/RAISE EXCEPTION '([a-z_]+)'/g)?.map((m) => m.slice(17, -1)) ?? [])];
    expect(codes.length).toBeGreaterThan(8);
    for (const c of codes) expect(copy[c], c).toBeTruthy();
  });
});
