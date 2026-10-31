import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * A poster cannot clear helper_on_the_way_at (owner's ID rule 2026-10-30).
 *
 * poster_cancel_job charges no fee and no strike for a hired Helpr with no
 * verified ID only while this stamp is NULL. posterCannotMoveFeeInputs proves
 * the column is locked; this proves the one way past the lock stays narrow, and
 * that a new writer cannot appear without someone deciding whether it may run as
 * the poster (the lock would refuse it, breaking that path at runtime).
 *
 * Behaviour (red before, 3x replay, every writer still lands):
 * src/test/pglite/posterCannotClearOnTheWay.pglite.mjs.
 */
// @mutate supabase/migrations/20261031221529_poster_cannot_clear_on_the_way_restated.sql |       IF changed_col IN ('helper_confirmed_at', 'helper_dayof_confirmed_at', 'helper_on_the_way_at')\n |       IF changed_col IN ('helper_confirmed_at', 'helper_dayof_confirmed_at')\n
// @mutate supabase/migrations/20261031221529_poster_cannot_clear_on_the_way_restated.sql |                               WHEN 'helper_on_the_way_at' THEN NEW.helper_on_the_way_at\n |                               WHEN 'helper_on_the_way_at' THEN NULL\n
// @mutate supabase/migrations/20261031221529_poster_cannot_clear_on_the_way_restated.sql |          AND NEW.helper_id IS NULL AND OLD.helper_id IS NOT NULL\n         AND current_setting('app.trusted_ladder_write', true) = 'on' THEN\n        CONTINUE; |          AND current_setting('app.trusted_ladder_write', true) = 'on' THEN\n        CONTINUE;

const DEFS = effectiveDefs(resolve(__dirname, "..", "..", "supabase", "migrations"));

/** Every function that assigns the job's stamp, and how it is allowed to. The roster's own stamp is a different table. */
const WRITERS: Record<string, string> = {
  helper_mark_on_the_way: "sets it; refuses anyone but the assigned Helpr",
  helper_abort_job: "clears it; refuses anyone but the assigned Helpr",
  settle_one_off_jobs_for_banned_account: "clears it on reopen, in the unassign, under app.trusted_ladder_write; may run as the poster",
  enforce_jobs_insert_column_lock: "INSERT only; the poster lock is BEFORE UPDATE",
};
/** The same words, on group_job_helpers. */
const ROSTER_ONLY = new Set(["enforce_group_member_lifecycle_server_owned", "rpc_group_member_on_the_way"]);

describe("the on-the-way stamp a poster's free cancel depends on", () => {
  it("the only way past the lock is a clear to NULL, in the unassign, under the trusted flag", () => {
    const def = DEFS.get("enforce_poster_jobs_money_lock");
    expect(def).toBeDefined();
    const lock = blankSqlComments(def!.stmt).replace(/\s+/g, " ");
    expect(lock).toContain("'helper_on_the_way_at' ]");
    const carve = /IF changed_col IN \('helper_confirmed_at', 'helper_dayof_confirmed_at', 'helper_on_the_way_at'\)(.*?)THEN CONTINUE;/.exec(lock);
    expect(carve, "the carve-out names the column").not.toBeNull();
    expect(carve![1]).toContain("WHEN 'helper_on_the_way_at' THEN NEW.helper_on_the_way_at");
    expect(carve![1]).toContain("END) IS NULL");
    expect(carve![1]).toContain("AND NEW.helper_id IS NULL AND OLD.helper_id IS NOT NULL");
    expect(carve![1]).toContain("current_setting('app.trusted_ladder_write', true) = 'on'");
  });

  it("every function that assigns the stamp is known, both ways", () => {
    const found: string[] = [];
    for (const [fn, d] of DEFS) {
      if (ROSTER_ONLY.has(fn)) continue;
      if (/\bhelper_on_the_way_at\s*:?=(?!=)/i.test(blankSqlComments(d.stmt))) found.push(fn);
    }
    expect(found.length).toBeGreaterThan(2);
    expect(found.sort()).toEqual(Object.keys(WRITERS).sort());
  });

  it("the poster's cancel reads the stamp, so the lock is still what the free cancel relies on", () => {
    const cancel = blankSqlComments(DEFS.get("poster_cancel_job")!.stmt);
    expect(cancel).toMatch(/v_job\.helper_on_the_way_at\s+IS\s+NULL/i);
  });
});
