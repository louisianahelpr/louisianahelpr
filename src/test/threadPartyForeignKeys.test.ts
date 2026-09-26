/**
 * CLASS GUARD (docs/OPEN.md Q335): a per-thread preference row names the
 * thread's other party in `other_user_id`. When that person deletes their
 * account the row must go with them, or thread_pins / thread_mutes /
 * thread_archives keep rows keyed to an account that no longer exists.
 *
 * THE CLASS is derived from source: every `CREATE TABLE` in supabase/migrations
 * with an `other_user_id` column, replayed in order through later
 * ADD/DROP CONSTRAINT ... FOREIGN KEY (other_user_id) and DROP TABLE. Each must
 * end with a foreign key to auth.users ON DELETE CASCADE (the account is gone,
 * so is the viewer's pin/mute/archive of a thread with it; the thread itself
 * lives on as the deleted-account thread, Q262).
 *
 * The inventory is EXACT: a new table with an other_user_id column moves the
 * count and must be looked at.
 *
 * Live check (read-only, not run from this session: no prod credentials):
 *   SELECT conrelid::regclass, conname, confdeltype FROM pg_constraint
 *    WHERE contype = 'f' AND confrelid = 'auth.users'::regclass
 *      AND conrelid IN ('public.thread_pins'::regclass, 'public.thread_mutes'::regclass,
 *                       'public.thread_archives'::regclass)
 *      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
 *                           WHERE attrelid = conrelid AND attname = 'other_user_id')];
 *   -- expect 3 rows, confdeltype 'c'
 *
 * @mutate supabase/migrations/20260831011232_add_thread_archives.sql | other_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, | other_user_id uuid NOT NULL,
 * @mutate supabase/migrations/20260609100000_thread_mute.sql | other_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, | other_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

type Fk = "none" | "cascade" | "other";

function otherUserIdFks(): Map<string, Fk> {
  const dir = join(__dirname, "../../supabase/migrations");
  const state = new Map<string, Fk>();
  const kind = (clause: string): Fk =>
    /REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON DELETE CASCADE/i.test(clause) ? "cascade" : "other";
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    for (const st of sql.split(";")) {
      let m = st.match(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*)$/i);
      if (m) {
        const [, table, body] = m;
        const col = body.split(/,\s*\n/).find((l) => /^\s*"?other_user_id"?\s+uuid/i.test(l));
        if (!col) continue;
        // CREATE TABLE IF NOT EXISTS on a table already seen changes nothing.
        if (state.has(table) && /IF NOT EXISTS/i.test(st)) continue;
        const tableFk = body.match(/FOREIGN KEY\s*\(\s*"?other_user_id"?\s*\)([^,]*)/i);
        state.set(
          table,
          /REFERENCES/i.test(col) ? kind(col) : tableFk ? kind(tableFk[1]) : "none",
        );
        continue;
      }
      m = st.match(/ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(?:public\.)?"?(\w+)"?[\s\S]*FOREIGN KEY\s*\(\s*"?other_user_id"?\s*\)([\s\S]*)$/i);
      if (m && state.has(m[1])) state.set(m[1], kind(m[2]));
      m = st.match(/ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(?:public\.)?"?(\w+)"?\s+DROP CONSTRAINT (?:IF EXISTS )?"?\w*other_user_id_fkey"?/i);
      if (m && state.has(m[1])) state.set(m[1], "none");
      m = st.match(/^\s*DROP TABLE (?:IF EXISTS )?(?:public\.)?"?(\w+)"?/i);
      if (m) state.delete(m[1]);
    }
  }
  return state;
}

describe("every other_user_id column cascades with the account it names (Q335)", () => {
  const fks = otherUserIdFks();

  it("scans the whole other_user_id inventory", () => {
    expect([...fks.keys()].sort()).toEqual(["thread_archives", "thread_mutes", "thread_pins"]);
  });

  it("each has a FK to auth.users ON DELETE CASCADE", () => {
    const bad = [...fks].filter(([, k]) => k !== "cascade").map(([t, k]) => `${t}: ${k}`);
    expect(bad).toEqual([]);
  });
});
