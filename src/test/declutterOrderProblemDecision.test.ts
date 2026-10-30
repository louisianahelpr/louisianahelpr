/**
 * Declutter audit 1030 DB-12: the order card says what Louisiana Helpr decided, so the party-scoped read the card uses
 * (declutter_order_problem) must return decision and decided_at, and must keep returning ONLY member-safe columns:
 * never the admin's note, the fault, the strike, decided_by or the reporter's id. Checked on the definition the
 * migrations leave (effectiveDefs: any dollar-quote tag, the newest CREATE, later rewrites applied), comments blanked.
 *
 * Behaviour, red then green: src/test/pglite/declutterOrderProblemDecision.pglite.mjs (8 FAILs with
 * NEW_MIGRATION=skip; 22/22 with 20261030080104 applied 3x; a planted 'fault' key fails 6).
 *
 * @mutate supabase/migrations/20261030080104_declutter_order_problem_decision.sql |     'decision', p.decision,\n |
 * @mutate supabase/migrations/20261030080104_declutter_order_problem_decision.sql |     'decided_at', p.decided_at\n | 'decided_at', p.decided_at, 'fault', p.fault\n
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

function returnedKeys(stmt: string): string[] {
  const code = blankSqlComments(stmt);
  const at = code.lastIndexOf("jsonb_build_object(");
  expect(at, "declutter_order_problem builds its answer with jsonb_build_object").toBeGreaterThan(0);
  const tail = code.slice(at);
  const body = tail.slice(0, tail.indexOf(");"));
  return [...body.matchAll(/'([a-z_]+)'\s*,/g)].map((m) => m[1]);
}

describe("DB-12: declutter_order_problem returns the decision and only member-safe columns", () => {
  const def = effectiveDefs(MIGRATIONS).get("declutter_order_problem");

  it("reads the newest definition of the card's read", () => {
    expect(def, "declutter_order_problem is defined by a migration").toBeTruthy();
    expect(def!.file >= "20261030080104", `newest definition is in ${def!.file}`).toBe(true);
  });

  it("returns decision and decided_at with the card's columns, never the private ones", () => {
    const keys = returnedKeys(def!.stmt);
    // Inventory floor: the card's nine columns plus the two this item adds.
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toEqual(expect.arrayContaining(["decision", "decided_at", "status", "reporter_side", "reason"]));
    for (const secret of ["admin_note", "fault", "strike_given", "decided_by", "reporter_id"]) {
      expect(keys, `${secret} must never reach a member`).not.toContain(secret);
    }
  });
});
