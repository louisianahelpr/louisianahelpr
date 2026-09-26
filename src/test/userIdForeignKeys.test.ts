/**
 * CLASS GUARD (docs/OPEN.md Q282, widened by Q331): every public-table uuid
 * column that names a person (`*user_id` or `*_by`) has a foreign key to
 * auth.users or profiles, or it is on NO_FK_BY_DESIGN below with the reason.
 *
 * Why: notification_preferences had none, so accounts removed by any path
 * that skips purge_user_data left their rows behind (255 of 315 orphaned when
 * measured 2026-09-24). On 2026-09-26 the same class held 3,611 orphan rows
 * across 9 tables (notification_logs 1,939, analytics_events 820,
 * login_history 482, ...). A FK makes the database, not every deletion path,
 * responsible; the ON DELETE action is chosen to match what the purge does
 * (DELETE -> CASCADE, anonymise -> SET NULL), see
 * 20260926034714_user_fks_q331_deletion_backstop.sql.
 *
 * THE CLASS is derived from source: every `CREATE TABLE` in
 * supabase/migrations and every `ALTER TABLE ... ADD COLUMN` with a
 * `*user_id` / `*_by` uuid column, replayed in order through inline
 * REFERENCES, ADD [CONSTRAINT] FOREIGN KEY, DROP CONSTRAINT, DROP COLUMN,
 * RENAME and DROP TABLE. On 2026-09-26 that derivation matched the live
 * catalog (information_schema.columns on public BASE TABLEs, uuid,
 * name ~ 'user_id$' or '_by$': 58 columns) column for column, and the live
 * pg_constraint FKs on them once the Q331 migration is applied.
 * NO_FK_BY_DESIGN is exact in both directions: adding a FK to a listed column
 * fails until it is removed from the list.
 *
 * @mutate supabase/migrations/20260926034714_user_fks_q331_deletion_backstop.sql | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID; | NOT VALID;
 * @mutate supabase/migrations/20260926034714_user_fks_q331_deletion_backstop.sql | FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID; | NOT VALID;
 * @mutate supabase/migrations/20260924010547_user_fks_prefs_and_message_sender.sql | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; | NULL;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

// Columns that deliberately have NO foreign key, and why (Q331, 2026-09-26,
// each matching purge_user_data's documented decision).
// @two-way src/test/userIdForeignKeys.test.ts:NO_FK_BY_DESIGN lists no column that now has a FK
const NO_FK_BY_DESIGN: Record<string, string> = {
  "user_bans.user_id":
    "a ban outlives the account by design: purge_user_data retains it (4n) and retain_ban_on_deletion carries it forward; a FK would CASCADE it away or block the delete",
  "user_bans.banned_by":
    "enforcement record retained with its ban (admin_audit_log class); often the subject themself (consequence ladder)",
  "jobs.removed_by":
    "an admin enforcement action; purge_user_data deliberately retains it (4p) so the admin surface sees the truth",
};

const PERSON_COL = /^(\w*user_id|\w+_by)$/i;
const ID = String.raw`"?(\w+)"?`;
const TABLE = String.raw`(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?`;
const PERSON_REF = /REFERENCES\s+(?:auth\.users|(?:public\.)?profiles)\b/i;

// key "table.column" -> has FK
let cols = new Map<string, boolean>();
// constraint name -> key, so DROP CONSTRAINT <name> unsets the right column
let fkNames = new Map<string, string>();

function replay(): Map<string, boolean> {
  cols = new Map();
  fkNames = new Map();
  const dir = join(__dirname, "../../supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    for (const st of sql.split(";")) statement(st);
  }
  return cols;
}

function setFk(table: string, col: string, name: string | null) {
  const key = `${table}.${col}`;
  if (!cols.has(key)) return;
  cols.set(key, true);
  fkNames.set(name ?? `${table}_${col}_fkey`, key);
}

function statement(st: string) {
  // CREATE TABLE public.t ( ... )   (non-public schemas are out of scope)
  let m = st.match(new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:\w+\.)?)"?(\w+)"?\s*\(([\s\S]*)$`, "i"));
  if (m) {
    if (m[1] && m[1].toLowerCase() !== "public.") return;
    const table = m[2];
    for (const line of m[3].split(/,\s*\n/)) {
      const c = line.match(new RegExp(String.raw`^\s*${ID}\s+uuid\b`, "i"));
      if (c && PERSON_COL.test(c[1])) {
        cols.set(`${table}.${c[1]}`, false);
        if (PERSON_REF.test(line)) setFk(table, c[1], null);
      }
      const t = line.match(new RegExp(String.raw`(?:CONSTRAINT\s+${ID}\s+)?FOREIGN\s+KEY\s*\(\s*${ID}\s*\)\s*(REFERENCES[^,]*)`, "i"));
      if (t && PERSON_REF.test(t[3])) setFk(table, t[2], t[1] ?? null);
    }
    return;
  }
  m = st.match(new RegExp(String.raw`ALTER\s+TABLE\s+${TABLE}\s+RENAME\s+TO\s+${ID}`, "i"));
  if (m) {
    const [from, to] = [m[1], m[2]];
    for (const [k, v] of [...cols]) {
      if (k.startsWith(`${from}.`)) { cols.delete(k); cols.set(`${to}.${k.slice(from.length + 1)}`, v); }
    }
    for (const [n, k] of [...fkNames]) if (k.startsWith(`${from}.`)) fkNames.set(n, `${to}.${k.slice(from.length + 1)}`);
    return;
  }
  m = st.match(new RegExp(String.raw`ALTER\s+TABLE\s+${TABLE}\s+([\s\S]*)$`, "i"));
  if (m) {
    const table = m[1];
    const body = m[2];
    for (const a of body.matchAll(new RegExp(String.raw`ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?${ID}\s+uuid\b([^,]*)`, "gi"))) {
      if (!PERSON_COL.test(a[1])) continue;
      if (!cols.has(`${table}.${a[1]}`)) cols.set(`${table}.${a[1]}`, false);
      if (PERSON_REF.test(a[2])) setFk(table, a[1], null);
    }
    for (const a of body.matchAll(new RegExp(String.raw`ADD\s+(?:CONSTRAINT\s+${ID}\s+)?FOREIGN\s+KEY\s*\(\s*${ID}\s*\)\s*(REFERENCES\s+[\w."]+)`, "gi"))) {
      if (PERSON_REF.test(a[3])) setFk(table, a[2], a[1] ?? null);
    }
    for (const a of body.matchAll(new RegExp(String.raw`DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?${ID}`, "gi"))) {
      const key = fkNames.get(a[1]);
      if (key && key.startsWith(`${table}.`)) { cols.set(key, false); fkNames.delete(a[1]); }
    }
    for (const a of body.matchAll(new RegExp(String.raw`DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?${ID}`, "gi"))) {
      cols.delete(`${table}.${a[1]}`);
    }
    return;
  }
  m = st.match(new RegExp(String.raw`^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:\w+\.)?)"?(\w+)"?`, "i"));
  if (m && (!m[1] || m[1].toLowerCase() === "public.")) {
    for (const k of [...cols.keys()]) if (k.startsWith(`${m[2]}.`)) cols.delete(k);
  }
}

describe("every person-id column (*user_id, *_by) has a foreign key or a stated reason (Q282, Q331)", () => {
  const all = replay();
  const missing = [...all].filter(([, v]) => !v).map(([k]) => k).sort();

  // Inventory, EXACT: the scanner must still see every public BASE TABLE uuid
  // column named *user_id or *_by. Live information_schema agreed on
  // 2026-09-26 (58). A new person column moves this; so does a scanner that
  // stops reading a file.
  it("scans the whole person-column inventory", () => {
    expect(all.size).toBe(58);
  });
  it("sees the columns this class is about (parser sanity)", () => {
    for (const k of ["notification_logs.user_id", "jobs.cancelled_by", "profiles.license_reviewed_by", "payment_refunds.initiated_by_user_id", "notifications.user_id"]) {
      expect(all.has(k), k).toBe(true);
    }
  });
  it("no person column without a FK is missing from NO_FK_BY_DESIGN", () => {
    expect(missing.filter((k) => !(k in NO_FK_BY_DESIGN))).toEqual([]);
  });
  it("NO_FK_BY_DESIGN lists no column that now has a FK or no longer exists (exact, both directions)", () => {
    expect(Object.keys(NO_FK_BY_DESIGN).filter((k) => !missing.includes(k))).toEqual([]);
  });
});
