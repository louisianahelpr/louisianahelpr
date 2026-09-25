/**
 * REST QUERY-STRING COLUMN CONTRACT. Every literal PostgREST query string in
 * the repo — `rest/v1/<table>?<col>=<op>.<value>` or a bare
 * `<table>?<col>=<op>.` handed to a REST helper — names only columns the table
 * has in the committed prod schema snapshot
 * (scripts/audit/write-contract.snapshot.json, refreshed nightly).
 *
 * WHY. PostgREST answers a filter on a column the table does not have with a
 * 400 (Postgres 42703) for the WHOLE request, so a test cleanup that filters by
 * a missing column deletes nothing and leaves its fixtures on prod. Q323
 * (2026-09-23): a fixture cleanup sent
 *   DELETE /rest/v1/analytics_events?job_id=eq.<id>
 * 12 times; analytics_events has no job_id column (the job id lives in
 * properties->>job_id), so every call failed with
 * `column analytics_events.job_id does not exist` in postgres_logs.
 * edgeFilterColumnContract.test.ts covers supabase-js `.from()` chains in edge
 * functions; this covers the raw REST shape, which is how e2e/ and scripts/
 * talk to prod.
 *
 * Scope, stated so a pass is not over-read: string and template literals in
 * e2e/, scripts/, src/ and supabase/functions whose text is
 * `[rest/v1/]<table>?<query>` with <table> in the snapshot. Query keys checked:
 * filters (`col=<op>.`), and `order=col.<dir>`. `select=`, `or=`/`and=`
 * groups, embedded-resource filters (`a.b=`) and query strings assembled from
 * variables (`${table}?${filter}`) are not followed.
 */
// @mutate e2e/journeys/abuse/contact-smuggling.spec.ts | rest/v1/user_violations?user_id=eq. | rest/v1/user_violations?violator_id=eq.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error — plain .mjs script, no type declarations
import * as contract from "../../scripts/audit/write-contract.mjs";
import { blankComments } from "./helpers/blankNonCode";

type Snapshot = { tables: Record<string, { columns: Record<string, unknown> }> };

const ROOT = process.cwd();
const DIRS = ["e2e", "scripts", "src", path.join("supabase", "functions")];
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "or", "and", "not"]);
const OPS = /^(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|match|imatch|is|isdistinct|in|cs|cd|ov|sl|sr|nxr|nxl|adj|fts|plfts|phfts|wfts)\./;

function listFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (/\.(?:ts|tsx|mjs|js)$/.test(e.name) && p !== __filename) out.push(p);
  }
  return out;
}

export type QueryUse = { file: string; line: number; table: string; column: string; key: string };

/** Every literal `[rest/v1/]<table>?<query>` in one file's code (comments blanked), with the columns it names. */
export function extractQueryUses(rel: string, text: string): QueryUse[] {
  const code = blankComments(text);
  const uses: QueryUse[] = [];
  // Start of a string/template literal, a `/`, or `}` (end of `${url}`), then the table and `?`.
  const re = /(?<=["'`/}])([a-z_][a-z0-9_]*)\?([^"'`\s]*)/g;
  for (const m of code.matchAll(re)) {
    const table = m[1];
    const line = code.slice(0, m.index).split("\n").length;
    for (const part of m[2].split("&")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const key = part.slice(0, eq);
      const value = part.slice(eq + 1);
      if (key === "order") {
        for (const o of value.split(",")) {
          const col = o.split(".")[0];
          if (/^[a-z_][a-z0-9_]*$/.test(col)) uses.push({ file: rel, line, table, column: col, key });
        }
        continue;
      }
      if (RESERVED.has(key) || !/^[a-z_][a-z0-9_]*$/.test(key)) continue;
      if (!OPS.test(value)) continue;
      uses.push({ file: rel, line, table, column: key, key });
    }
  }
  return uses;
}

export function unknownQueryColumns(uses: QueryUse[], snapshot: Snapshot): QueryUse[] {
  return uses.filter((u) => snapshot.tables[u.table] && !(u.column in snapshot.tables[u.table].columns));
}

describe("REST query-string column contract", () => {
  const snapshot: Snapshot = contract.loadSnapshot();
  const uses = DIRS.flatMap((d) => listFiles(path.join(ROOT, d))).flatMap((f) =>
    extractQueryUses(path.relative(ROOT, f).split(path.sep).join("/"), fs.readFileSync(f, "utf8")),
  );
  const checked = uses.filter((u) => snapshot.tables[u.table]);

  it("inventories the repo's literal REST query strings (a broken extractor must not pass vacuously)", () => {
    expect(checked.length).toBeGreaterThan(400);
    expect(new Set(checked.map((u) => u.table)).size).toBeGreaterThan(30);
    expect(new Set(checked.map((u) => u.file.split("/")[0])).size).toBeGreaterThan(1);
  });

  it("no literal REST query filters or orders by a column prod does not have", () => {
    const bad = unknownQueryColumns(uses, snapshot).map((u) => `${u.file}:${u.line} ${u.table}?${u.key === "order" ? `order=${u.column}` : `${u.column}=`}`);
    expect(bad).toEqual([]);
  });

  it("RED on the exact Q323 call: analytics_events filtered by job_id", () => {
    const original = "await api(`${SUPABASE_URL}/rest/v1/analytics_events?job_id=eq.${jobId}`, { method: 'DELETE' });";
    const bad = unknownQueryColumns(extractQueryUses("harness.mjs", original), snapshot);
    expect(bad.map((u) => `${u.table}.${u.column}`)).toEqual(["analytics_events.job_id"]);
  });

  it("fails when a live column is removed from the snapshot", () => {
    const s: Snapshot = JSON.parse(JSON.stringify(snapshot));
    delete s.tables.jobs.columns.customer_id;
    expect(unknownQueryColumns(uses, s).some((u) => u.table === "jobs" && u.column === "customer_id")).toBe(true);
  });
});
