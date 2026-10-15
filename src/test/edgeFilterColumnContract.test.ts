/**
 * EDGE FILTER-COLUMN CONTRACT. Every `.from("<table>")` chain in
 * supabase/functions that filters, orders or selects by a literal column name
 * is checked against the committed prod schema snapshot
 * (scripts/audit/write-contract.snapshot.json, refreshed nightly).
 *
 * WHY. PostgREST answers a filter on a column the table does not have with a
 * 400 for the WHOLE request, and the edge mock store (src/test/edge/mocks/
 * supabase.ts) ignores filter columns entirely, so no edge test can see it.
 * On 2026-09-14 the dispute-races branch shipped
 *   .from("payment_refunds").select("id").eq("job_id", jobId).in("status", …)
 * inside create-payment's fail-closed ledger cross-check. `payment_refunds` has
 * no `status` column (verified live), so the read errored on every call and
 * EVERY admin Quick Release would have answered 503 — while every edge test
 * stayed green. The write contract covers src/ writes; nothing covered edge
 * reads. This does.
 *
 * Scope, stated so a pass is not over-read: literal first-argument columns of
 * eq/neq/gt/gte/lt/lte/like/ilike/is/in/contains/not/order, and plain
 * comma-separated `.select("a, b")` lists, on chains whose `.from()` table is a
 * literal or a same-file const of literals (the defect's own shape) and is in
 * the snapshot (tables the client never writes are not in it and are not
 * checked). A chain split across variables is not followed.
 *
 * RED on 51305c81c's create-payment/index.ts: lists
 * `create-payment/index.ts:2250 .in("status") on payment_refunds`.
 *
 * PENDING vs MISSING (same rule as the write contract, Q1072). The snapshot is
 * a frozen copy of prod, so a column that a migration in THIS tree adds, and
 * that prod had not applied when the snapshot was read, is absent from it
 * without being missing: functions-deploy.yml waits for the same commit's
 * db-deploy run before it uploads any function, so the column exists before
 * the edge read does. write-contract.mjs's pendingDefinitions() tells the two
 * apart exactly (a migration file above the snapshot's `appliedMigrations.latest`,
 * with every file at or below it accounted for, that ALTERs that very table to
 * ADD that very column); when the metadata is inexact nothing is pending and
 * every absent column stays red (fail closed). A column no pending migration
 * adds is red as before. 2026-10-15: the flat-fee branch's 13 edge reads of
 * jobs.helper_fee_flat_cents (added by 20261015023908) were red here although
 * that migration ships in the same push.
 */
// Proven able to fail 2026-09-20: filtering a real edge read by a column
// prod does not have (applications.worker_id) turns it red.
// Proven able to fail with the pending set applied (2026-10-15): a column NO
// migration adds, on a read beside a pending one, is still red.
// @mutate supabase/functions/release-payout/index.ts | stripe_session_id, helper_fee_percent, helper_fee_flat_cents, is_seed | stripe_session_id, helper_fee_percent, helper_fee_flat_cent, is_seed
// @mutate supabase/functions/cleanup-abandoned-accounts/index.ts | supabase.from("applications").select("id", { count: "exact", head: true }).eq("helper_id", u.id) | supabase.from("applications").select("id", { count: "exact", head: true }).eq("worker_id", u.id)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
// @ts-expect-error — plain .mjs script, no type declarations
import * as contract from "../../scripts/audit/write-contract.mjs";

type Snapshot = { tables: Record<string, { columns: Record<string, unknown> }> };

const ROOT = process.cwd();
const FUNCTIONS = path.join(ROOT, "supabase", "functions");
const FILTER_METHODS = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "not", "order",
]);

function listEdgeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listEdgeFiles(p));
    else if (e.name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const literal = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

/**
 * The table names a `.from(<arg>)` can mean: a literal, or an identifier bound
 * in the same file to a literal or to a `cond ? "a" : "b"` of literals. The
 * 2026-09-14 defect was exactly the second shape
 * (`const table = action === "release" ? "payment_refunds" : "payout_transfers"`),
 * so a literal-only extractor passed it.
 */
function tableCandidates(arg: ts.Expression | undefined, sf: ts.SourceFile): string[] {
  if (!arg) return [];
  const lit = literal(arg);
  if (lit) return [lit];
  if (!ts.isIdentifier(arg)) return [];
  const out = new Set<string>();
  const fromInit = (init: ts.Expression | undefined) => {
    if (!init) return;
    while (ts.isParenthesizedExpression(init)) init = init.expression;
    const l = literal(init);
    if (l) out.add(l);
    else if (ts.isConditionalExpression(init)) { fromInit(init.whenTrue); fromInit(init.whenFalse); }
  };
  const find = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === arg.text) fromInit(n.initializer);
    ts.forEachChild(n, find);
  };
  find(sf);
  return [...out];
}

export type ColumnUse = { file: string; line: number; table: string; column: string; method: string };

/** Pull every literal column a `.from(<table>)` chain filters/orders/selects by, from one source text. */
export function extractColumnUses(file: string, text: string): ColumnUse[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const uses: ColumnUse[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (FILTER_METHODS.has(method) || method === "select") {
        // Walk down the receiver chain to the nearest `.from("<table>")`.
        let cur: ts.Expression = node.expression.expression;
        let tables: string[] = [];
        let blocked = false;
        while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
          const name = cur.expression.name.text;
          // `.rpc()` / `.storage` chains have no table; an insert/update payload
          // select is still on the table, so those links are walked through.
          if (name === "rpc" || name === "storage") { blocked = true; break; }
          if (name === "from") { tables = tableCandidates(cur.arguments[0], sf); break; }
          cur = cur.expression.expression;
        }
        for (const table of blocked ? [] : tables) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const rel = path.relative(ROOT, file).split(path.sep).join("/");
          if (method === "select") {
            const cols = literal(node.arguments[0]);
            // Plain column lists only: `*`, embeds, aliases, casts and JSON paths are skipped.
            if (cols && !/[*()!:>-]/.test(cols)) {
              for (const c of cols.split(",").map((x) => x.trim()).filter(Boolean)) {
                uses.push({ file: rel, line, table, column: c, method });
              }
            }
          } else {
            const col = literal(node.arguments[0]);
            if (col && /^[a-z_][a-z0-9_]*$/i.test(col)) uses.push({ file: rel, line, table, column: col, method });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return uses;
}

type Pending = { exact: boolean; columns: Map<string, string> };
const NO_PENDING: Pending = { exact: false, columns: new Map() };

/** Absent from the snapshot AND not added by a migration prod had not applied yet (exact metadata only). */
export function unknownColumns(uses: ColumnUse[], snapshot: Snapshot, pending: Pending = NO_PENDING): ColumnUse[] {
  return uses.filter(
    (u) =>
      snapshot.tables[u.table] &&
      !(u.column in snapshot.tables[u.table].columns) &&
      !(pending.exact && pending.columns.has(`${u.table}.${u.column}`)),
  );
}

describe("edge filter-column contract", () => {
  const snapshot: Snapshot = contract.loadSnapshot();
  const pending: Pending = contract.pendingDefinitions(snapshot, path.join(ROOT, "supabase", "migrations"));
  const uses = listEdgeFiles(FUNCTIONS).flatMap((f) => extractColumnUses(f, fs.readFileSync(f, "utf8")));

  it("inventories the edge functions' column filters (a broken extractor must not pass vacuously)", () => {
    const checked = uses.filter((u) => snapshot.tables[u.table]);
    expect(checked.length).toBeGreaterThan(300);
    expect(new Set(checked.map((u) => u.table)).size).toBeGreaterThan(20);
    expect(checked.some((u) => u.table === "payout_transfers" && u.column === "status")).toBe(true);
  });

  it("no edge function filters, orders or selects by a column prod does not have", () => {
    const bad = unknownColumns(uses, snapshot, pending).map((u) => `${u.file}:${u.line} .${u.method}("${u.column}") on ${u.table}`);
    expect(bad).toEqual([]);
  });

  it("a pending column passes only while its own migration is pending and the metadata is exact", () => {
    const use: ColumnUse = { file: "f.ts", line: 1, table: "jobs", column: "fee_x", method: "select" };
    const s: Snapshot = { tables: { jobs: { columns: { id: {} } } } };
    const added = new Map([["jobs.fee_x", "20990101000000_add_fee_x.sql"]]);
    // pending + exact: not missing
    expect(unknownColumns([use], s, { exact: true, columns: added })).toEqual([]);
    // inexact metadata: fail closed
    expect(unknownColumns([use], s, { exact: false, columns: added })).toEqual([use]);
    // a pending migration that adds a DIFFERENT column, or the same column to another table: still missing
    expect(unknownColumns([use], s, { exact: true, columns: new Map([["jobs.fee_y", "m.sql"]]) })).toEqual([use]);
    expect(unknownColumns([use], s, { exact: true, columns: new Map([["applications.fee_x", "m.sql"]]) })).toEqual([use]);
    // no pending info at all (the default): missing
    expect(unknownColumns([use], s)).toEqual([use]);
  });

  it("the pending set read from this tree is exact, so a column it lacks is graded, not waved through", () => {
    expect(pending.exact).toBe(true);
    // the 2026-09-14 defect's column is added by no migration: it stays red even with the pending set applied
    expect(pending.columns.has("payment_refunds.status")).toBe(false);
  });

  it("RED on the exact 2026-09-14 defect: payment_refunds filtered by `status`", () => {
    const original = `
      async function escrowAlreadyMovedTheOtherWay(supabaseAdmin, jobId, action) {
        const table = action === "release" ? "payment_refunds" : "payout_transfers";
        const statuses = action === "release" ? ["pending", "succeeded", "paid"] : ["pending", "paid"];
        const { data, error } = await supabaseAdmin
          .from(table).select("id").eq("job_id", jobId).in("status", statuses).limit(1);
      }`;
    const bad = unknownColumns(extractColumnUses(path.join(FUNCTIONS, "create-payment/index.ts"), original), snapshot, pending);
    expect(bad.map((u) => `${u.table}.${u.column}`)).toEqual(["payment_refunds.status"]);
  });

  it("fails when a live column is removed from the snapshot", () => {
    const s: Snapshot = JSON.parse(JSON.stringify(snapshot));
    delete s.tables.payout_transfers.columns.status;
    expect(unknownColumns(uses, s, pending).some((u) => u.table === "payout_transfers" && u.column === "status")).toBe(true);
  });
});
