/**
 * The public tables the migrations leave WITHOUT a primary key, replayed in timestamp order:
 * CREATE TABLE public.<t> (... PRIMARY KEY ...), a later ALTER TABLE public.<t> ... PRIMARY KEY, DROP TABLE and
 * ALTER TABLE ... RENAME TO. Read by src/test/publicTablesHavePrimaryKey.test.ts. The Supabase performance advisor's
 * no_primary_key lint reads the same thing off prod, nightly (db-drift-detect); this reads it off the branch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./blankNonCode";
import { readdirSync } from "./trackedFiles";

const MIG = join(__dirname, "..", "..", "..", "supabase", "migrations");

/** The text from `open` (just after a "(") to its matching ")". */
function parenBody(sql: string, open: number): string {
  let depth = 1;
  let k = open;
  while (k < sql.length && depth > 0) {
    if (sql[k] === "(") depth++;
    else if (sql[k] === ")") depth--;
    k++;
  }
  return sql.slice(open, k - 1);
}

const NAME = String.raw`(?:public\.)?"?([a-z_0-9]+)"?`;

export function tablesWithoutPrimaryKey(dir = MIG): { tables: number; missing: string[] } {
  const hasPk = new Map<string, boolean>();
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const stmt = new RegExp(
    String.raw`CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}\s*\(|ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${NAME}\s+([^;]*);|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]*);`,
    "gi",
  );
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    for (const m of sql.matchAll(stmt)) {
      if (m[1]) {
        // CREATE TABLE ... IF NOT EXISTS on a table that already has a key leaves it as it was.
        const body = parenBody(sql, m.index! + m[0].length);
        if (/\bPARTITION\s+OF\b|\bAS\s+SELECT\b/i.test(sql.slice(m.index!, m.index! + m[0].length + 40))) continue;
        hasPk.set(m[1], (hasPk.get(m[1]) ?? false) || /\bPRIMARY\s+KEY\b/i.test(body));
      } else if (m[2]) {
        const rest = m[3];
        const renamed = rest.match(/^RENAME\s+TO\s+"?([a-z_0-9]+)"?\s*$/i);
        if (renamed && hasPk.has(m[2])) {
          hasPk.set(renamed[1], hasPk.get(m[2])!);
          hasPk.delete(m[2]);
        } else if (hasPk.has(m[2]) && /\bPRIMARY\s+KEY\b/i.test(rest)) {
          hasPk.set(m[2], !/\bDROP\s+CONSTRAINT\b[^,]*_pkey\b/i.test(rest) || /\bADD\b[^,]*PRIMARY\s+KEY/i.test(rest));
        }
      } else if (m[4]) {
        for (const t of m[4].replace(/\b(CASCADE|RESTRICT)\b/gi, "").split(",")) {
          const n = t.trim().replace(/^public\./, "").replace(/"/g, "");
          hasPk.delete(n);
        }
      }
    }
  }
  const missing = [...hasPk].filter(([, pk]) => !pk).map(([t]) => t).sort();
  return { tables: hasPk.size, missing };
}
