/**
 * CLASS CHECK (Q1580): an informational admin notice in the ops alert ledger
 * is never mirrored into docs/OPEN.md as work.
 *
 * The bug: every real signup posts "New member joined" (adminPushSeverity
 * 'info') through postSlackOpsAlert, which records a ledger occurrence. The
 * ledger closes it on the next verify (20260926035647: rule 'notice'), but
 * scripts/open-sync-trackers.mjs mirrors every row that is open at that
 * moment, so a welcome notice became queue item Q1580 ("new member joined",
 * re-opened 9 times by 2026-10-12) with nothing to fix.
 *
 * INVENTORY: the database's own rule table, public.admin_alert_close_rule
 * (newest migration definition): every title prefix whose rule is 'notice'.
 * The mirror's ledger query (LEDGER_SQL in scripts/lib/openFeeds.mjs) must
 * exclude that rule by CALLING the function, so a notice title added there
 * later is excluded too, with no second list to drift.
 *
 * Live counterpart (2026-10-12, read-only): LEDGER_SQL ran against prod and
 * returned the 62 open rows; the only 'notice' row (3a801ee231b0, "new member
 * joined") is excluded whenever it is open.
 */
// @mutate scripts/lib/openFeeds.mjs |    AND public.admin_alert_close_rule(title) IS DISTINCT FROM 'notice' |    AND true
// @mutate scripts/lib/openFeeds.mjs | IS DISTINCT FROM 'notice' | IS DISTINCT FROM 'notices'
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { LEDGER_SQL } from "../../scripts/lib/openFeeds.mjs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");
const ruleDef = effectiveDefs(MIGRATIONS).get("admin_alert_close_rule");
const RULES = ruleDef
  ? [...blankSqlComments(ruleDef.stmt).matchAll(/\(\s*'([^']+)'\s*,\s*'([\w-]+)'\s*\)/g)].map((m) => ({ prefix: m[1], rule: m[2] }))
  : [];
const NOTICES = RULES.filter((r) => r.rule === "notice").map((r) => r.prefix);

/** The WHERE clause of the mirror's ledger query, whitespace collapsed. */
function whereClause(sql: string): string {
  const flat = blankSqlComments(sql).replace(/\s+/g, " ");
  const m = flat.match(/\bWHERE\b(.*?)(\bORDER BY\b|$)/i);
  return m ? m[1].trim() : "";
}

describe("informational ledger notices are not mirrored into OPEN.md (Q1580)", () => {
  it("reads the newest admin_alert_close_rule and finds its notices", () => {
    expect(ruleDef, "no migration defines public.admin_alert_close_rule").toBeTruthy();
    expect(RULES.length).toBeGreaterThan(15);
    // "new member joined" (the Q1580 row) and "dispute auto-resolved", at least.
    expect(NOTICES.length).toBeGreaterThan(1);
    expect(NOTICES).toContain("new member joined");
  });

  it("the mirror's ledger query excludes the 'notice' rule by calling the database's rule table", () => {
    const where = whereClause(LEDGER_SQL);
    expect(where, "LEDGER_SQL has no WHERE clause").not.toBe("");
    expect(where).toMatch(/status <> 'closed'/);
    expect(
      where,
      "LEDGER_SQL must exclude `public.admin_alert_close_rule(title) IS DISTINCT FROM 'notice'`; otherwise a welcome notice is filed as open work",
    ).toMatch(/\bpublic\.admin_alert_close_rule\(\s*title\s*\)\s+IS DISTINCT FROM\s+'notice'/i);
  });
});
