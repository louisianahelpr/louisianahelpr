/**
 * Q357: a poster could PATCH recurrence_days onto a hired job (booking the
 * Helpr for visits they never agreed to) or set parent_job_id to any series.
 * The trigger must refuse both for client roles, fire on INSERT and on UPDATE
 * of both columns, and scripts/probes/direct-patch-hire.prod.mjs (doors G, H)
 * shows it on prod.
 *
 * @mutate supabase/migrations/20260927012806_recurring_split_days.sql | IF NEW.recurrence_days IS DISTINCT FROM OLD.recurrence_days AND v_hired THEN | IF false THEN
 * @mutate supabase/migrations/20260927012806_recurring_split_days.sql |   IF NEW.parent_job_id IS DISTINCT FROM OLD.parent_job_id THEN | IF false THEN
 * @mutate supabase/migrations/20260927012806_recurring_split_days.sql | BEFORE INSERT OR UPDATE OF parent_job_id, recurrence_days, | BEFORE UPDATE OF parent_job_id,
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = "supabase/migrations";
const latest = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => readFileSync(`${dir}/${f}`, "utf8").includes("FUNCTION public.enforce_series_columns_client_lock()"))
  .pop();
const sql = latest ? readFileSync(`${dir}/${latest}`, "utf8") : "";

describe("jobs series columns are locked for clients (Q357)", () => {
  it("a migration defines the lock", () => {
    expect(latest).toBeTruthy();
  });
  it("refuses recurrence changes after hire and any parent_job_id write", () => {
    // "Hired" is a Helpr on the row OR (Q407 split days) any held visit date.
    expect(sql).toMatch(/v_hired := OLD\.helper_id IS NOT NULL\s+OR /);
    expect(sql).toMatch(/IF NEW\.recurrence_days IS DISTINCT FROM OLD\.recurrence_days AND v_hired THEN\s+RAISE/);
    expect(sql).toMatch(/IF NEW\.parent_job_id IS DISTINCT FROM OLD\.parent_job_id THEN\s+RAISE/);
    expect(sql).toMatch(/TG_OP = 'INSERT' THEN\s+IF NEW\.parent_job_id IS NOT NULL THEN\s+RAISE/);
  });
  it("fires on insert and on update of both columns", () => {
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF parent_job_id, recurrence_days[, a-z_]* ON public\.jobs/);
  });
  it("the live probe covers both doors", () => {
    const probe = readFileSync("scripts/probes/direct-patch-hire.prod.mjs", "utf8");
    expect(probe).toContain('"G_poster_patch_recurrence_after_hire", "H_poster_patch_parent_job_id"');
  });
});
