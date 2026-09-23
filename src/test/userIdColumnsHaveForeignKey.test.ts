/**
 * CLASS GUARD (Q282, Q262): a column that names a person either has a foreign
 * key, or is on an exact list that says why not.
 *
 * THE BUG (measured on prod, 2026-09-23): 255 notification_preferences rows
 * named a user_id with no auth.users row, and pg_constraint showed 0 FKs on
 * the table. Deleting the Q205(d) fixtures through the admin API left their
 * rows behind; nothing cascades from a column with no FK. Fixed by
 * 20260923185657_person_columns_reference_a_real_user.sql (orphans deleted,
 * FK ON DELETE CASCADE to auth.users). The same migration gives
 * messages.sender_id its FK (Q262); messages.receiver_id deliberately has none
 * (see RECEIVER below). Behaviour, with the old state red, in PGlite:
 * src/test/pglite/personColumnsReferenceARealUser.pglite.mjs.
 *
 * THE CLASS, from the migrations: every public table they leave defined whose
 * columns include `user_id uuid`. Its FK may be inline (REFERENCES), a table
 * constraint, or a later ALTER TABLE ... ADD ... FOREIGN KEY (user_id). A
 * table with none must be on NO_FK with its reason, and (because nothing
 * cascades to it) must be cleared by the newest purge_user_data(), unless it
 * is on NOT_PURGED with its reason. All lists are two-way: an entry whose
 * table now has an FK, is purged, or is gone fails too.
 *
 * @mutate supabase/migrations/20260923185657_person_columns_reference_a_real_user.sql | ADD CONSTRAINT notification_preferences_user_id_fkey\n      FOREIGN KEY (user_id) | ADD CONSTRAINT notification_preferences_user_id_fkey\n      CHECK (user_id
 * @mutate supabase/migrations/20260923185657_person_columns_reference_a_real_user.sql | ADD CONSTRAINT messages_sender_id_fkey\n      FOREIGN KEY (sender_id) | ADD CONSTRAINT messages_sender_id_fkey\n      CHECK (sender_id
 * @mutate supabase/migrations/20260923185657_person_columns_reference_a_real_user.sql | BEFORE INSERT OR UPDATE OF receiver_id ON public.messages | AFTER DELETE ON public.messages
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: blankSqlComments(readFileSync(join(MIG, file), "utf8")) }));

/** Tables with a user_id and no FK, each with why. Exact (two-way). */
// @two-way src/test/userIdColumnsHaveForeignKey.test.ts:on NO_FK but has an FK or no user_id
const NO_FK: Record<string, string> = {
  admin_user_notes: "Operator notes; purge_user_data deletes them for the subject.",
  analytics_events: "Event log that may outlive the account; purge_user_data nulls/deletes the user's rows.",
  broadcast_dismissals: "Per-user dismissal marks; purge_user_data deletes them.",
  email_tracking: "Delivery tracking; purge_user_data deletes it (holds the literal address).",
  error_logs: "Operational log written for signed-out and deleted users alike; purge_user_data scrubs the user's rows.",
  fraud_flags: "Trust record; purge_user_data handles the user's rows.",
  job_checkins: "Job history tied to a job that can outlive its poster; purge_user_data handles the user's rows.",
  legal_acceptances: "Consent record; purge_user_data handles it.",
  login_history: "Security log (IP, user agent); purge_user_data deletes it. Age-pruned by prune_old_activity_logs (Q224).",
  notification_dedupe_suppressions: "Operator counter of suppressed duplicates (NOT purged: see NOT_PURGED).",
  notification_logs: "Delivery log; purge_user_data deletes it. Age-pruned by prune_old_activity_logs (Q224).",
  push_tokens: "Device tokens; purge_user_data deletes them first (privacy-critical).",
  referral_codes: "Referral ledger; purge_user_data handles it.",
  referral_credits: "Credit ledger (money); purge_user_data handles it.",
  saved_jobs: "Bookmarks; purge_user_data deletes them.",
  saved_searches: "Saved filters; purge_user_data deletes them.",
  user_bans: "A ban must SURVIVE deletion (20260903014600): an FK cascade would let a banned user erase their ban.",
  user_violations: "Trust record; purge_user_data handles it.",
};

/** NO_FK tables that purge_user_data does not touch, each with why. Exact (two-way). */
// @two-way src/test/userIdColumnsHaveForeignKey.test.ts:on NOT_PURGED but purged or not on NO_FK
const NOT_PURGED: Record<string, string> = {
  user_bans: "Deliberate: the ban outlives the account (20260903014600).",
  notification_dedupe_suppressions: "Gap, filed as Q299: holds notification title/link for the user and nothing clears it at deletion.",
};

/** Body of `CREATE TABLE name (` ... matching `)`, parens balanced. */
function tableBodies(sql: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi;
  for (const m of sql.matchAll(re)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth--;
    }
    out.push({ name: m[1].toLowerCase(), body: sql.slice(start, i - 1) });
  }
  return out;
}

type T = { user: boolean; fk: boolean };
const tables = new Map<string, T>();
for (const { sql } of files) {
  for (const { name, body } of tableBodies(sql)) {
    const col = /(?:^|[,(])\s*user_id\s+uuid\b([^,]*)/i.exec(body);
    const tableFk = /FOREIGN\s+KEY\s*\(\s*user_id\s*\)\s*REFERENCES/i.test(body);
    if (!tables.has(name)) tables.set(name, { user: !!col, fk: !!col && (/\bREFERENCES\b/i.test(col[1]) || tableFk) });
  }
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?user_id\s+uuid\b([^;,]*)/gi)) {
    const t = tables.get(m[1].toLowerCase());
    if (t) {
      t.user = true;
      if (/\bREFERENCES\b/i.test(m[2])) t.fk = true;
    }
  }
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)\s+ADD\s+(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY\s*\(\s*user_id\s*\)\s*REFERENCES/gi)) {
    const t = tables.get(m[1].toLowerCase());
    if (t) t.fk = true;
  }
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)\s+RENAME\s+TO\s+(\w+)/gi)) {
    const t = tables.get(m[1].toLowerCase());
    if (t) {
      tables.delete(m[1].toLowerCase());
      tables.set(m[2].toLowerCase(), t);
    }
  }
  // Not `ALTER PUBLICATION ... DROP TABLE x`, which only stops realtime for it.
  for (const m of sql.matchAll(/(?<!PUBLICATION\s+\w+\s+)DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)/gi)) tables.delete(m[1].toLowerCase());
}
const withUser = [...tables].filter(([, t]) => t.user);
const noFk = withUser.filter(([, t]) => !t.fk).map(([n]) => n).sort();

// Newest purge_user_data body, any dollar tag.
const PURGE_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?purge_user_data\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1/gi;
let purge = "";
for (const { sql } of files) for (const m of sql.matchAll(PURGE_RE)) purge = m[2];
const purges = (t: string) => new RegExp(`\\bpublic\\.${t}\\b`, "i").test(purge);

describe("person columns reference a real user (Q282, Q262)", () => {
  it("reads the inventory from the migrations (floor)", () => {
    // 34 tables with a user_id on 2026-09-23 (7 more were dropped by later migrations).
    expect(withUser.length).toBeGreaterThan(30);
    expect(tables.get("profiles")?.fk).toBe(true);
    expect(tables.get("notifications")?.fk).toBe(true);
    expect(purge.length).toBeGreaterThan(5000);
  });

  it("every table with a user_id has an FK or is on NO_FK", () => {
    expect(noFk).toEqual(Object.keys(NO_FK).sort());
  });

  it("notification_preferences.user_id has its FK (Q282)", () => {
    expect(tables.get("notification_preferences")).toEqual({ user: true, fk: true });
  });

  it("a NO_FK table is cleared by purge_user_data, or is on NOT_PURGED", () => {
    const unpurged = Object.keys(NO_FK).filter((t) => !purges(t)).sort();
    expect(unpurged).toEqual(Object.keys(NOT_PURGED).sort());
  });

  it("messages.sender_id has an FK that CASCADEs (Q262)", () => {
    const all = files.map((f) => f.sql).join("\n");
    expect(all).toMatch(/ADD\s+CONSTRAINT\s+messages_sender_id_fkey\s+FOREIGN\s+KEY\s*\(\s*sender_id\s*\)\s*REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
    // purge_user_data deletes exactly the sender's rows, which is what the cascade does.
    expect(purge).toMatch(/DELETE\s+FROM\s+public\.messages\s+WHERE\s+sender_id\s*=\s*p_user_id/i);
  });

  it("messages.receiver_id: no FK (purge keeps the counterparty's words), but an insert-time existence rule", () => {
    const all = files.map((f) => f.sql).join("\n");
    // RECEIVER: any ON DELETE action would destroy (CASCADE), null out (SET
    // NULL; column is NOT NULL and threads key on it) or block (NO ACTION) the
    // messages the OTHER person wrote, which purge_user_data 4c keeps on purpose.
    expect(all).not.toMatch(/FOREIGN\s+KEY\s*\(\s*receiver_id\s*\)/i);
    expect(purge).not.toMatch(/DELETE\s+FROM\s+public\.messages\s+WHERE[^;]*receiver_id/i);
    expect(all).toMatch(/CREATE\s+TRIGGER\s+messages_receiver_exists\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+receiver_id\s+ON\s+public\.messages/i);
  });
});
