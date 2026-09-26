/**
 * Q705 (2026-09-25): can_message_in_job's "the poster messaged THIS sender
 * first" branch had no membership or status check, so a crew member removed
 * from the roster, or an applicant whose application was rejected, could keep
 * posting on the job for as long as it stayed open. A message the poster once
 * sent is history, not a party relationship.
 *
 * CLASS: a branch of the send gate that admits a sender because of an EARLIER
 * MESSAGE must also require a CURRENT relationship (a live application).
 * Checked on the gate's EFFECTIVE definition (newest CREATE, any dollar tag,
 * later rewrites applied), never on a migration pinned by name.
 *
 * Proof in real Postgres (before: hole open; after 3x: removed crew member and
 * rejected applicant refused, current parties allowed, the 24h post-completion
 * window and the cancelled-job close unchanged, grants {service_role} only):
 *   PGLITE_DIR=~/.lh-pglite-probe npx tsx src/test/pglite/messageGateCurrentParty.pglite.mjs
 *
 * Owner decision 2026-09-25 (Q407 addendum 14, settles Q420): messaging
 * closes BOTH ways once someone is off a job. So the same class covers the
 * sender's branch 2 (an offeree counts only while the offer is pending) and
 * the receiver gate (can_send_message_to_in_job refuses a receiver who is off
 * the job), through one internal predicate, is_off_job, which the client reads
 * via get_off_job_thread_state.
 *
 * Mutations target the NEWEST migration that defines each function (a
 * mutation on an older copy is vacuous: Q406).
 * @mutate supabase/migrations/20260925230845_messaging_closes_both_ways_off_job.sql |             AND a.status IN ('pending', 'accepted')\n        ) |             AND a.status IN ('pending', 'accepted', 'rejected')\n        )
 * @mutate supabase/migrations/20260925230845_messaging_closes_both_ways_off_job.sql |         AND EXISTS (\n          SELECT 1 FROM public.applications a | \n        OR EXISTS (\n          SELECT 1 FROM public.applications a
 * @mutate supabase/migrations/20260925230845_messaging_closes_both_ways_off_job.sql |               OR (j.offered_to_helper_id = _sender AND j.direct_offer_status = 'pending')) |               OR j.offered_to_helper_id = _sender)
 * @mutate supabase/migrations/20260925230845_messaging_closes_both_ways_off_job.sql |      AND NOT public.is_off_job(_job_id, _receiver)\n |      AND true\n
 * @mutate supabase/migrations/20260925230845_messaging_closes_both_ways_off_job.sql |   REVOKE ALL ON FUNCTION public.can_message_in_job(uuid, uuid) FROM PUBLIC, anon, authenticated; |   REVOKE ALL ON FUNCTION public.can_message_in_job(uuid, uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20260925230845_messaging_closes_both_ways_off_job.sql |   REVOKE ALL ON FUNCTION public.is_off_job(uuid, uuid) FROM PUBLIC, anon, authenticated; |   REVOKE ALL ON FUNCTION public.is_off_job(uuid, uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20260925230845_messaging_closes_both_ways_off_job.sql |                        AND a.status IN ('pending', 'accepted')); |                        AND a.status IN ('pending', 'accepted', 'rejected'));
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const defs = effectiveDefs(MIGRATIONS);
const gate = defs.get("can_message_in_job");

/** Body of the gate with comments blanked and whitespace collapsed. */
const body = blankSqlComments(gate?.stmt ?? "").replace(/\s+/g, " ");

/**
 * Every place the gate reads public.messages, with the text of the parenthesised
 * group that encloses it (the branch it belongs to).
 */
function messageBranches(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/FROM public\.messages\b/gi)) {
    // Walk out of the EXISTS ( ... ) that contains the read, then out of the
    // group that contains that EXISTS: that group is the branch.
    let depth = 0;
    let start = m.index!;
    let levels = 0;
    for (let i = m.index!; i >= 0; i--) {
      if (sql[i] === ")") depth++;
      else if (sql[i] === "(") {
        if (depth === 0) {
          levels++;
          start = i;
          if (levels === 2) break;
        } else depth--;
      }
    }
    let end = start;
    depth = 0;
    for (let i = start; i < sql.length; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    out.push(sql.slice(start, end + 1));
  }
  return out;
}

describe("can_message_in_job: a poster's earlier message never outlives the sender's party status (Q705)", () => {
  it("resolves the gate's effective definition", () => {
    expect(gate, "no migration defines can_message_in_job").toBeDefined();
    expect(defs.size).toBeGreaterThan(300);
    expect(body).toMatch(/RETURNS boolean/i);
  });

  it("every branch that admits by an earlier message also requires a live application", () => {
    const branches = messageBranches(body);
    expect(branches.length, "the gate no longer reads public.messages: re-read this guard").toBeGreaterThan(0);
    for (const b of branches) {
      expect(b, `branch admits by message history alone:\n${b}`).toMatch(
        /AND EXISTS \( SELECT 1 FROM public\.applications a WHERE a\.job_id = _job_id AND a\.helper_id = _sender AND a\.status IN \('pending', 'accepted'\) \)/,
      );
      expect(b, "a rejected application must never re-admit a sender").not.toMatch(/'rejected'/);
    }
  });

  it("the other branches are unchanged: poster, hired/offered, current roster, and the lockout in front", () => {
    expect(body).toContain("COALESCE(public.job_messaging_closes_at(_job_id) > now(), true) AND (");
    expect(body).toMatch(/j\.customer_id = _sender/);
    // Branch 2 (Q420(a)): the hire, or an offer that is still PENDING. The
    // column alone kept declined/expired offerees, and an accepted offeree who
    // later cancelled, on the job for good.
    expect(body).toMatch(/j\.helper_id = _sender OR \(j\.offered_to_helper_id = _sender AND j\.direct_offer_status = 'pending'\)/);
    expect(body).not.toMatch(/j\.offered_to_helper_id = _sender OR/);
    expect(body).toMatch(/FROM public\.group_job_helpers g WHERE g\.job_id = _job_id AND g\.helper_id = _sender/);
    expect(body).toMatch(/SECURITY DEFINER/i);
    expect(body).toMatch(/SET search_path TO 'public'/i);
  });

  it("the receiver gate refuses anyone off the job, whoever is sending (owner, 2026-09-25)", () => {
    const recv = defs.get("can_send_message_to_in_job");
    expect(recv, "no migration defines can_send_message_to_in_job").toBeDefined();
    const rbody = blankSqlComments(recv!.stmt).replace(/\s+/g, " ");
    expect(rbody).toContain("AND NOT public.is_off_job(_job_id, _receiver)");
    // Top-level conjunct, next to the caller's own gate: not inside one branch.
    expect(rbody).toMatch(/AND public\.can_message_in_job\(_job_id, auth\.uid\(\)\) AND NOT public\.is_off_job\(_job_id, _receiver\)/);
  });

  it("is_off_job: someone involved (applied or offered) who is no longer a party", () => {
    const off = defs.get("is_off_job");
    expect(off, "no migration defines is_off_job").toBeDefined();
    const ob = blankSqlComments(off!.stmt).replace(/\s+/g, " ");
    // involved
    expect(ob).toMatch(/EXISTS \(SELECT 1 FROM public\.applications a WHERE a\.job_id = _job_id AND a\.helper_id = _user\) OR EXISTS \(SELECT 1 FROM public\.jobs j WHERE j\.id = _job_id AND j\.offered_to_helper_id = _user\)/);
    // not a current party: poster, hire, pending offer, crew, live application
    expect(ob).toMatch(/NOT EXISTS \( SELECT 1 FROM public\.jobs j WHERE j\.id = _job_id AND \(j\.customer_id = _user OR j\.helper_id = _user OR \(j\.offered_to_helper_id = _user AND j\.direct_offer_status = 'pending'\)\)/);
    expect(ob).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.group_job_helpers g WHERE g\.job_id = _job_id AND g\.helper_id = _user\)/);
    expect(ob).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.applications a WHERE a\.job_id = _job_id AND a\.helper_id = _user AND a\.status IN \('pending', 'accepted'\)\)/);
    expect(defs.get("get_off_job_thread_state"), "the client's read is missing").toBeDefined();
  });

  it("grants: the gate and the predicate are internal; the client read is authenticated-only", () => {
    for (const [fn, sig, internal] of [
      ["can_message_in_job", "uuid, uuid", true],
      ["is_off_job", "uuid, uuid", true],
      ["can_send_message_to_in_job", "uuid, uuid", false],
      ["get_off_job_thread_state", "uuid, uuid", false],
    ] as const) {
      const sql = blankSqlComments(readFileSync(join(MIGRATIONS, defs.get(fn)!.file), "utf8"));
      const revoke = `REVOKE ALL ON FUNCTION public.${fn}(${sig}) FROM PUBLIC, anon${internal ? ", authenticated" : ""};`;
      expect(sql, `${fn}: the defining migration must revoke by role name`).toContain(revoke);
      const granted = [...sql.matchAll(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO ([^;]*);`, "g"))].map((m) => m[1]);
      expect(granted.join(","), `${fn}: anon must never be granted`).not.toMatch(/\banon\b/);
      if (internal) expect(granted.join(","), `${fn}: internal`).not.toMatch(/\bauthenticated\b/);
    }
  });

  it("the PGlite proof exists and reads the gate by scanning, not by a pinned name", () => {
    const proof = join(ROOT, "src/test/pglite/messageGateCurrentParty.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    const src = readFileSync(proof, "utf8");
    // Reads effective definitions (no pinned file), runs the REAL departure
    // trigger, and has the both-ways cases.
    expect(src).toContain("effectiveDefs(DIR, { before: Q705 })");
    expect(src).toContain('"trg_sync_job_after_roster_departure"');
    expect(src).not.toMatch(/UPDATE public\.applications SET status = 'rejected'/);
    for (const c of ["removed crew member", "rejected applicant", "declined offeree", "pending offeree", "current crew member", "25h after completion", "poster -> "]) {
      expect(src).toContain(c);
    }
  });
});
