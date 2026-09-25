/**
 * Q410 (2026-09-25): can_message_in_job's "the poster messaged THIS sender
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
 *   PGLITE_DIR=~/.lh-pglite-probe node src/test/pglite/messageGateCurrentParty.pglite.mjs
 *
 * @mutate supabase/migrations/20260925175953_message_gate_poster_first_requires_current_party.sql |             AND a.status IN ('pending', 'accepted') |             AND a.status IN ('pending', 'accepted', 'rejected')
 * @mutate supabase/migrations/20260925175953_message_gate_poster_first_requires_current_party.sql |         AND EXISTS (\n          SELECT 1 FROM public.applications a | \n        OR EXISTS (\n          SELECT 1 FROM public.applications a
 * @mutate supabase/migrations/20260925175953_message_gate_poster_first_requires_current_party.sql |   REVOKE ALL ON FUNCTION public.can_message_in_job(uuid, uuid) FROM PUBLIC, anon, authenticated; |   REVOKE ALL ON FUNCTION public.can_message_in_job(uuid, uuid) FROM PUBLIC;
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

describe("can_message_in_job: a poster's earlier message never outlives the sender's party status (Q410)", () => {
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
    expect(body).toMatch(/j\.offered_to_helper_id = _sender OR j\.helper_id = _sender/);
    expect(body).toMatch(/FROM public\.group_job_helpers g WHERE g\.job_id = _job_id AND g\.helper_id = _sender/);
    expect(body).toMatch(/SECURITY DEFINER/i);
    expect(body).toMatch(/SET search_path TO 'public'/i);
  });

  it("the defining migration keeps the gate internal (no anon or authenticated EXECUTE)", () => {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, gate!.file), "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.can_message_in_job(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.can_message_in_job\(uuid, uuid\) TO [^;]*\b(anon|authenticated)\b/);
  });

  it("the PGlite proof exists and reads the gate by scanning, not by a pinned name", () => {
    const proof = join(ROOT, "src/test/pglite/messageGateCurrentParty.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    const src = readFileSync(proof, "utf8");
    expect(src).toContain('newestDef("can_message_in_job", Q410)');
    for (const c of ["removed crew member", "rejected applicant", "current crew member", "25h after completion"]) {
      expect(src).toContain(c);
    }
  });
});
