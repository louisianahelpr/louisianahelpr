/**
 * Q1755: a test account is never put on a REAL job (2026-10-09: the shared test
 * Helpr applied to the owner's real job; a test account is on the Stripe TEST
 * key, so such a job can never be paid out and needs a manual refund).
 *
 * The rule lives in ONE trigger function, enforce_test_account_off_real_jobs,
 * attached to every table whose write puts a member on a job:
 *   applications (INSERT), jobs (helper_id = a hire, offered_to_helper_id = a
 *   direct offer, INSERT or UPDATE), group_job_helpers (helper_id = a crew spot).
 * Every hire RPC (accept_application, accept_job_offer, respond_to_direct_offer,
 * quote_job_funded_hires_quoter, ...) writes one of those columns, so a trigger
 * covers them all, including ones added later.
 *
 * Read from the NEWEST migrations (effectiveDefs, any dollar tag; triggers via
 * triggerInventory, comments blanked):
 *   - each of the three tables carries the trigger, on the right events;
 *   - the function refuses a test_accounts member on a job whose is_seed is false;
 *   - on jobs it fires AFTER every BEFORE INSERT trigger that assigns
 *     NEW.is_seed (inventory from source), so it reads the final value;
 *   - can fail: before the fix no such trigger existed.
 * Behaviour (real Postgres): src/test/pglite/testAccountsOffRealJobs.pglite.mjs
 * (16 PASS on the fix applied 3x; 6 FAIL with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261030063902_test_accounts_off_real_jobs.sql | CREATE TRIGGER trg_applications_test_account_off_real_jobs\n  BEFORE INSERT OR UPDATE OF helper_id, job_id ON public.applications | CREATE TRIGGER trg_applications_test_account_off_real_jobs\n  BEFORE UPDATE OF helper_id, job_id ON public.applications
 * @mutate supabase/migrations/20261030063902_test_accounts_off_real_jobs.sql |   BEFORE INSERT OR UPDATE OF helper_id, offered_to_helper_id ON public.jobs |   BEFORE INSERT OR UPDATE OF helper_id ON public.jobs
 * @mutate supabase/migrations/20261030063902_test_accounts_off_real_jobs.sql | CREATE TRIGGER trg_jobs_test_account_off_real_jobs | CREATE TRIGGER trg_jobs_a_test_account_off_real_jobs
 * @mutate supabase/migrations/20261030063902_test_accounts_off_real_jobs.sql |   IF v_job_is_seed IS FALSE THEN |   IF v_job_is_seed IS TRUE THEN
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory, triggersOn } from "./helpers/migrationTriggers";

const DIR = "supabase/migrations";
const FIX = "20261030063902";
const FN = "enforce_test_account_off_real_jobs";

function inventory(before?: string) {
  const files = migrationFiles(DIR).filter((f) => !before || f < before);
  return triggerInventory(files.map((name) => ({ name, sql: readFileSync(join(DIR, name), "utf8") })));
}

const ours = (inv: ReturnType<typeof inventory>, table: string) => triggersOn(inv, table).filter((t) => t.fn === FN);

describe("a test account is never put on a real job (Q1755)", () => {
  const inv = inventory();

  it("applications: every new application runs the rule", () => {
    const t = ours(inv, "applications");
    expect(t).toHaveLength(1);
    expect(t[0].timing).toBe("BEFORE");
    expect(t[0].events).toMatch(/\bINSERT\b/);
  });

  it("jobs: a hire (helper_id) and a direct offer (offered_to_helper_id) run the rule, on insert and update", () => {
    const t = ours(inv, "jobs");
    expect(t).toHaveLength(1);
    expect(t[0].timing).toBe("BEFORE");
    expect(t[0].events).toMatch(/\bINSERT\b/);
    const upd = /\bUPDATE\b(?:\s+OF\s+([\w\s,]+))?/.exec(t[0].events);
    expect(upd, "fires on UPDATE").toBeTruthy();
    // A bare UPDATE covers every column; an UPDATE OF list must name both.
    if (upd![1]) {
      const cols = upd![1].toLowerCase().split(/[\s,]+/);
      expect(cols).toEqual(expect.arrayContaining(["helper_id", "offered_to_helper_id"]));
    }
  });

  it("group_job_helpers: taking or filling a crew spot runs the rule", () => {
    const t = ours(inv, "group_job_helpers");
    expect(t).toHaveLength(1);
    expect(t[0].events).toMatch(/\bINSERT\b/);
    expect(t[0].events).toMatch(/\bUPDATE\b/);
  });

  it("the function refuses a test_accounts member on a job that is not is_seed", () => {
    const def = effectiveDefs(DIR).get(FN);
    expect(def, `${FN} is gone`).toBeTruthy();
    const body = bodyOf(def!.stmt);
    expect(body).toMatch(/public\.test_accounts/);
    expect(body).toMatch(/NOT\s+v_job_is_seed/);
    expect(body).toMatch(/v_job_is_seed\s+IS\s+FALSE/);
    expect((body.match(/RAISE\s+EXCEPTION\s+'test_account_real_job/g) ?? []).length).toBeGreaterThan(2);
  });

  it("on jobs it fires after every BEFORE INSERT trigger that sets NEW.is_seed (inventory from source)", () => {
    const defs = effectiveDefs(DIR);
    const setters = triggersOn(inv, "jobs").filter(
      (t) => t.timing === "BEFORE" && /\bINSERT\b/.test(t.events) && /NEW\.is_seed\s*:=/i.test(bodyOf(defs.get(t.fn)?.stmt ?? "")),
    );
    // Inventory floor: trg_jobs_insert_column_lock and trg_jobs_seed_from_poster today.
    expect(setters.length).toBeGreaterThan(1);
    const mine = ours(inv, "jobs")[0];
    for (const s of setters) expect(s.name < mine.name, `${s.name} must sort before ${mine.name}`).toBe(true);
  });

  it("can fail: before the fix no table ran the rule", () => {
    const before = inventory(FIX);
    for (const table of ["applications", "jobs", "group_job_helpers"]) expect(ours(before, table)).toHaveLength(0);
    expect(effectiveDefs(DIR, { before: FIX }).get(FN)).toBeUndefined();
  });
});
