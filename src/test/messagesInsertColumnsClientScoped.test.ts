// Q340: the table-level INSERT comes back (the column grants alone stay).
// @mutate supabase/migrations/20261003182009_messages_insert_columns_client_scoped.sql |   REVOKE INSERT ON public.messages FROM PUBLIC, anon, authenticated; |   REVOKE INSERT ON public.messages FROM PUBLIC, anon;
// Q340: the client starts sending a server-owned column the grant does not cover.
// @mutate src/pages/messages/messagesData/sendHandlers.ts |         job_id: optimistic.job_id,\n        sender_id: optimistic.sender_id, |         job_id: optimistic.job_id,\n        is_system: false,\n        sender_id: optimistic.sender_id,
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
// @ts-expect-error — plain .mjs script, no type declarations
import * as contract from "../../scripts/audit/write-contract.mjs";

/**
 * A SIGNED-IN CLIENT INSERTS ONLY THE COLUMNS IT SENDS (Q340).
 *
 * `authenticated` held TABLE-level INSERT on public.messages (live,
 * 2026-10-03), so a direct POST could set is_system (a message the thread
 * renders as a platform notice, and that the edit policy will not let its
 * author take back), created_at (a future stamp keeps the 15-minute edit
 * window open forever), read/read_at, edited_at and id. The INSERT policy
 * checks who sends, not which columns. Migration 20261003182009 revoked the
 * table-level INSERT and granted back the send columns.
 *
 * INVENTORY, from the app: every client insert/upsert into a table declared in
 * scripts/ci/client-insert-columns.sql, read off the AST by the write-contract
 * extractor. Each declared list must EQUAL the union of those payloads' keys
 * (two-way: a send column missing from the grant breaks every send; an extra
 * one is a server-owned column a client can set). The migrations, replayed in
 * order (comments blanked, any GRANT/REVOKE naming the table), must leave
 * authenticated with no table-level INSERT and exactly that column set; the
 * committed write-contract snapshot must say the same, so writeContract.test.ts
 * checks the send against the scoped grant. The same SQL runs live after every
 * db-deploy (scripts/check-live-privileges.mjs) and on the replayed schema
 * (db-smoke).
 *
 * Behaviour: src/test/pglite/messagesInsertColumnsClientScoped.pglite.mjs
 * (live ACL, applied 3x: ALL PASS; NEW_MIGRATION=skip: 9 FAILED).
 */

const ROOT = resolve(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const SQL_FILE = "scripts/ci/client-insert-columns.sql";

type Write = { kind: string; target: string; file: string; line: number; payload: { keys: Record<string, unknown>; open: boolean } | null };

/** (table, role) -> declared INSERT columns, read out of the shared SQL check. */
export function declaredLists(sql: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const body = blankSqlComments(sql);
  for (const m of body.matchAll(/\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*ARRAY\[([^\]]*)\]::text\[\]\s*\)/g)) {
    out.set(`${m[1]}:${m[2]}`, [...m[3].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort());
  }
  return out;
}

/** Union of the keys every client insert/upsert into `table` sends, plus any it cannot read. */
export function clientInsertColumns(writes: Write[], table: string): { cols: string[]; sites: string[]; open: string[] } {
  const ins = writes.filter((w) => w.target === table && (w.kind === "insert" || w.kind === "upsert"));
  const cols = new Set<string>();
  for (const w of ins) for (const k of Object.keys(w.payload?.keys ?? {})) cols.add(k);
  return {
    cols: [...cols].sort(),
    sites: ins.map((w) => `${w.file}:${w.line}`),
    open: ins.filter((w) => !w.payload || w.payload.open).map((w) => `${w.file}:${w.line}`),
  };
}

/**
 * authenticated's INSERT on public.<table> after every migration, in order.
 * authenticated's own grant starts table-level (the platform's default grant
 * when the table was made; a CREATE TABLE resets to that). PUBLIC's grant is
 * tracked apart: a GRANT to PUBLIC reaches authenticated, but a REVOKE FROM
 * PUBLIC leaves authenticated's own grant standing, as Postgres does. The
 * effective privilege is the union. GRANT/REVOKE statements are read off
 * comment-blanked text, so ones inside a DO block count.
 */
export function replayInsertGrant(files: { name: string; sql: string }[], table: string): { tableLevel: boolean; cols: string[] } {
  const own = { tableLevel: true, cols: new Set<string>() };
  const pub = { tableLevel: false, cols: new Set<string>() };
  // `ON ALL TABLES IN SCHEMA public` names every table in it; otherwise a comma list.
  const names = (obj: string) => {
    const all = obj.match(/^all\s+tables\s+in\s+schema\s+([\w\s,"]+)$/i);
    if (all) return all[1].split(",").map((s) => s.trim().replace(/"/g, "").toLowerCase()).includes("public") ? [table] : [];
    return obj.split(",").map((s) => s.trim().replace(/^table\s+/i, "").replace(/^public\./i, "").replace(/"/g, "").toLowerCase());
  };
  // Every part is bounded by `;`, so one statement never borrows the next one's ON/TO.
  const stmt = new RegExp(
    String.raw`\b(?:(create)\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(|(grant|revoke)\s+(?:grant\s+option\s+for\s+)?([^;]*?)\s+on\s+(all\s+tables\s+in\s+schema\s+[\w\s,"]+?|(?:table\s+)?[\w."\s,]+?)\s+(to|from)\s+([\w\s,"]+?)(?=\s*(?:;|$|with\s+grant|granted\s+by|cascade|restrict)))`,
    "gi",
  );
  for (const f of files) {
    const sql = blankSqlComments(f.sql);
    for (const m of sql.matchAll(stmt)) {
      if (m[1]) {
        if (m[2].toLowerCase() === table) {
          own.tableLevel = true; own.cols = new Set();
          pub.tableLevel = false; pub.cols = new Set();
        }
        continue;
      }
      const verb = m[3].toLowerCase();
      if (!names(m[5].trim()).includes(table)) continue;
      const roles = m[7].split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase());
      const privs = m[4];
      // Per privilege: `INSERT (a, b)` is column-level; `INSERT`, `ALL` are table-level.
      const colPriv = privs.match(/\binsert\s*\(([^)]*)\)/i);
      const tablePriv = /\ball\b/i.test(privs) || /\binsert\b(?!\s*\()/i.test(privs);
      for (const [role, state] of [["authenticated", own], ["public", pub]] as const) {
        if (!roles.includes(role)) continue;
        if (colPriv) {
          const named = colPriv[1].split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());
          if (verb === "grant") named.forEach((c) => state.cols.add(c));
          else named.forEach((c) => state.cols.delete(c));
        }
        if (tablePriv) {
          if (verb === "grant") state.tableLevel = true;
          else { state.tableLevel = false; state.cols = new Set(); } // a table-level REVOKE also clears the column grants
        }
      }
    }
  }
  return { tableLevel: own.tableLevel || pub.tableLevel, cols: [...new Set([...own.cols, ...pub.cols])].sort() };
}

const migrations = () =>
  readdirSync(MIG)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") }));

describe("a signed-in client INSERTs only the columns it sends (Q340)", () => {
  const declared = declaredLists(readFileSync(join(ROOT, SQL_FILE), "utf8"));
  const { writes } = contract.extractWrites() as { writes: Write[] };
  const tables = [...new Set([...declared.keys()].map((k) => k.split(":")[0]))];

  it("the inventory is real", () => {
    expect(declared.get("messages:authenticated")?.length).toBeGreaterThan(5);
    expect(declared.get("messages:anon")).toEqual([]);
    expect(writes.length).toBeGreaterThan(100);
    expect(clientInsertColumns(writes, "messages").sites.length).toBeGreaterThan(0);
  });

  it.each(tables.map((t) => [t]))("%s: the declared authenticated list is exactly what the client sends (two-way)", (table) => {
    const { cols, open, sites } = clientInsertColumns(writes, table);
    expect(open, `${table}: these inserts cannot be read off the AST, so the grant cannot be checked against them`).toEqual([]);
    expect(declared.get(`${table}:authenticated`), `${table}: client inserts at ${sites.join(", ")} send ${cols.join(", ")}`).toEqual(cols);
  });

  it.each(tables.map((t) => [t]))("%s: the migrations leave authenticated no table-level INSERT and exactly the declared columns", (table) => {
    const after = replayInsertGrant(migrations(), table);
    expect(after.tableLevel, `${table}: authenticated still holds table-level INSERT (every column, the server-owned ones included)`).toBe(false);
    expect(after.cols).toEqual(declared.get(`${table}:authenticated`));
  });

  it.each(tables.map((t) => [t]))("%s: the committed write-contract snapshot agrees (so writeContract.test.ts checks the send against the scoped grant)", (table) => {
    const snap = JSON.parse(readFileSync(join(ROOT, "scripts/audit/write-contract.snapshot.json"), "utf8"));
    const t = snap.tables[table];
    expect(t.grants.authenticated ?? []).not.toContain("INSERT");
    expect(t.columnGrants?.authenticated?.INSERT ?? []).toEqual(declared.get(`${table}:authenticated`));
    expect(t.grants.anon ?? []).not.toContain("INSERT");
    expect(t.columnGrants?.anon?.INSERT ?? []).toEqual(declared.get(`${table}:anon`) ?? []);
  });

  it("the same SQL runs live after every db-deploy and on the replayed schema", () => {
    expect(readFileSync(join(ROOT, "scripts/check-live-privileges.mjs"), "utf8")).toContain(`load("./ci/client-insert-columns.sql")`);
    expect(readFileSync(join(ROOT, ".github/workflows/db-smoke.yml"), "utf8")).toContain(`-f ${SQL_FILE}`);
  });

  describe("the guard can fail", () => {
    it("on the pre-Q340 grants: table-level INSERT, no column list", () => {
      const before = migrations().filter((f) => f.name < "20261003182009");
      expect(replayInsertGrant(before, "messages").tableLevel).toBe(true);
    });

    it("on a column REVOKE that leaves the table-level grant (Postgres keeps it), and on a later re-GRANT", () => {
      const base = migrations();
      const colOnly = [...base.filter((f) => f.name < "20261003182009"), { name: "x.sql", sql: "REVOKE INSERT (is_system) ON public.messages FROM authenticated;" }];
      expect(replayInsertGrant(colOnly, "messages").tableLevel).toBe(true);
      const regrant = [...base, { name: "99999999999999_x.sql", sql: "GRANT INSERT ON TABLE public.messages TO anon, authenticated;" }];
      expect(replayInsertGrant(regrant, "messages").tableLevel).toBe(true);
      const extra = [...base, { name: "99999999999999_y.sql", sql: "DO $$ BEGIN GRANT INSERT (is_system) ON public.messages TO authenticated; END $$;" }];
      expect(replayInsertGrant(extra, "messages").cols).toContain("is_system");
      // lh-authz-rls review F6: a grant to PUBLIC, and a last statement with no `;`.
      const toPublic = [...base, { name: "99999999999999_z.sql", sql: "GRANT INSERT ON public.messages TO PUBLIC;" }];
      expect(replayInsertGrant(toPublic, "messages").tableLevel).toBe(true);
      const noSemicolon = [...base, { name: "99999999999999_w.sql", sql: "GRANT INSERT ON public.messages TO authenticated" }];
      expect(replayInsertGrant(noSemicolon, "messages").tableLevel).toBe(true);
      // ...while a REVOKE FROM PUBLIC alone never clears authenticated's own grant.
      const pubOnly = [...base.filter((f) => f.name < "20261003182009"), { name: "x.sql", sql: "REVOKE INSERT ON public.messages FROM PUBLIC;" }];
      expect(replayInsertGrant(pubOnly, "messages").tableLevel).toBe(true);
    });

    it("on a client payload that grows a server-owned column", () => {
      const w = (keys: string[]): Write => ({ kind: "insert", target: "messages", file: "src/x.ts", line: 1, payload: { keys: Object.fromEntries(keys.map((k) => [k, null])), open: false } });
      const grown = clientInsertColumns([w(["job_id", "sender_id", "content", "is_system"])], "messages").cols;
      expect(grown).toContain("is_system");
      expect(grown).not.toEqual(declared.get("messages:authenticated"));
      expect(clientInsertColumns([{ ...w([]), payload: { keys: {}, open: true } }], "messages").open).toEqual(["src/x.ts:1"]);
    });
  });
});
