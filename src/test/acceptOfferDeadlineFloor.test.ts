/**
 * Q1391: a poster cannot hand a Helpr an offer that lapses before they can
 * answer it. Every hire door that stores a reply deadline from the CLIENT's
 * p_deadline floors it at 55 minutes from now (the app's shortest choice, 1 h,
 * less 5 minutes of clock skew), inside the job-start and 48 h caps.
 *
 * Inventory from source: every effective function (newest CREATE across the
 * migrations, any dollar tag) whose body reads `p_deadline` and assigns a
 * deadline variable. Today: accept_application (single hire) and
 * accept_group_application (crew spot, fixed first in 20261005172453).
 *
 * Can fail on the original bug: the migrations before 20261007032040 leave
 * accept_application storing a minutes-ahead p_deadline unfloored.
 * And no client writes the deadline around the RPC (lh-authz-rls review,
 * 2026-10-07): a poster's PATCH of jobs.response_deadline was accepted live
 * (HTTP 200 on a seed job). The newest enforce_hire_columns_rpc_only refuses
 * any change from the authenticated/anon role, a clear included (a NULL
 * deadline is never expired, so a Helpr clearing it would hold the job).
 *
 * Behaviour (real Postgres): src/test/pglite/acceptOfferDeadlineFloor.pglite.mjs
 * (14 PASS on the fix; 6 FAIL with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261007032040_accept_offer_deadline_floor.sql | now() + interval '48 hours'), now() + interval '55 minutes'), | now() + interval '48 hours'), now() - interval '55 minutes'),
 * @mutate supabase/migrations/20261007032040_accept_offer_deadline_floor.sql | IF NEW.response_deadline IS DISTINCT FROM OLD.response_deadline THEN | IF false THEN
 * @mutate supabase/migrations/20261007032040_accept_offer_deadline_floor.sql | IF NEW.response_deadline IS DISTINCT FROM OLD.response_deadline THEN | IF NEW.response_deadline IS NOT NULL AND NEW.response_deadline IS DISTINCT FROM OLD.response_deadline THEN
 * @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql | now() + interval '48 hours'), now() + interval '55 minutes'), v_cutoff); | now() + interval '48 hours'), now()), v_cutoff);
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const FIX = "20261007032040";
const FLOOR = /GREATEST\s*\([\s\S]*?\bp_deadline\b[\s\S]*?,\s*now\(\)\s*\+\s*interval\s*'55 minutes'\s*\)/i;

/** Functions that take a client deadline and store it without the 55-minute floor. */
function unfloored(defs: ReturnType<typeof effectiveDefs>): { all: string[]; bad: string[] } {
  const all: string[] = [];
  const bad: string[] = [];
  for (const [name, def] of defs) {
    const body = blankSqlComments(def.stmt);
    // A deadline variable assigned from the client's p_deadline.
    const assign = [...body.matchAll(/\b(v_\w*deadline)\s*:=([^;]*)/gi)].filter((m) => /\bp_deadline\b/i.test(m[2]));
    if (!assign.length) continue;
    all.push(name);
    if (!assign.every((m) => FLOOR.test(m[2]))) bad.push(name);
  }
  return { all: all.sort(), bad: bad.sort() };
}

describe("a client-chosen offer deadline is never minutes away (Q1391)", () => {
  it("every hire door floors p_deadline at now() + 55 minutes", () => {
    const { all, bad } = unfloored(effectiveDefs(DIR));
    // Inventory floor: the single and the crew hire.
    expect(all.length).toBeGreaterThan(1);
    expect(all).toEqual(expect.arrayContaining(["accept_application", "accept_group_application"]));
    expect(bad).toEqual([]);
  });

  it("no client writes jobs.response_deadline: the hire-column lock refuses any change, a clear included", () => {
    const def = effectiveDefs(DIR).get("enforce_hire_columns_rpc_only");
    expect(def, "enforce_hire_columns_rpc_only is gone").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/current_user::text\s+NOT\s+IN\s*\(\s*'authenticated'\s*,\s*'anon'\s*\)/i);
    expect(body).toMatch(/IF\s+NEW\.response_deadline\s+IS\s+DISTINCT\s+FROM\s+OLD\.response_deadline\s+THEN\s+RAISE/i);
    expect(body, "a clear must be refused too: a NULL deadline is never expired").not.toMatch(/NEW\.response_deadline\s+IS\s+NOT\s+NULL/i);
  });

  it("can fail: before the fix, accept_application stored p_deadline unfloored", () => {
    expect(unfloored(effectiveDefs(DIR, { before: FIX })).bad).toContain("accept_application");
  });
});
