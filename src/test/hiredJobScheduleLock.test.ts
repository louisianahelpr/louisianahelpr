/**
 * HIGH-2 (money audit 2026-09-25): the columns that PRICE a cancellation are
 * not client-writable once the job is committed or cancelled.
 *
 * The class is derived from the pricing code itself: every job field that
 * computeCancellationFee (supabase/functions/_shared/cancellationFee.ts) hands
 * to hoursUntilJob is a time anchor of the fee and the refund. Minus the ones
 * the cancellation RPC owns (enforce_cancellation_requires_rpc's guarded
 * list), each must be refused for clients by the NEWEST
 * enforce_series_columns_client_lock on a job that has a Helpr, a crew, a
 * parent series, or is cancelled. A new anchor added to the pricing without a
 * lock fails here.
 *
 * Executable proof: src/test/pglite/hiredJobScheduleLock.pglite.mjs (OLD STATE
 * RED on all four job kinds; migration 3x GREEN).
 *
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |           OR OLD.status::text = 'cancelled'\n          OR public.job_has_crew(OLD.id)) THEN | ) THEN
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |   IF (NEW.date_needed IS DISTINCT FROM OLD.date_needed OR NEW.start_time IS DISTINCT FROM OLD.start_time)\n     AND (OLD.helper_id IS NOT NULL | IF (NEW.date_needed IS DISTINCT FROM OLD.date_needed)\n     AND (OLD.helper_id IS NOT NULL
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql |      AND (OLD.helper_id IS NOT NULL\n          OR OLD.parent_job_id IS NOT NULL | AND (OLD.helper_id IS NOT NULL
 * @mutate supabase/functions/_shared/cancellationFee.ts |   const hours = hoursUntilJob(job.date_needed, job.cancelled_at, job.start_time); |   const hours = hoursUntilJob(job.date_needed, job.cancelled_at, job.start_time ?? job.helper_confirmed_at);
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

function newestFunction(name: string): { file: string; body: string } {
  const header = `CREATE OR REPLACE FUNCTION public.${name}(`;
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = blankSqlComments(readFileSync(`${dir}/${files[i]}`, "utf8"));
    const at = sql.lastIndexOf(header);
    if (at < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at))?.[1];
    if (!tag) throw new Error(`${name}: no dollar-quote tag in ${files[i]}`);
    const open = sql.indexOf(tag, at);
    const close = sql.indexOf(tag, open + tag.length);
    return { file: files[i], body: sql.slice(at, close + tag.length) };
  }
  return { file: "", body: "" };
}

describe("a committed or cancelled job's fee anchors are client-locked (HIGH-2)", () => {
  const fee = blankComments(readFileSync("supabase/functions/_shared/cancellationFee.ts", "utf8"));
  const compute = fee.slice(fee.indexOf("export function computeCancellationFee"));
  const anchorArgs = /hoursUntilJob\(([^)]*)\)/.exec(compute)?.[1] ?? "";
  const anchors = [...anchorArgs.matchAll(/job\.([a-z_]+)/g)].map((m) => m[1]);
  const rpcOwned = (() => {
    const body = newestFunction("enforce_cancellation_requires_rpc").body;
    const list = /guarded CONSTANT text\[\] := ARRAY\[([\s\S]*?)\]/.exec(body)?.[1] ?? "";
    return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  })();
  const mustLock = anchors.filter((c) => !rpcOwned.includes(c));

  it("inventory: the pricing anchors are read from the code, and the RPC-owned ones are excluded", () => {
    expect(anchors.length).toBeGreaterThan(2);
    expect(rpcOwned).toContain("cancelled_at");
    expect(mustLock.length).toBeGreaterThan(1);
  });

  it("every client-writable anchor is refused once a Helpr, a crew, a parent series, or a cancel exists", () => {
    const { body } = newestFunction("enforce_series_columns_client_lock");
    const block = /IF \(([^)]*)\)\s+AND \(OLD\.helper_id IS NOT NULL([\s\S]*?)\) THEN\s+RAISE EXCEPTION 'schedule_locked/.exec(body);
    expect(block, "the schedule_locked block is missing from the newest lock").not.toBeNull();
    const [, changed, rest] = block!;
    for (const c of mustLock) {
      expect(changed, `${c} prices the cancellation but is not locked`).toContain(`NEW.${c} IS DISTINCT FROM OLD.${c}`);
    }
    expect(rest).toContain("OR OLD.parent_job_id IS NOT NULL");
    expect(rest).toContain("OR OLD.status::text = 'cancelled'");
    expect(rest).toContain("OR public.job_has_crew(OLD.id)");
  });

  it("the trigger fires on those columns", () => {
    const all = files.map((f) => blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"))).join("\n");
    const cols = ([...all.matchAll(/CREATE TRIGGER trg_enforce_series_columns_client_lock\s+BEFORE INSERT OR UPDATE OF ([a-z_, ]+) ON public\.jobs/g)].pop()?.[1] ?? "")
      .split(",").map((c) => c.trim());
    for (const c of mustLock) expect(cols).toContain(c);
  });

  it("the executable PGlite proof exists", () => {
    const probe = readFileSync("src/test/pglite/hiredJobScheduleLock.pglite.mjs", "utf8");
    expect(probe).toContain('readMigration("20260925160644_hired_job_schedule_lock.sql")');
    expect(probe).toContain("OLD STATE RED");
  });
});
