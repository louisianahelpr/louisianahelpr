// Source-derived facts the offer-privacy guard (offeredHelperPrivacy.test.ts)
// is built from. Kept out of the spec so the spec reads as assertions.
//
// Everything here is DERIVED — from supabase/migrations/*.sql, from
// src/integrations/supabase/types.ts and from the repo's own source text.
// Nothing is hand-typed twice.

import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * A copy of `sql` with every `--` line comment and `/* *\/` block comment
 * replaced by spaces, so offsets into it are offsets into the original.
 * Finding `CREATE VIEW` in raw migration text otherwise matches the prose:
 * five of this repo's migrations explain themselves with the words
 * "CREATE OR REPLACE VIEW only preserves…" in a comment.
 */
export function maskComments(sql: string): string {
  const out = sql.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " ";
  };
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      blank(i, nl < 0 ? sql.length : nl);
      i = nl < 0 ? sql.length : nl;
    } else if (sql[i] === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      blank(i, end < 0 ? sql.length : end + 2);
      i = end < 0 ? sql.length : end + 1;
    }
  }
  return out.join("");
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

const readMigration = (file: string): string => readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8");

export type DbObject = {
  /** `function` or `view`. */
  kind: "function" | "view";
  name: string;
  /** The migration whose definition is the LATEST one, i.e. what prod runs. */
  file: string;
  /** The whole CREATE statement, verbatim. */
  text: string;
  /**
   * The same statement with every SQL comment blanked (offsets preserved).
   *
   * ASSERT AGAINST THIS, NEVER `text`. Found hollow 2026-09-21: the guard
   * passed 13/13 with `open_jobs_browse` projecting `offered_to_helper_id`
   * RAW — the owner-decided leak, back in the browse feed for every viewer —
   * because the deleted CASE was left behind as a `--` line and every
   * `.toContain(...)` read the dead comment as the live definition.
   */
  code: string;
};

/**
 * The latest definition of every function and view in the migrations, keyed
 * `function:name` / `view:name`. Migrations are applied in filename order, so
 * the last definition wins — the same order db-deploy uses.
 */
export function latestDefinitions(): Map<string, DbObject> {
  const latest = new Map<string, DbObject>();
  for (const file of migrationFiles()) {
    const raw = readMigration(file);
    const sql = maskComments(raw);

    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) {
      const start = m.index!;
      // A function body is dollar-quoted; the statement ends at the first `;`
      // after the body's closing tag.
      const tag = sql.slice(start).match(/\$([a-zA-Z0-9_]*)\$/)?.[0];
      if (!tag) continue;
      const bodyStart = sql.indexOf(tag, start) + tag.length;
      const bodyEnd = sql.indexOf(tag, bodyStart);
      if (bodyEnd < 0) continue;
      const end = sql.indexOf(";", bodyEnd);
      if (end < 0) continue;
      latest.set(`function:${m[1].toLowerCase()}`, { kind: "function", name: m[1].toLowerCase(), file, text: raw.slice(start, end + 1), code: sql.slice(start, end + 1) });
    }

    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?([a-z0-9_]+)\b/gi)) {
      const start = m.index!;
      const end = sql.indexOf(";", start);
      if (end < 0) continue;
      latest.set(`view:${m[1].toLowerCase()}`, { kind: "view", name: m[1].toLowerCase(), file, text: raw.slice(start, end + 1), code: sql.slice(start, end + 1) });
    }
  }
  return latest;
}

/** The `RETURNS …` clause of a function definition, up to the language clause. */
function returnsClause(text: string): string {
  const m = maskComments(text).match(/\bRETURNS\s+([\s\S]*?)\b(LANGUAGE|AS)\b/i);
  return m ? m[1] : "";
}

/**
 * Can this object hand `jobs.offered_to_helper_id` to whoever calls it?
 *
 * TRUE when the object's OUTPUT SHAPE carries the column: a view that projects
 * it, or a function returning `jobs` rows (`SETOF jobs`) or a `TABLE(...)` that
 * names it. FALSE for a trigger, a boolean/timestamp/uuid-returning helper or a
 * `TABLE(...)` without it — those can TEST the column but cannot return it, so
 * they are not read paths.
 */
export function returnsOffereeColumn(obj: DbObject): boolean {
  const body = maskComments(obj.text);
  if (obj.kind === "view") {
    const sel = body.slice(body.search(/\bSELECT\b/i));
    const targetList = sel.slice(0, sel.search(/\n\s*FROM\b/i) < 0 ? sel.length : sel.search(/\n\s*FROM\b/i));
    return /offered_to_helper_id/i.test(targetList);
  }
  const ret = returnsClause(obj.text);
  if (/\bSETOF\s+(public\.)?jobs\b/i.test(ret) || /^\s*(public\.)?jobs\s*$/i.test(ret)) return true;
  if (/\bTABLE\s*\(/i.test(ret)) return /offered_to_helper_id/i.test(ret);
  return false;
}

// ── the jobs column set, from the migrations and from the generated types ───

/** Columns of `public.jobs` as the migration history builds them up. */
export function jobsColumnsFromMigrations(): Set<string> {
  const cols = new Set<string>();
  for (const file of migrationFiles()) {
    const sql = maskComments(readMigration(file));
    const create = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?jobs\s*\(([\s\S]*?)\n\s*\);/i);
    if (create) {
      for (const line of create[1].split("\n")) {
        const m = line.trim().match(/^"?([a-z0-9_]+)"?\s+[a-z]/i);
        if (m && !/^(constraint|primary|unique|foreign|check|exclude|like)$/i.test(m[1])) cols.add(m[1].toLowerCase());
      }
    }
    for (const alter of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?jobs\b([\s\S]*?);/gi)) {
      for (const a of alter[1].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) cols.add(a[1].toLowerCase());
      for (const d of alter[1].matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) cols.delete(d[1].toLowerCase());
    }
  }
  return cols;
}

/** Columns of `public.jobs` per the generated types, which are regenerated from prod. */
export function jobsColumnsFromTypes(): string[] {
  const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
  const block = types.slice(types.indexOf("\n      jobs: {"));
  const row = block.slice(block.indexOf("Row: {") + 6, block.indexOf("\n        }"));
  return row
    .trim()
    .split("\n")
    .map((l) => l.trim().match(/^([a-z0-9_]+):/)?.[1])
    .filter((c): c is string => Boolean(c));
}

/** Migrations that ADD a column to `public.jobs`, newest last. */
export function migrationsAddingJobsColumns(): Array<{ file: string; columns: string[]; text: string }> {
  const out: Array<{ file: string; columns: string[]; text: string }> = [];
  for (const file of migrationFiles()) {
    const raw = readMigration(file);
    const sql = maskComments(raw);
    const columns: string[] = [];
    for (const alter of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?jobs\b([\s\S]*?);/gi)) {
      for (const a of alter[1].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) columns.push(a[1].toLowerCase());
    }
    if (columns.length) out.push({ file, columns, text: sql });
  }
  return out;
}

// ── source-text helpers for the client-read guard ───────────────────────────

/**
 * `src` with line and block comments blanked, same length. The jobs-read rules
 * below are about CODE; `src/lib/jobColumns.ts` documents the very pattern it
 * forbids, and a doc comment is not a query.
 */
export function maskJsComments(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " ";
  };
  for (let i = 0; i < src.length; i++) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const nl = src.indexOf("\n", i);
      blank(i, nl < 0 ? src.length : nl);
      i = nl < 0 ? src.length : nl;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      blank(i, end < 0 ? src.length : end + 2);
      i = end < 0 ? src.length : end + 1;
    }
  }
  return out.join("");
}

/**
 * The whole string literal containing offset `idx`, `${…}` interpolations and
 * the quotes they contain included. A naive "scan to the next quote" reads
 * `` `jobs?id=eq.${sid("job:group")}&select=id` `` as ending at `"job:` and
 * then reports a select-less URL that does not exist.
 */
export function enclosingLiteral(src: string, idx: number): string | null {
  const readFrom = (start: number): string | null => {
    const quote = src[start];
    let depth = 0;
    for (let i = start + 1; i < src.length; i++) {
      if (quote === "`" && src[i] === "$" && src[i + 1] === "{") { depth++; i++; continue; }
      if (depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        continue;
      }
      if (src[i] === "\\") { i++; continue; }
      if (src[i] === quote) return src.slice(start + 1, i);
      if (quote !== "`" && src[i] === "\n") return null;
    }
    return null;
  };

  // Walk outwards through nested delimiters: the nearest quote before the path
  // may belong to a `${…}` interpolation rather than to the URL's own literal.
  let from = idx + 1;
  for (let attempt = 0; attempt < 4; attempt++) {
    let start = -1;
    for (let i = Math.min(from, src.length) - 1; i >= 0; i--) {
      if ((src[i] === "`" || src[i] === '"' || src[i] === "'") && src[i - 1] !== "\\") { start = i; break; }
    }
    if (start < 0) return null;
    const literal = readFrom(start);
    if (literal !== null && literal.includes("jobs?")) return literal;
    from = start;
  }
  return null;
}

/** Every offset in `src` where a PostgREST path for `public.jobs` begins. */
export function jobsRestPathOffsets(src: string): number[] {
  const out: number[] = [];
  for (const m of src.matchAll(/(?:rest\/v1\/|[`"'])jobs\?/g)) out.push(m.index!);
  return out;
}

/** Files that talk to PostgREST as `service_role`, where column grants do not apply. */
export function isServiceRoleFile(src: string): boolean {
  return /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|serviceKey|service-role|lib\/prodEnv\.mjs/.test(src);
}
