/**
 * Q737: every function that locks a recurring series' visit row and then
 * writes rows keyed to the series parent must take the PARENT's lock first,
 * the order claim_series_dates uses (parent FOR UPDATE, then the visit FOR
 * UPDATE). helper_cancel_booking locked the visit first; a claim arriving
 * mid-cancel held the parent and waited on the visit while the cancel's
 * series_release_dates writes waited on the parent: "deadlock detected"
 * (scripts/probes/series-claim-race.embedded-pg.mjs, real Postgres, measured
 * 2026-10-02; its "VISIT-FIRST CANCEL VARIANT" re-runs the old body red).
 *
 * Inventory: the newest body of each function below. The floor keeps a
 * renamed or dropped function from emptying the check.
 *
 * @mutate supabase/migrations/20261006015121_crew_rest_carry_on.sql | WHERE pj.id = (SELECT c.parent_job_id FROM public.jobs c WHERE c.id = p_job_id)\n   FOR UPDATE; | WHERE pj.id = (SELECT c.parent_job_id FROM public.jobs c WHERE c.id = p_job_id);
 * @mutate supabase/migrations/20261006015121_crew_rest_carry_on.sql |   PERFORM 1 FROM public.jobs pj | SELECT 1 FROM public.jobs pj
 * @mutate supabase/migrations/20260927012806_recurring_split_days.sql |      WHERE c.parent_job_id = v_job.id AND c.date_needed = v_d\n     FOR UPDATE; |      WHERE c.parent_job_id = v_job.id AND c.date_needed = v_d;
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(resolve(__dirname, "../.."), "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();

function newestBody(fn: string): { f: string; body: string } | null {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, "gi");
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = blankSqlComments(readFileSync(join(MIG, files[i]), "utf8"));
    const all = [...sql.matchAll(head)];
    if (!all.length) continue;
    const at = all[all.length - 1].index!;
    const open = sql.indexOf("AS $", at);
    const tag = sql.slice(open + 3, sql.indexOf("$", open + 4) + 1);
    const start = sql.indexOf(tag, open) + tag.length;
    return { f: files[i], body: sql.slice(start, sql.indexOf(tag, start)) };
  }
  return null;
}

// First lock of the series parent and first lock of a visit row, by position.
const PARENT_LOCK: Record<string, RegExp> = {
  helper_cancel_booking: /PERFORM\s+1\s+FROM\s+public\.jobs\s+pj\s+WHERE\s+pj\.id\s*=\s*\(\s*SELECT\s+c\.parent_job_id[^;]*?\)\s*FOR\s+UPDATE/i,
  claim_series_dates: /FROM\s+public\.jobs\s+j\s+WHERE\s+j\.id\s*=\s*p_job_id\s+FOR\s+UPDATE/i,
};
const VISIT_LOCK: Record<string, RegExp> = {
  helper_cancel_booking: /FROM\s+public\.jobs\s+j\s+WHERE\s+j\.id\s*=\s*p_job_id\s+FOR\s+UPDATE/i,
  claim_series_dates: /WHERE\s+c\.parent_job_id\s*=\s*v_job\.id\s+AND\s+c\.date_needed\s*=\s*v_d\s+FOR\s+UPDATE/i,
};

describe("series locks: parent before visit (Q737)", () => {
  const fns = Object.keys(PARENT_LOCK);

  it("inventory floor: every listed function still exists", () => {
    const found = fns.filter((fn) => newestBody(fn));
    expect(found.length).toBe(2);
  });

  for (const fn of fns) {
    it(`${fn} locks the series parent before the visit`, () => {
      const def = newestBody(fn);
      expect(def, fn).not.toBeNull();
      const p = def!.body.search(PARENT_LOCK[fn]);
      const v = def!.body.search(VISIT_LOCK[fn]);
      expect(p, `${def!.f}: ${fn} has no parent FOR UPDATE`).toBeGreaterThanOrEqual(0);
      expect(v, `${def!.f}: ${fn} has no visit FOR UPDATE`).toBeGreaterThanOrEqual(0);
      expect(p, `${def!.f}: ${fn} locks the visit before the series parent`).toBeLessThan(v);
    });
  }
});
