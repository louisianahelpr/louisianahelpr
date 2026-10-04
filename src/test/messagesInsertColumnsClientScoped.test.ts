// Q340: the table-level INSERT comes back (the column grants alone stay).
// @mutate supabase/migrations/20261003182009_messages_insert_columns_client_scoped.sql |   REVOKE INSERT ON public.messages FROM PUBLIC, anon, authenticated; |   REVOKE INSERT ON public.messages FROM PUBLIC, anon;
// Q340: the client starts sending a server-owned column the grant does not cover.
// @mutate src/pages/messages/messagesData/sendHandlers.ts |         job_id: optimistic.job_id,\n        sender_id: optimistic.sender_id, |         job_id: optimistic.job_id,\n        is_system: false,\n        sender_id: optimistic.sender_id,
// Q1166: the sender may stamp edited_at again (the column grant comes back).
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql | GRANT UPDATE (content, read) ON public.messages TO authenticated; | GRANT UPDATE (content, read, edited_at) ON public.messages TO authenticated;
// Q1166: the client starts sending a server-stamped column on edit.
// @mutate src/pages/messages/Messages.tsx | .update({ content: trimmed }) | .update({ content: trimmed, edited_at: new Date().toISOString() })
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
// @ts-expect-error — plain .mjs script, no type declarations
import * as contract from "../../scripts/audit/write-contract.mjs";

/**
 * A SIGNED-IN CLIENT WRITES ONLY THE COLUMNS IT SENDS (Q340 INSERT, Q1166 UPDATE).
 *
 * `authenticated` held TABLE-level INSERT on public.messages (live,
 * 2026-10-03), so a direct POST could set is_system (a message the thread
 * renders as a platform notice, and that the edit policy will not let its
 * author take back), created_at (a future stamp keeps the 15-minute edit
 * window open forever), read/read_at, edited_at and id. The INSERT policy
 * checks who sends, not which columns. Migration 20261003182009 revoked the
 * table-level INSERT and granted back the send columns.
 * It also held column UPDATE on edited_at (live, 2026-10-03), which no client
 * ever sends: the sender could erase the "edited" mark after an edit or forge
 * one (Q1166). 20261004001242 revokes UPDATE table-wide and grants back the two
 * columns a client updates: content (the sender's edit) and read (the
 * receiver's receipt).
 *
 * INVENTORY, from the app: every client insert/upsert (INSERT) and
 * update/upsert (UPDATE) into a table declared in
 * scripts/ci/client-insert-columns.sql, read off the AST by the write-contract
 * extractor. Each declared list must EQUAL the union of those payloads' keys
 * (two-way: a column missing from the grant breaks every such write; an extra
 * one is a server-owned column a client can set). The migrations, replayed in
 * order (comments blanked, any GRANT/REVOKE naming the table), must leave
 * authenticated with no table-level privilege and exactly that column set; the
 * committed write-contract snapshot must say the same, so writeContract.test.ts
 * checks each write against the scoped grant. The same SQL runs live after
 * every db-deploy (scripts/check-live-privileges.mjs) and on the replayed
 * schema (db-smoke).
 *
 * Behaviour: src/test/pglite/messagesInsertColumnsClientScoped.pglite.mjs
 * (INSERT: live ACL, applied 3x: ALL PASS; NEW_MIGRATION=skip: 9 FAILED) and
 * src/test/pglite/messageReadReceiptIsTheReceivers.pglite.mjs (UPDATE: live
 * bodies and grants, applied 3x: ALL PASS; NEW_MIGRATION=skip: 6 FAILED).
 */

const ROOT = resolve(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const SQL_FILE = "scripts/ci/client-insert-columns.sql";

type Priv = "INSERT" | "UPDATE";
type Write = { kind: string; target: string; file: string; line: number; payload: { keys: Record<string, unknown>; open: boolean } | null };

/** (table, role, privilege) -> declared columns, read out of the shared SQL check. Key `table:role:PRIV`. */
export function declaredLists(sql: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const body = blankSqlComments(sql);
  for (const m of body.matchAll(/\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(INSERT|UPDATE)'\s*,\s*ARRAY\[([^\]]*)\]::text\[\]\s*\)/g)) {
    out.set(`${m[1]}:${m[2]}:${m[3]}`, [...m[4].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort());
  }
  return out;
}

/** Which client write kinds need the privilege: an upsert needs both. */
const KINDS: Record<Priv, string[]> = { INSERT: ["insert", "upsert"], UPDATE: ["update", "upsert"] };

/** Union of the keys every client write needing `priv` on `table` sends, plus any it cannot read. */
export function clientWriteColumns(writes: Write[], table: string, priv: Priv): { cols: string[]; sites: string[]; open: string[] } {
  const ws = writes.filter((w) => w.target === table && KINDS[priv].includes(w.kind));
  const cols = new Set<string>();
  for (const w of ws) for (const k of Object.keys(w.payload?.keys ?? {})) cols.add(k);
  return {
    cols: [...cols].sort(),
    sites: ws.map((w) => `${w.file}:${w.line}`),
    open: ws.filter((w) => !w.payload || w.payload.open).map((w) => `${w.file}:${w.line}`),
  };
}

/**
 * authenticated's `priv` on public.<table> after every migration, in order.
 * authenticated's own grant starts table-level (the platform's default grant
 * when the table was made; a CREATE TABLE resets to that). PUBLIC's grant is
 * tracked apart: a GRANT to PUBLIC reaches authenticated, but a REVOKE FROM
 * PUBLIC leaves authenticated's own grant standing, as Postgres does. The
 * effective privilege is the union. GRANT/REVOKE statements are read off
 * comment-blanked text, so ones inside a DO block count.
 */
export function replayGrant(files: { name: string; sql: string }[], table: string, priv: Priv): { tableLevel: boolean; cols: string[] } {
  const own = { tableLevel: true, cols: new Set<string>() };
  const pub = { tableLevel: false, cols: new Set<string>() };
  const p = priv.toLowerCase();
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
  const colPrivRe = new RegExp(String.raw`\b${p}\s*\(([^)]*)\)`, "i");
  const tablePrivRe = new RegExp(String.raw`\b${p}\b(?!\s*\()`, "i");
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
      // Per privilege: `UPDATE (a, b)` is column-level; `UPDATE`, `ALL` are table-level.
      const colPriv = privs.match(colPrivRe);
      const tablePriv = /\ball\b/i.test(privs) || tablePrivRe.test(privs);
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

describe("a signed-in client INSERTs and UPDATEs only the columns it sends (Q340, Q1166)", () => {
  const declared = declaredLists(readFileSync(join(ROOT, SQL_FILE), "utf8"));
  const { writes } = contract.extractWrites() as { writes: Write[] };
  const lists = [...new Set([...declared.keys()].map((k) => k.split(":")).filter(([, role]) => role === "authenticated").map(([t, , p]) => `${t}:${p}`))]
    .map((k) => k.split(":") as [string, Priv]);

  it("the inventory is real", () => {
    expect(declared.get("messages:authenticated:INSERT")?.length).toBeGreaterThan(5);
    expect(declared.get("messages:authenticated:UPDATE")?.length).toBeGreaterThan(1);
    expect(declared.get("messages:anon:INSERT")).toEqual([]);
    expect(declared.get("messages:anon:UPDATE")).toEqual([]);
    expect(writes.length).toBeGreaterThan(100);
    expect(clientWriteColumns(writes, "messages", "INSERT").sites.length).toBeGreaterThan(0);
    expect(clientWriteColumns(writes, "messages", "UPDATE").sites.length).toBeGreaterThan(2);
  });

  it.each(lists)("%s %s: the declared authenticated list is exactly what the client sends (two-way)", (table, priv) => {
    const { cols, open, sites } = clientWriteColumns(writes, table, priv);
    expect(open, `${table}: these ${priv} writes cannot be read off the AST, so the grant cannot be checked against them`).toEqual([]);
    expect(declared.get(`${table}:authenticated:${priv}`), `${table}: client ${priv} writes at ${sites.join(", ")} send ${cols.join(", ")}`).toEqual(cols);
  });

  it.each(lists)("%s %s: the migrations leave authenticated no table-level privilege and exactly the declared columns", (table, priv) => {
    const after = replayGrant(migrations(), table, priv);
    expect(after.tableLevel, `${table}: authenticated still holds table-level ${priv} (every column, the server-owned ones included)`).toBe(false);
    expect(after.cols).toEqual(declared.get(`${table}:authenticated:${priv}`));
  });

  it.each(lists)("%s %s: the committed write-contract snapshot agrees (so writeContract.test.ts checks each write against the scoped grant)", (table, priv) => {
    const snap = JSON.parse(readFileSync(join(ROOT, "scripts/audit/write-contract.snapshot.json"), "utf8"));
    const t = snap.tables[table];
    expect(t.grants.authenticated ?? []).not.toContain(priv);
    expect(t.columnGrants?.authenticated?.[priv] ?? []).toEqual(declared.get(`${table}:authenticated:${priv}`));
    expect(t.grants.anon ?? []).not.toContain(priv);
    expect(t.columnGrants?.anon?.[priv] ?? []).toEqual(declared.get(`${table}:anon:${priv}`) ?? []);
  });

  it("the same SQL runs live after every db-deploy and on the replayed schema", () => {
    expect(readFileSync(join(ROOT, "scripts/check-live-privileges.mjs"), "utf8")).toContain(`load("./ci/client-insert-columns.sql")`);
    expect(readFileSync(join(ROOT, ".github/workflows/db-smoke.yml"), "utf8")).toContain(`-f ${SQL_FILE}`);
  });

  describe("the guard can fail", () => {
    it("on the pre-Q340 grants: table-level INSERT, no column list", () => {
      const before = migrations().filter((f) => f.name < "20261003182009");
      expect(replayGrant(before, "messages", "INSERT").tableLevel).toBe(true);
    });

    it("on the pre-Q1166 grants: authenticated may UPDATE edited_at", () => {
      const before = migrations().filter((f) => f.name < "20261004001242");
      expect(replayGrant(before, "messages", "UPDATE")).toEqual({ tableLevel: false, cols: ["content", "edited_at", "read"] });
    });

    it("on a column REVOKE that leaves the table-level grant (Postgres keeps it), and on a later re-GRANT", () => {
      const base = migrations();
      const colOnly = [...base.filter((f) => f.name < "20261003182009"), { name: "x.sql", sql: "REVOKE INSERT (is_system) ON public.messages FROM authenticated;" }];
      expect(replayGrant(colOnly, "messages", "INSERT").tableLevel).toBe(true);
      const regrant = [...base, { name: "99999999999999_x.sql", sql: "GRANT INSERT ON TABLE public.messages TO anon, authenticated;" }];
      expect(replayGrant(regrant, "messages", "INSERT").tableLevel).toBe(true);
      const extra = [...base, { name: "99999999999999_y.sql", sql: "DO $$ BEGIN GRANT INSERT (is_system) ON public.messages TO authenticated; END $$;" }];
      expect(replayGrant(extra, "messages", "INSERT").cols).toContain("is_system");
      const extraUpdate = [...base, { name: "99999999999999_v.sql", sql: "GRANT UPDATE (edited_at) ON public.messages TO authenticated;" }];
      expect(replayGrant(extraUpdate, "messages", "UPDATE").cols).toContain("edited_at");
      const allBack = [...base, { name: "99999999999999_u.sql", sql: "GRANT ALL ON public.messages TO authenticated;" }];
      expect(replayGrant(allBack, "messages", "UPDATE").tableLevel).toBe(true);
      // lh-authz-rls review F6: a grant to PUBLIC, and a last statement with no `;`.
      const toPublic = [...base, { name: "99999999999999_z.sql", sql: "GRANT INSERT ON public.messages TO PUBLIC;" }];
      expect(replayGrant(toPublic, "messages", "INSERT").tableLevel).toBe(true);
      const noSemicolon = [...base, { name: "99999999999999_w.sql", sql: "GRANT INSERT ON public.messages TO authenticated" }];
      expect(replayGrant(noSemicolon, "messages", "INSERT").tableLevel).toBe(true);
      // ...while a REVOKE FROM PUBLIC alone never clears authenticated's own grant.
      const pubOnly = [...base.filter((f) => f.name < "20261003182009"), { name: "x.sql", sql: "REVOKE INSERT ON public.messages FROM PUBLIC;" }];
      expect(replayGrant(pubOnly, "messages", "INSERT").tableLevel).toBe(true);
    });

    it("on a client payload that grows a server-owned column", () => {
      const w = (kind: string, keys: string[]): Write => ({ kind, target: "messages", file: "src/x.ts", line: 1, payload: { keys: Object.fromEntries(keys.map((k) => [k, null])), open: false } });
      const grown = clientWriteColumns([w("insert", ["job_id", "sender_id", "content", "is_system"])], "messages", "INSERT").cols;
      expect(grown).toContain("is_system");
      expect(grown).not.toEqual(declared.get("messages:authenticated:INSERT"));
      const stamped = clientWriteColumns([w("update", ["content"]), w("update", ["read"]), w("update", ["content", "edited_at"])], "messages", "UPDATE").cols;
      expect(stamped).toEqual(["content", "edited_at", "read"]);
      expect(stamped).not.toEqual(declared.get("messages:authenticated:UPDATE"));
      expect(clientWriteColumns([{ ...w("insert", []), payload: { keys: {}, open: true } }], "messages", "INSERT").open).toEqual(["src/x.ts:1"]);
    });
  });
});
