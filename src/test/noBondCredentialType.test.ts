// @mutate supabase/migrations/20260923130457_remove_bond_credential_type.sql |   IF p_type NOT IN ('trade_license', 'insurance') THEN |   IF p_type NOT IN ('trade_license', 'insurance', 'bond') THEN
// @mutate supabase/migrations/20260923130457_remove_bond_credential_type.sql |           AND hc.credential_type = 'insurance'\n |           AND hc.credential_type IN ('insurance','bond')\n
// @mutate supabase/migrations/20260923130457_remove_bond_credential_type.sql | 'trade_license'::text, 'insurance'::text])); | 'trade_license'::text, 'insurance'::text, 'bond'::text]));
// @mutate supabase/migrations/20260923130457_remove_bond_credential_type.sql |   DROP CONSTRAINT IF EXISTS helper_credentials_pending_bond_needs_document;\n |   ALTER COLUMN document_url DROP DEFAULT;\n
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { balanced } from "./helpers/schemaConstraints";

/**
 * Q141 (docs/OPEN.md, OWNER DECISION 2026-09-23): the unused 'bond' credential
 * type is removed. Also closes Q134 (a submitted bond had no reviewer).
 *
 * Before (prod, 2026-09-23): get_user_credential_tier counted a verified bond
 * as insured, helper_credential_document_ok accepted a bond document,
 * helper_credentials_credential_type_check admitted 'bond', and
 * helper_credentials_pending_bond_needs_document (Q130) existed — yet no
 * screen, edge function, admin queue or review RPC handled a bond.
 * 20260923130457 deletes the one (seed) bond row and removes all four.
 *
 * Reading every migration in order (comments blanked, any dollar-quote tag):
 *   - the NEWEST definition of every public function names no 'bond' literal;
 *   - every CHECK constraint that ever named 'bond' (column-level in CREATE
 *     TABLE, or ADD CONSTRAINT) is, at the end of the history, dropped or
 *     replaced by a definition without it.
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = new Map(files.map((f) => [f, blankSqlComments(readFileSync(join(MIG, f), "utf8"))]));
const BOND = /'bond'/i;

/** name → newest body, replaying CREATE [OR REPLACE] FUNCTION and DROP FUNCTION in order. */
function newestFunctionBodies(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  const ev = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(|DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_0-9]+)"?/gi;
  for (const file of files) {
    const sql = sqlOf.get(file)!;
    for (const m of sql.matchAll(ev)) {
      if (m[2]) {
        out.delete(m[2].toLowerCase());
        continue;
      }
      const rest = sql.slice(m.index!);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
      if (!tag) continue;
      const open = tag.index! + tag[0].length;
      const close = rest.indexOf(tag[1], open);
      if (close < 0) continue;
      out.set(m[1].toLowerCase(), { file, body: rest.slice(open, close) });
    }
  }
  return out;
}

type Check = { name: string; file: string; bond: boolean };
/** Final CHECK constraints (name → last definition), replaying ADD / DROP CONSTRAINT and CREATE TABLE. */
function finalChecks(): { final: Map<string, Check>; everBond: Set<string> } {
  const final = new Map<string, Check>();
  const everBond = new Set<string>();
  const put = (c: Check) => {
    final.set(c.name, c);
    if (c.bond) everBond.add(c.name);
  };
  for (const file of files) {
    const sql = sqlOf.get(file)!;
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi)) {
      const body = balanced(sql, m.index! + m[0].length - 1);
      if (!body) continue;
      for (const col of body.matchAll(/(?:^|,)\s*(?:CONSTRAINT\s+"?([a-z0-9_]+)"?\s+CHECK|"?([a-z_][a-z0-9_]*)"?\s[^,(]*?\bCHECK)\s*\(/gi)) {
        const inner = balanced(body, col.index! + col[0].length - 1);
        if (inner === null) continue;
        put({ name: col[1] ?? `${m[1]}_${col[2]}_check`, file, bond: BOND.test(inner) });
      }
    }
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?[a-z0-9_]+"?([\s\S]*?);/gi)) {
      const tail = m[1];
      const ev = /DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?|ADD\s+CONSTRAINT\s+"?([a-z0-9_]+)"?\s+CHECK\s*\(/gi;
      for (const e of tail.matchAll(ev)) {
        if (e[1]) {
          final.delete(e[1]);
          continue;
        }
        const inner = balanced(tail, e.index! + e[0].length - 1);
        if (inner === null) continue;
        put({ name: e[2], file, bond: BOND.test(inner) });
      }
    }
  }
  return { final, everBond };
}

describe("the 'bond' credential type is gone (Q141, closes Q134)", () => {
  it("reads a real migration history", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("no newest public function definition names 'bond'", () => {
    const defs = newestFunctionBodies();
    expect(defs.size).toBeGreaterThan(300);
    // Both functions that named it before Q141 are still defined and were read.
    expect(defs.get("get_user_credential_tier")?.body).toMatch(/cred_insured/);
    expect(defs.get("helper_credential_document_ok")?.body).toMatch(/p_type NOT IN/);
    const named = [...defs].filter(([, d]) => BOND.test(d.body)).map(([n, d]) => `${n} (${d.file})`);
    expect(named).toEqual([]);
  });

  it("every CHECK that ever admitted 'bond' is dropped or redefined without it", () => {
    const { final, everBond } = finalChecks();
    expect(final.size).toBeGreaterThan(50);
    // The two the history is known to hold: the inline type CHECK (20260612140000) and Q130's.
    expect([...everBond].sort()).toEqual(["helper_credentials_credential_type_check", "helper_credentials_pending_bond_needs_document"]);
    const still = [...final.values()].filter((c) => c.bond).map((c) => `${c.name} (${c.file})`);
    expect(still).toEqual([]);
    // The type CHECK itself survives, without bond.
    expect(final.get("helper_credentials_credential_type_check")?.bond).toBe(false);
  });
});
