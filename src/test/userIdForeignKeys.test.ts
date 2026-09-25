/**
 * CLASS GUARD (docs/OPEN.md Q282): a table keyed to a person by `user_id` has
 * a foreign key to that person, or it is on KNOWN_NO_FK below with the reason.
 *
 * Why: notification_preferences had none, so accounts removed by any path
 * that skips purge_user_data left their rows behind (255 of 315 orphaned when
 * measured 2026-09-24). A FK makes the database, not every deletion path,
 * responsible.
 *
 * THE CLASS is derived from source: every `CREATE TABLE` in
 * supabase/migrations with a `user_id uuid` column, replayed in order through
 * later ADD/DROP CONSTRAINT ... FOREIGN KEY (user_id) and DROP TABLE. On
 * 2026-09-24 this derivation matched the live pg_constraint query (public
 * tables with a uuid user_id and no FK on it) table for table.
 * KNOWN_NO_FK is exact in both directions: adding a FK to a listed table
 * fails until it is removed from the list.
 *
 * @mutate supabase/migrations/20260924010547_user_fks_prefs_and_message_sender.sql | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; | NULL;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// How purge_user_data treats each (live prosrc, 2026-09-24). "deletes" and
// "anonymises" tables are Q331: give each a FK that matches purge (CASCADE /
// SET NULL) so a deletion that skips purge cannot orphan them.
// @two-way src/test/userIdForeignKeys.test.ts:KNOWN_NO_FK lists no table that now has a FK
const KNOWN_NO_FK: Record<string, string> = {
  admin_user_notes: "purge deletes; FK pending Q331",
  analytics_events: "purge anonymises (nullable); FK SET NULL pending Q331",
  email_tracking: "purge deletes; FK pending Q331",
  error_logs: "purge anonymises (nullable); FK SET NULL pending Q331",
  fraud_flags: "purge deletes; FK pending Q331",
  job_checkins: "purge deletes; FK pending Q331",
  legal_acceptances: "purge anonymises (nullable); FK SET NULL pending Q331",
  login_history: "purge deletes; FK pending Q331",
  notification_dedupe_suppressions: "purge does NOT touch it; purge gap + FK pending Q331",
  notification_logs: "purge deletes; FK pending Q331",
  push_tokens: "purge deletes; FK pending Q331",
  referral_codes: "purge anonymises (nullable); FK SET NULL pending Q331",
  referral_credits: "purge deletes; FK pending Q331",
  saved_jobs: "purge deletes; FK pending Q331",
  saved_searches: "purge deletes; FK pending Q331",
  user_bans: "retention decision pending Q331 (a ban may need to outlive the account)",
  user_violations: "purge deletes; FK pending Q331",
};

function tablesWithoutUserFk(): string[] {
  const dir = join(__dirname, "../../supabase/migrations");
  const has = new Map<string, boolean>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/--[^\n]*/g, "");
    for (const st of sql.split(";")) {
      let m = st.match(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*)$/i);
      if (m) {
        const col = m[2].split(/,\s*\n/).find((l) => /^\s*"?user_id"?\s+uuid/i.test(l));
        if (col) has.set(m[1], /REFERENCES/i.test(col) || /FOREIGN KEY\s*\(\s*"?user_id"?\s*\)/i.test(m[2]) || (has.get(m[1]) ?? false));
        continue;
      }
      m = st.match(/ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(?:public\.)?"?(\w+)"?[\s\S]*FOREIGN KEY\s*\(\s*"?user_id"?\s*\)/i);
      if (m && has.has(m[1])) has.set(m[1], true);
      m = st.match(/ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(?:public\.)?"?(\w+)"?\s+DROP CONSTRAINT (?:IF EXISTS )?"?\w*user_id_fkey"?/i);
      if (m && has.has(m[1])) has.set(m[1], false);
      m = st.match(/^\s*DROP TABLE (?:IF EXISTS )?(?:public\.)?"?(\w+)"?/i);
      if (m) has.delete(m[1]);
    }
  }
  scanned = [...has.keys()];
  return [...has].filter(([, v]) => !v).map(([t]) => t).sort();
}
let scanned: string[] = [];

describe("every user_id table has a foreign key or a stated reason (Q282)", () => {
  const missing = tablesWithoutUserFk();
  // Inventory, EXACT (Q339): the scanner must still see every public table
  // with a user_id uuid column. Live information_schema agreed on 2026-09-24
  // (33); 2026-09-25 V-008 adds saved_search_alert_queue (FK to auth.users).
  it("scans the whole user_id inventory", () => {
    expect(scanned.length).toBe(34);
  });
  it("no user_id table without a FK is missing from KNOWN_NO_FK", () => {
    expect(missing.filter((t) => !(t in KNOWN_NO_FK))).toEqual([]);
  });
  it("KNOWN_NO_FK lists no table that now has a FK (exact, both directions)", () => {
    expect(Object.keys(KNOWN_NO_FK).filter((t) => !missing.includes(t))).toEqual([]);
  });
});
