/**
 * Every column the app selects from public.declutter_problems is one the
 * `authenticated` role holds column SELECT on (Builder 81, 2026-11-03).
 *
 * The table has column-level grants (20261015042253: every column but
 * decided_by, so members never learn which admin decided). A3-74
 * (20261102041000) added decide_by and src/lib/declutter/handover.ts
 * withDecideBy() selects "id, decide_by", but no migration granted the new
 * column, so on prod the read answered 42501 (measured 2026-11-03 from
 * information_schema.column_privileges: decide_by missing) and the admin
 * refund queue lost its due-time order.
 *
 * Reads: every `.from("declutter_problems").select("...")` in non-test src/
 * (the edge functions run as service_role and are out of scope), and every
 * GRANT/REVOKE on the table to authenticated across supabase/migrations in
 * version order, so the NEWEST state is what is checked.
 *
 * @mutate supabase/migrations/20261103235037_declutter_problems_grant_decide_by.sql | GRANT SELECT (decide_by) ON TABLE public.declutter_problems TO authenticated; | SELECT 1;
 * @mutate src/lib/declutter/handover.ts | .select("id, order_id, reporter_side, reason"); | .select("id, order_id, reporter_side, reason, decided_by");
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const TABLE = "declutter_problems";
const MIG_DIR = "supabase/migrations";

function grantedColumns(): Set<string> {
  const cols = new Set<string>();
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  const t = `(?:TABLE\\s+)?(?:public\\.)?${TABLE}\\b`;
  const stmt = new RegExp(
    `\\b(GRANT|REVOKE)\\s+(ALL(?:\\s+PRIVILEGES)?|SELECT)\\s*(\\(([^)]*)\\))?\\s+ON\\s+${t}\\s+(?:TO|FROM)\\s+([^;]*);`,
    "gi",
  );
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(`${MIG_DIR}/${f}`, "utf8"));
    for (const m of sql.matchAll(stmt)) {
      const [, verb, , , list, roles] = m;
      if (!/(?<![\w])authenticated(?![\w])/i.test(roles)) continue;
      const named = list ? list.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean) : null;
      if (verb.toUpperCase() === "REVOKE") {
        if (named) named.forEach((c) => cols.delete(c));
        else cols.clear();
      } else if (named) named.forEach((c) => cols.add(c));
      else cols.add("*");
    }
  }
  return cols;
}

function selectSites(): { file: string; columns: string[] }[] {
  const files = execFileSync("git", ["grep", "-l", TABLE, "--", "src"], { encoding: "utf8" })
    .split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|^src\/test\//.test(f));
  const out: { file: string; columns: string[] }[] = [];
  const re = new RegExp(`\\.from\\(\\s*["'\`]${TABLE}["'\`]\\s*\\)\\s*\\.select\\(\\s*["'\`]([^"'\`]*)["'\`]`, "g");
  for (const file of files) {
    const src = blankComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(re)) {
      out.push({ file, columns: m[1].split(",").map((c) => c.trim().toLowerCase()).filter(Boolean) });
    }
  }
  return out;
}

describe("declutter_problems: every selected column is granted to authenticated", () => {
  const granted = grantedColumns();
  const sites = selectSites();

  it("reads the real grants and the real select sites", () => {
    expect(granted.size).toBeGreaterThan(10);
    expect(sites.length).toBeGreaterThan(3);
  });

  it("every column a client select names is granted", () => {
    const missing = sites.flatMap((s) =>
      granted.has("*") ? [] : s.columns.filter((c) => !granted.has(c)).map((c) => `${s.file}: ${c}`));
    expect(missing).toEqual([]);
  });

  it("decided_by stays hidden from members (lh-authz-rls review 2.3)", () => {
    expect(granted.has("*")).toBe(false);
    expect(granted.has("decided_by")).toBe(false);
  });
});
