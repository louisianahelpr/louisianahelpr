/**
 * What a client role may do on one public table after every migration, in
 * order: table-level privileges and column-level ones, per role.
 *
 * Built for the "server-only table" and "server-only column" guards (Q1230
 * job_views, Q1231 job_revisions, Q1232 applications.flag_reason). Postgres
 * semantics it models:
 *   - CREATE TABLE resets the table: anon and authenticated start with the
 *     platform default (every privilege, table-level), PUBLIC with none.
 *   - GRANT/REVOKE name a comma list of tables, or ALL TABLES IN SCHEMA public.
 *   - A column privilege `SELECT (a, b)` is column-level; `SELECT`, `ALL` are
 *     table-level. A table-level REVOKE also clears that privilege's column
 *     grants; a column REVOKE leaves a table-level grant standing.
 *   - PUBLIC is tracked apart: a grant to PUBLIC reaches every role, a REVOKE
 *     FROM PUBLIC leaves a role's own grant standing.
 * Statements are read off comment-blanked text, so ones inside DO blocks count.
 */
import { blankSqlComments } from "./blankNonCode";

export type Priv = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
const PRIVS: Priv[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];
type RoleState = { table: Set<Priv>; cols: Map<Priv, Set<string>> };
const fresh = (all: boolean): RoleState => ({ table: new Set(all ? PRIVS : []), cols: new Map(PRIVS.map((p) => [p, new Set<string>()])) });

export interface Effective {
  /** Table-level privileges the role holds (its own grant or PUBLIC's). */
  table: Set<Priv>;
  /** Column-level grants per privilege (its own or PUBLIC's). */
  cols: Map<Priv, Set<string>>;
}

export function replayTablePrivileges(files: { name: string; sql: string }[], table: string, role: "anon" | "authenticated"): Effective {
  let own = fresh(true);
  let pub = fresh(false);
  const t = table.toLowerCase();
  const names = (obj: string) => {
    const all = obj.match(/^all\s+tables\s+in\s+schema\s+([\w\s,"]+)$/i);
    if (all) return all[1].split(",").map((s) => s.trim().replace(/"/g, "").toLowerCase()).includes("public") ? [t] : [];
    return obj.split(",").map((s) => s.trim().replace(/^table\s+/i, "").replace(/^public\./i, "").replace(/"/g, "").toLowerCase());
  };
  const stmt = new RegExp(
    String.raw`\b(?:(create)\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(|(grant|revoke)\s+(?:grant\s+option\s+for\s+)?([^;]*?)\s+on\s+(all\s+tables\s+in\s+schema\s+[\w\s,"]+?|(?:table\s+)?[\w."\s,]+?)\s+(to|from)\s+([\w\s,"]+?)(?=\s*(?:;|$|with\s+grant|granted\s+by|cascade|restrict)))`,
    "gi",
  );
  for (const f of files) {
    const sql = blankSqlComments(f.sql);
    for (const m of sql.matchAll(stmt)) {
      if (m[1]) {
        if (m[2].toLowerCase() === t) { own = fresh(true); pub = fresh(false); }
        continue;
      }
      if (!names(m[5].trim()).includes(t)) continue;
      const grant = m[3].toLowerCase() === "grant";
      const roles = m[7].split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase());
      // Split the privilege list on commas that are not inside a column list.
      const parts: string[] = [];
      let depth = 0, cur = "";
      for (const ch of m[4]) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
      }
      parts.push(cur);
      for (const [r, state] of [[role, own], ["public", pub]] as const) {
        if (!roles.includes(r)) continue;
        for (const raw of parts) {
          const part = raw.trim();
          const colm = /^(\w+)\s*\(([^)]*)\)$/.exec(part);
          const word = (colm ? colm[1] : part).toUpperCase().replace(/\s+PRIVILEGES$/, "");
          const privs: Priv[] = word === "ALL" ? PRIVS : PRIVS.includes(word as Priv) ? [word as Priv] : [];
          for (const p of privs) {
            if (colm) {
              const cols = colm[2].split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());
              cols.forEach((c) => (grant ? state.cols.get(p)!.add(c) : state.cols.get(p)!.delete(c)));
            } else if (grant) state.table.add(p);
            else { state.table.delete(p); state.cols.set(p, new Set()); }
          }
        }
      }
    }
  }
  return {
    table: new Set([...own.table, ...pub.table]),
    cols: new Map(PRIVS.map((p) => [p, new Set([...own.cols.get(p)!, ...pub.cols.get(p)!])])),
  };
}

/** Names of the policies on public.<table> that survive every migration (CREATE/DROP POLICY replayed). */
export function livePolicies(files: { name: string; sql: string }[], table: string): Map<string, string> {
  const live = new Map<string, string>();
  const t = table.toLowerCase();
  const NAME = String.raw`(?:"([^"]+)"|(\w+))`;
  const ON = String.raw`\s+on\s+(?:public\.)?"?(\w+)"?`;
  for (const f of files) {
    const sql = blankSqlComments(f.sql);
    const events: { at: number; apply: () => void }[] = [];
    for (const m of sql.matchAll(new RegExp(String.raw`drop\s+policy\s+(?:if\s+exists\s+)?${NAME}${ON}`, "gi"))) {
      if (m[3].toLowerCase() === t) events.push({ at: m.index!, apply: () => live.delete(m[1] ?? m[2].toLowerCase()) });
    }
    for (const m of sql.matchAll(new RegExp(String.raw`create\s+policy\s+${NAME}${ON}([^;]*);`, "gi"))) {
      if (m[3].toLowerCase() === t) events.push({ at: m.index!, apply: () => live.set(m[1] ?? m[2].toLowerCase(), m[4]) });
    }
    for (const m of sql.matchAll(new RegExp(String.raw`drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?`, "gi"))) {
      if (m[1].toLowerCase() === t) events.push({ at: m.index!, apply: () => live.clear() });
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
  }
  return live;
}
