import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

/**
 * EVERY PUBLIC TABLE COLUMN THE MIGRATIONS LEAVE BEHIND IS IN types.ts, BEFORE IT SHIPS.
 *
 * Q1307 / Q1309 (nightly-red #2270, ledger 00fd2bd0 + 6aadd324): db-deploy run
 * 37249653489 (2026-10-05 01:00Z, push of 599ef81ed) applied
 * 20261004220059_tip_held_payout_redrive.sql and then failed at "Verify types.ts
 * matches the live schema just deployed": 13 columns in prod absent from the
 * types (the new table tip_hold_redrives, and chargeback_clawbacks'
 * held_repay_first_attempt_at / held_repay_owed_at). types.ts was regenerated
 * only afterwards (b01144c75), and the 01:34Z dispatch 37251975326 was green.
 *
 * typesCoverMigrationFunctions.test.ts already closes this class for FUNCTIONS
 * before push; nothing did for TABLES and COLUMNS, so a migration that adds a
 * column could still reach main without its types and turn db-deploy red after
 * it had already changed prod. This guard replays the migrations in order from
 * the repo alone (CREATE TABLE adds the table and its columns, ALTER TABLE ...
 * ADD COLUMN adds, DROP COLUMN / DROP TABLE remove, RENAME COLUMN / RENAME TO
 * move) and requires every surviving public column to be a key of its table's
 * `Row` in types.ts. Fix when red: hand-add the columns to types.ts (Row,
 * Insert, Update) in the same commit as the migration, then `npm run db:types`
 * once the migration is live.
 *
 * Only the "in the migrations, missing from types.ts" direction is checked:
 * the opposite direction (a column in types.ts that the replay does not see)
 * includes tables created before the migration history began and columns
 * added from dynamic SQL, and check-types-fresh covers it against prod.
 *
 * @mutate src/integrations/supabase/types.ts | held_repay_owed_at: string \| null | held_repay_owed_gone: string \| null
 */

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

const IDENT = String.raw`"?(\w+)"?`;
const QUAL = String.raw`(?:"?(\w+)"?\.)?${IDENT}`;

/** Index of the `)` that closes the `(` at `open`. */
function closeParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Split on commas at paren depth 0. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const CONSTRAINT_HEAD = /^(constraint|primary|unique|check|foreign|exclude|like)\b/i;

/** public table -> (column -> migration that last added it). */
function migrationColumns(): Map<string, Map<string, string>> {
  const tables = new Map<string, Map<string, string>>();
  const isPublic = (schema: string | undefined) => (schema ?? "public").toLowerCase() === "public";
  const STMT = new RegExp(
    String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUAL}\s*\(|\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QUAL}\s+([^;]*)|\bdrop\s+table\s+(?:if\s+exists\s+)?([^;]*)`,
    "gi",
  );
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(MIGRATIONS, file), "utf8"));
    for (const m of sql.matchAll(STMT)) {
      if (m[2] !== undefined) {
        // CREATE TABLE schema.name ( ... )
        if (!isPublic(m[1])) continue;
        const name = m[2].toLowerCase();
        const open = m.index! + m[0].length - 1;
        const close = closeParen(sql, open);
        if (close === -1) continue;
        // A re-create (IF NOT EXISTS on a table that exists) keeps the old columns.
        const cols = tables.get(name) ?? new Map<string, string>();
        for (const part of splitTop(sql.slice(open + 1, close))) {
          const def = part.trim();
          if (!def || CONSTRAINT_HEAD.test(def)) continue;
          const col = /^"?(\w+)"?/.exec(def);
          if (col) cols.set(col[1].toLowerCase(), file);
        }
        tables.set(name, cols);
      } else if (m[4] !== undefined) {
        // ALTER TABLE schema.name <actions>
        if (!isPublic(m[3])) continue;
        const name = m[4].toLowerCase();
        const actions = m[5] ?? "";
        const renameTable = /^rename\s+to\s+"?(\w+)"?/i.exec(actions.trim());
        if (renameTable) {
          const cols = tables.get(name);
          tables.delete(name);
          if (cols) tables.set(renameTable[1].toLowerCase(), cols);
          continue;
        }
        const cols = tables.get(name);
        if (!cols) continue;
        const renameCol = /^rename\s+(?:column\s+)?"?(\w+)"?\s+to\s+"?(\w+)"?/i.exec(actions.trim());
        if (renameCol) {
          const from = renameCol[1].toLowerCase();
          if (cols.has(from)) {
            cols.set(renameCol[2].toLowerCase(), cols.get(from)!);
            cols.delete(from);
          }
          continue;
        }
        for (const action of splitTop(actions)) {
          const a = action.trim();
          const add = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?(\w+)"?/i.exec(a);
          if (add && !CONSTRAINT_HEAD.test(add[1])) {
            cols.set(add[1].toLowerCase(), file);
            continue;
          }
          const drop = /^drop\s+(?:column\s+)?(?:if\s+exists\s+)?"?(\w+)"?/i.exec(a);
          if (drop && !/^(constraint|default|not|identity|expression)$/i.test(drop[1])) cols.delete(drop[1].toLowerCase());
        }
      } else if (m[6] !== undefined) {
        // DROP TABLE a, b [CASCADE]
        for (const t of m[6].replace(/\b(cascade|restrict)\b/gi, "").split(",")) {
          const q = new RegExp(`^\\s*${QUAL}\\s*$`, "i").exec(t);
          if (q && isPublic(q[1])) tables.delete(q[2].toLowerCase());
        }
      }
    }
  }
  return tables;
}

/** table -> keys of its generated `Row` in the `public` `Tables` block. */
function typedColumns(): Map<string, Set<string>> {
  const text = readFileSync(resolve(ROOT, "src/integrations/supabase/types.ts"), "utf8");
  const pub = text.indexOf("\n  public: {");
  const start = text.indexOf("\n    Tables: {", pub);
  const end = text.indexOf("\n    Views: {", start);
  expect(pub).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(pub);
  expect(end).toBeGreaterThan(start);
  const block = text.slice(start, end);
  const out = new Map<string, Set<string>>();
  for (const t of block.matchAll(/^ {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm)) {
    out.set(t[1], new Set([...t[2].matchAll(/^ {10}(\w+)\??:/gm)].map((c) => c[1])));
  }
  return out;
}

describe("types.ts declares every public table column the migrations create", () => {
  const tables = migrationColumns();
  const typed = typedColumns();

  it("reads a real inventory (floors)", () => {
    expect(tables.size).toBeGreaterThan(80);
    expect(typed.size).toBeGreaterThan(80);
    const columns = [...tables.values()].reduce((n, c) => n + c.size, 0);
    expect(columns).toBeGreaterThan(800);
    expect(tables.get("tip_hold_redrives")?.has("repay_transfer_id")).toBe(true);
    expect(tables.get("chargeback_clawbacks")?.has("held_repay_owed_at")).toBe(true);
  });

  it("no migration table or column is missing from types.ts", () => {
    const missing: string[] = [];
    for (const [table, cols] of tables) {
      const have = typed.get(table);
      for (const [col, file] of cols) {
        if (!have?.has(col)) missing.push(`${table}.${col} (last added in ${file})`);
      }
    }
    expect(
      missing,
      `add these to types.ts (Row, Insert, Update) in the same commit as the migration, or run npm run db:types once it is live:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
