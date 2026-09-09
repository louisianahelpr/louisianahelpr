// The database's own opinion about what a row may contain, read out of the
// migrations — plus the table→column map, read out of the generated types.
//
// WHY THIS EXISTS
// ---------------
// Every Playwright spec CI runs talks to a mock. A mock accepts any string, so
// a fixture describing a row Postgres would reject passes forever, and every
// test built on it is a test of a state that cannot happen. Six specs carried
// `payment_status: "paid"` — a value `jobs_payment_status_check` has NEVER
// admitted — for months, and the suite was green the whole time.
//
// TypeScript cannot close this. `pricing_mode` and `payment_status` are plain
// `text` columns; the generated `Insert` type says `string`, so `"fixed"` and
// `"paid"` typecheck perfectly. The constraint is the only thing that knows,
// and the constraint lives in SQL.
//
// WHAT IT PARSES, AND WHAT IT DELIBERATELY DOES NOT
// -------------------------------------------------
// Only fully-anchored shapes are accepted:
//     col IN ('a','b')            col = ANY (ARRAY['a','b'])
//     col = 'literal'             col BETWEEN 1 AND 5
//     col >= 0 AND col <= 100     col IS NULL OR <any of the above>
// Anything else — a conditional constraint, one spanning two columns, a
// COALESCE, a length() — is SKIPPED, not half-understood. A multi-column
// constraint read as a plain value list produces false positives, and a guard
// that cries wolf gets muted, which is strictly worse than one that is silent.
// `marketing_content_instagram_needs_media` and `profiles_auto_tip_valid` are
// the two live constraints this rule discards on purpose.
//
// Verified against prod (`pg_constraint`, project fncmgoasalhdgfwzhsqa,
// 2026-09-06): prod holds 81 CHECK constraints in `public`; this parser
// recovers every one it claims to handle on every table that still exists.
// The residual differences are known and are NOT parser bugs:
//   - 4 live constraints exist in NO migration at all
//     (profiles_id_verification_status_check, profiles_insurance_status_check,
//     profiles_license_status_check, applications_ck_* were added outside the
//     ledger). They cannot be recovered from files that do not mention them.
//   - Several parsed constraints belong to tables prod dropped (businesses,
//     job_disputes, community_posts, …) and to `profiles.role`, a column prod
//     no longer has. Those are inert: no fixture can reference a table or
//     column that does not exist.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "../../..");
const MIGRATIONS = join(REPO, "supabase/migrations");
const TYPES = join(REPO, "src/integrations/supabase/types.ts");

export type EnumConstraint = {
  kind: "enum";
  column: string;
  values: string[];
  nullable: boolean;
  file: string;
};
export type RangeConstraint = {
  kind: "range";
  column: string;
  min: number | null;
  max: number | null;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
  nullable: boolean;
  file: string;
};
export type Constraint = EnumConstraint | RangeConstraint;

/**
 * `Omit` over a UNION collapses it to the keys the members share, so
 * `Omit<Constraint, "file">` loses `values` and `min` — every branch of
 * parseCheck then fails to typecheck against a shape that has neither. This
 * distributes the Omit across the members instead, which is what was meant.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ConstraintSpec = DistributiveOmit<Constraint, "file">;

/** Split a parenthesised body at commas that are not inside brackets or quotes. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let quote: string | null = null;
  for (const c of s) {
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** Contents of the bracket group opening at `open`, quotes respected. */
function balanced(s: string, open: number, oc = "(", cc = ")"): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote && s[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === oc) depth++;
    else if (c === cc) {
      depth--;
      if (depth === 0) return s.slice(open + 1, i);
    }
  }
  return null;
}

/** Collapse whitespace and peel redundant outer parens. */
function norm(s: string): string {
  let b = s.replace(/\s+/g, " ").trim();
  for (;;) {
    if (!b.startsWith("(")) break;
    if (balanced(b, 0) !== b.slice(1, -1)) break;
    b = b.slice(1, -1).trim();
  }
  return b;
}

// A column reference, tolerating `(col)::text` and `"col"`.
const COL = `(?:\\(\\s*)?"?([a-z_][a-z0-9_]*)"?(?:\\s*\\))?(?:::[a-z_ ]+)?`;

function parseCheck(bodyRaw: string): ConstraintSpec | null {
  let b = norm(bodyRaw);
  let nullable = false;

  const nul = new RegExp(`^${COL}\\s+IS\\s+NULL\\s+OR\\s+([\\s\\S]+)$`, "i").exec(b);
  if (nul) {
    nullable = true;
    b = norm(nul[2]);
  }

  // `col IN (…)` / `col = ANY (ARRAY[…])`
  const inList = new RegExp(`^${COL}\\s+(?:IN|=\\s*ANY)\\s*\\(`, "i").exec(b);
  if (inList) {
    const open = b.indexOf("(", inList[0].length - 1);
    const inner = balanced(b, open);
    if (inner === null) return null;
    // The list must be the WHOLE predicate. A trailing `AND …` means the
    // constraint is conditional and this reading of it would be wrong.
    if (norm(b.slice(open + inner.length + 2)) !== "") return null;
    if (/\bSELECT\b/i.test(inner)) return null;
    const values = [...inner.matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1].replace(/''/g, "'"));
    if (!values.length) return null;
    return { kind: "enum", column: inList[1], values, nullable };
  }

  // `col = 'literal'` — a one-value enum. jobs_pricing_mode_check is this shape.
  const eq = new RegExp(`^${COL}\\s*=\\s*'((?:[^']|'')*)'(?:::[a-z_ ]+)?$`, "i").exec(b);
  if (eq) return { kind: "enum", column: eq[1], values: [eq[2].replace(/''/g, "'")], nullable };

  const between = new RegExp(`^${COL}\\s+BETWEEN\\s+(-?[\\d.]+)\\s+AND\\s+(-?[\\d.]+)$`, "i").exec(b);
  if (between) return { kind: "range", column: between[1], min: +between[2], max: +between[3], nullable };

  const cmp = `${COL}\\s*(>=|<=|>|<)\\s*\\(?(-?[\\d.]+)\\)?(?:::[a-z_ ]+)?`;
  const range =
    new RegExp(`^${cmp}$`, "i").exec(b) || new RegExp(`^${cmp}\\s+AND\\s+${cmp}$`, "i").exec(b);
  if (range) {
    const parts: [string, string, string][] =
      range.length > 4
        ? [
            [range[1], range[2], range[3]],
            [range[4], range[5], range[6]],
          ]
        : [[range[1], range[2], range[3]]];
    // Two comparisons on DIFFERENT columns is a multi-column constraint.
    if (!parts.every((p) => p[0] === parts[0][0])) return null;
    let min: number | null = null;
    let max: number | null = null;
    let exclusiveMin = false;
    let exclusiveMax = false;
    for (const [, op, num] of parts) {
      const n = +num;
      if (op === ">=") min = n;
      else if (op === ">") {
        min = n;
        exclusiveMin = true;
      } else if (op === "<=") max = n;
      else if (op === "<") {
        max = n;
        exclusiveMax = true;
      }
    }
    return { kind: "range", column: parts[0][0], min, max, exclusiveMin, exclusiveMax, nullable };
  }

  return null;
}

/**
 * table → constraint name → constraint, replaying every migration in order so
 * a later definition supersedes an earlier one.
 */
export function extractConstraints(): Map<string, Map<string, Constraint>> {
  const byTable = new Map<string, Map<string, Constraint>>();
  const put = (table: string, name: string, rec: Constraint) => {
    if (!byTable.has(table)) byTable.set(table, new Map());
    byTable.get(table)!.set(name, rec);
  };

  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8").replace(/--[^\n]*/g, "");

    // CREATE TABLE — column-level and table-level CHECKs.
    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi,
    )) {
      const body = balanced(sql, m.index! + m[0].length - 1);
      if (!body) continue;
      const table = m[1];
      for (const part of splitTopLevel(body)) {
        const t = part.trim();
        const ci = t.search(/\bCHECK\s*\(/i);
        if (ci < 0) continue;
        const inner = balanced(t, t.indexOf("(", ci));
        if (inner === null) continue;
        const rec = parseCheck(inner);
        if (!rec) continue;
        const named = /^CONSTRAINT\s+"?([a-z0-9_]+)"?/i.exec(t);
        const colName = named ? null : /^"?([a-z_][a-z0-9_]*)"?/.exec(t)?.[1];
        if (colName && rec.column !== colName) continue;
        // Postgres names an unnamed column CHECK `<table>_<column>_check` —
        // the SAME identifier a later `DROP CONSTRAINT` uses to replace it.
        // Reproducing that convention is what makes replacement work here:
        // without it, notifications.type's original 7-value list and its
        // 18-value successor both survive and disagree.
        put(table, named ? named[1] : `${table}_${rec.column}_check`, { ...rec, file: f } as Constraint);
      }
    }

    // ALTER TABLE — ADD/DROP CONSTRAINT and ADD COLUMN … CHECK (…).
    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?);/gi,
    )) {
      const table = m[1];
      const tail = m[2];
      for (const d of tail.matchAll(/DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) {
        byTable.get(table)?.delete(d[1]);
      }
      for (const a of tail.matchAll(/ADD\s+CONSTRAINT\s+"?([a-z0-9_]+)"?\s+CHECK\s*\(/gi)) {
        const inner = balanced(tail, a.index! + a[0].length - 1);
        if (inner === null) continue;
        const rec = parseCheck(inner);
        if (rec) put(table, a[1], { ...rec, file: f } as Constraint);
      }
      // `ADD COLUMN <col> <type> … CHECK (…)` is how applications.stake_status
      // got its constraint; missing this shape silently drops a live enum.
      for (const a of tail.matchAll(
        /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?([^,;]*?)\bCHECK\s*\(/gi,
      )) {
        const inner = balanced(tail, a.index! + a[0].length - 1);
        if (inner === null) continue;
        const rec = parseCheck(inner);
        if (rec && rec.column === a[1]) put(table, `${table}_${a[1]}_check`, { ...rec, file: f } as Constraint);
      }
    }
  }
  return byTable;
}

/**
 * table → column names, read from the GENERATED types — which are produced from
 * the live schema, so this is the closest thing in the repo to prod's own
 * column list. Used to decide which column names identify a table.
 */
export function schemaTables(): Map<string, Set<string>> {
  const src = readFileSync(TYPES, "utf8");
  const out = new Map<string, Set<string>>();
  const re = /\n {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g;
  re.lastIndex = src.indexOf("Tables: {");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.set(m[1], new Set([...("\n" + m[2]).matchAll(/\n {10}([a-z0-9_]+)\??:/g)].map((c) => c[1])));
  }
  return out;
}

/**
 * table → columns the Insert type marks REQUIRED (no `?`) — i.e. NOT NULL with
 * no default. A fixture row missing one of these is a row the database would
 * refuse, and a row the app then reads with a field that is `undefined`.
 * `notifications.message` was spelled `body` in the seed for months: prod's
 * NOT NULL made it impossible, the mock served it, and every authed smoke spec
 * crashed on `n.message.toLowerCase()` while the contract graded the row clean.
 */
export function schemaRequired(): Map<string, Set<string>> {
  const src = readFileSync(TYPES, "utf8");
  const out = new Map<string, Set<string>>();
  const re = /\n {6}([a-z0-9_]+): \{\n {8}Row: \{[\s\S]*?\n {8}\}\n {8}Insert: \{\n([\s\S]*?)\n {8}\}/g;
  re.lastIndex = src.indexOf("Tables: {");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.set(m[1], new Set([...("\n" + m[2]).matchAll(/\n {10}([a-z0-9_]+):/g)].map((c) => c[1])));
  }
  return out;
}

/**
 * Column names owned by exactly one table. An object literal carrying one is a
 * row of that table — which is how a bare `{ …, status: "completed" }` in a
 * spec gets attributed without a hand-kept list of fixture names.
 *
 * The alternative — "any column called `status` must satisfy SOME table's
 * status constraint" — was tried and produces 237 findings of which ~234 are
 * noise, because `status`, `type`, `role` and `reason` are ordinary English
 * words that test code uses for its own report objects.
 */
export function distinctiveColumns(schema = schemaTables()): Map<string, string> {
  const count = new Map<string, number>();
  const owner = new Map<string, string>();
  for (const [table, cols] of schema) {
    for (const c of cols) {
      count.set(c, (count.get(c) ?? 0) + 1);
      owner.set(c, table);
    }
  }
  const out = new Map<string, string>();
  for (const [c, n] of count) if (n === 1) out.set(c, owner.get(c)!);
  return out;
}

/** Every `{ … }` literal in a source file, nested ones included. */
export function objectLiterals(src: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "{") continue;
    const lit = balanced(src, i, "{", "}");
    if (lit !== null) out.push(`{${lit}}`);
  }
  return out;
}

export type Violation = { where: string; message: string };

/** Check one row (as an object, or as literal source text) against a table. */
export function checkRow(
  table: string,
  read: (column: string) => { present: boolean; value: unknown },
  constraints: Map<string, Constraint>,
  where: string,
): Violation[] {
  const out: Violation[] = [];
  for (const [name, c] of constraints) {
    const { present, value } = read(c.column);
    if (!present || value === null || value === undefined) continue;
    if (c.kind === "enum") {
      if (typeof value !== "string" || !c.values.includes(value)) {
        out.push({
          where,
          message: `${table}.${c.column} = ${JSON.stringify(value)} — ${name} admits only ${JSON.stringify(c.values)}`,
        });
      }
      continue;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    if (c.min !== null && (c.exclusiveMin ? n <= c.min : n < c.min)) {
      out.push({ where, message: `${table}.${c.column} = ${n} — ${name} requires ${c.exclusiveMin ? ">" : ">="} ${c.min}` });
    }
    if (c.max !== null && (c.exclusiveMax ? n >= c.max : n > c.max)) {
      out.push({ where, message: `${table}.${c.column} = ${n} — ${name} requires ${c.exclusiveMax ? "<" : "<="} ${c.max}` });
    }
  }
  return out;
}

/**
 * Read a `column: "value"` / `column: 123` pair out of literal source text.
 *
 * Whole-line comments are stripped first, and the key may be preceded by
 * indentation. Both matter: the first draft anchored on `[{,]\s*` alone and
 * silently skipped every field whose preceding line was a comment — which in
 * this codebase, where fixtures are heavily annotated, is most of them.
 */
export function literalReader(text: string) {
  const clean = text.replace(/^\s*\/\/[^\n]*$/gm, "");
  return (column: string) => {
    const m = new RegExp(`(?:^\\s*|[{,]\\s*)${column}:\\s*(?:"([^"]*)"|(-?[\\d.]+))`, "m").exec(clean);
    if (!m) return { present: false, value: undefined };
    return { present: true, value: m[1] !== undefined ? m[1] : Number(m[2]) };
  };
}

export { balanced };
