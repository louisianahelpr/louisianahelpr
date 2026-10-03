// Q713: the status-message insert stops skipping blocked participants.
// @mutate supabase/migrations/20261003183349_status_message_skips_blocked_participants.sql |   WHERE p.participant IS NOT NULL\n    AND public.are_users_blocked(NEW.customer_id, p.participant) IS NOT TRUE |   WHERE p.participant IS NOT NULL
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * A SERVER-SIDE MESSAGE NEVER ABORTS THE WRITE THAT CAUSED IT ON A BLOCK (Q713).
 *
 * (The message rate limit can still abort it the same way: Q1169.)
 *
 * trg_enforce_block_on_message_insert raises "You can't message this user."
 * when sender and receiver are blocked, and it applies inside a client's
 * request even when the INSERT runs in a SECURITY DEFINER function (auth.uid()
 * is set, so is_server_context() is false). insert_job_status_system_message
 * (AFTER UPDATE OF status ON jobs) posted to every thread participant, so ONE
 * blocked participant aborted the whole status change: accept, start,
 * complete, cancel, dispute. 20261003183349 skips a blocked participant with
 * the block trigger's own predicate.
 *
 * INVENTORY: every function the migrations leave in the database (replayed in
 * order, later rewrites and DROPs applied; comments blanked) that INSERTs INTO
 * public.messages. Each such INSERT must screen its recipients with
 * public.are_users_blocked(...): inside an INSERT ... SELECT the predicate is
 * in the statement itself; a single-row INSERT ... VALUES needs it in the
 * function. Otherwise the block trigger can abort the parent write.
 *
 * Behaviour: src/test/pglite/statusMessageSkipsBlocked.pglite.mjs (live
 * bodies, applied 3x: ALL PASS; NEW_MIGRATION=skip: 4 FAILED).
 */

const MIG = join(__dirname, "..", "..", "supabase", "migrations");

/** Each `INSERT INTO [public.]messages …;` statement in a function body, comments blanked. */
export function messageInserts(stmt: string): string[] {
  const body = blankSqlComments(stmt);
  // No column list required: `INSERT INTO messages SELECT ...`, `... VALUES ...`
  // and `... AS m (...)` are inserts too (lh-authz-rls review of Q713).
  return [...body.matchAll(/\bINSERT\s+INTO\s+(?:public\.)?"?messages"?\b[^;]*;/gi)].map((m) => m[0]);
}

/** Why a function's message inserts can be aborted by a block, or [] when each is screened. */
export function unscreened(stmt: string): string[] {
  const out: string[] = [];
  const screenedInFunction = /\bare_users_blocked\s*\(/i.test(blankSqlComments(stmt));
  for (const ins of messageInserts(stmt)) {
    const isSelect = /\bSELECT\b/i.test(ins);
    const screened = isSelect ? /\bare_users_blocked\s*\(/i.test(ins) : screenedInFunction;
    if (!screened) out.push(ins.replace(/\s+/g, " ").slice(0, 120));
  }
  return out;
}

describe("a server-side message insert screens blocked recipients (Q713)", () => {
  const defs = effectiveDefs(MIG);
  const inserters = [...defs].filter(([, d]) => messageInserts(d.stmt).length > 0);

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(300);
    // The status-message trigger at least; a parser that finds none cannot pass.
    expect(inserters.map(([n]) => n)).toContain("insert_job_status_system_message");
  });

  it("every function that inserts into messages screens with are_users_blocked", () => {
    const offenders = inserters.flatMap(([name, d]) => unscreened(d.stmt).map((s) => `${name} (${d.file}): ${s}`));
    expect(
      offenders,
      "trg_enforce_block_on_message_insert would abort the write that caused this message whenever sender and recipient " +
        "are blocked; skip blocked recipients with `public.are_users_blocked(<sender>, <recipient>) IS NOT TRUE` (20261003183349)",
    ).toEqual([]);
  });

  describe("the guard can fail", () => {
    it("on the pre-Q713 status-message insert", () => {
      const original = `CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN
        INSERT INTO messages (job_id, sender_id, receiver_id, content, read, is_system)
        SELECT DISTINCT NEW.id, NEW.customer_id, p.participant, 'x', false, true
        FROM (SELECT m.sender_id AS participant FROM messages m WHERE m.job_id = NEW.id) p
        WHERE p.participant IS NOT NULL
        ON CONFLICT DO NOTHING;
        RETURN NEW; END $function$;`;
      expect(unscreened(original)).toHaveLength(1);
    });

    it("on a single-row insert in a function that never screens, and not on one that does", () => {
      const bare = `BEGIN INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES (a, b, c, 'x'); END`;
      expect(unscreened(bare)).toHaveLength(1);
      const screened = `BEGIN IF public.are_users_blocked(b, c) IS NOT TRUE THEN INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES (a, b, c, 'x'); END IF; END`;
      expect(unscreened(screened)).toEqual([]);
    });
  });
});
