/**
 * GUARD (Q706, owner 2026-10-04): every fee and strike that depends on "the
 * hire moment" starts when the Helpr ACCEPTS (complete_job_accept stamps
 * jobs.helper_confirmed_at; a crew member's rpc_group_member_confirm stamps
 * group_job_helpers.helper_confirmed_at), never when the poster offers.
 *
 * THE BUGS (live bodies read 2026-10-04): crew_fee_pays_unconfirmed() returned
 * true, so poster_cancel_job paid a crew member who was only OFFERED a spot and
 * counted them toward the poster's strike; helper_cancel_booking struck an
 * offered-only Helpr, and a crew member who never confirmed, for "cancelling
 * after committing". Fixed by 20261004193450_hire_moment_is_the_accept.sql.
 * PGlite proof (old RED, new GREEN, applied 3x):
 * src/test/pglite/hireMomentIsTheAccept.pglite.mjs.
 *
 * THE CLASS, from the migrations: every function whose NEWEST body strikes a
 * Helpr for cancelling "after committing" must read an accept stamp
 * (helper_confirmed_at) before it does. Bodies read with any dollar tag,
 * comments blanked.
 *
 * @mutate supabase/migrations/20261004193450_hire_moment_is_the_accept.sql | AS $function$ SELECT false $function$; | AS $function$ SELECT true $function$;
 * @mutate supabase/migrations/20261004193450_hire_moment_is_the_accept.sql |   IF v_job.helper_confirmed_at IS NULL THEN\n    RAISE EXCEPTION 'offer_not_accepted' |   IF false THEN\n    RAISE EXCEPTION 'offer_not_accepted'
 * @mutate supabase/migrations/20261004193450_hire_moment_is_the_accept.sql |     IF v_slot_confirmed_at IS NULL THEN | IF false THEN
 * @mutate supabase/migrations/20261005172453_crew_block_and_unanswered_spot.sql |      IF v_crew.member_confirmed_at IS NOT NULL\n         AND public.is_late_cancellation | IF public.is_late_cancellation
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\2/gi;

const MIGRATION_FILES = readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort();
const newest = new Map<string, { file: string; body: string }>();
for (const f of MIGRATION_FILES) {
  const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
  for (const m of sql.matchAll(FN_RE)) newest.set(m[1].toLowerCase(), { file: f, body: m[3] });
}

describe("the hire moment is the Helpr's accept (Q706)", () => {
  it("reads the migrations (floor)", () => {
    // 956 migration files and several hundred functions on 2026-10-04.
    expect(MIGRATION_FILES.length).toBeGreaterThan(900);
    expect(newest.size).toBeGreaterThan(300);
  });

  it("crew_fee_pays_unconfirmed() is false: an unconfirmed crew member pays no fee and counts toward no strike", () => {
    const fn = newest.get("crew_fee_pays_unconfirmed");
    expect(fn, "crew_fee_pays_unconfirmed not found").toBeDefined();
    expect(fn!.body.trim()).toMatch(/^SELECT\s+false$/i);
  });

  it("helper_cancel_booking refuses an offer that was never accepted, before any strike", () => {
    const body = newest.get("helper_cancel_booking")!.body;
    const refuse = body.search(/IF\s+v_job\.helper_confirmed_at\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+'offer_not_accepted'/i);
    expect(refuse, "no offer_not_accepted refusal").toBeGreaterThan(0);
    // The single-Helper path's strike is the body's LAST one; the refusal
    // must come before it.
    expect(body.lastIndexOf("apply_job_denial_consequence")).toBeGreaterThan(refuse);
  });

  it("helper_cancel_booking strikes a crew member only once they confirmed their spot", () => {
    const body = newest.get("helper_cancel_booking")!.body;
    const gate = body.search(/IF\s+v_slot_confirmed_at\s+IS\s+NULL\s+THEN\s+v_result\s*:=\s*jsonb_build_object\('action',\s*'none',\s*'reason',\s*'spot_never_confirmed'\)/i);
    expect(gate, "no confirmed-spot gate on the crew strike").toBeGreaterThan(0);
    const firstStrike = body.indexOf("apply_job_denial_consequence");
    expect(firstStrike).toBeGreaterThan(gate);
  });

  // A mere mention of helper_confirmed_at is not a gate: the pre-Q706
  // helper_cancel_booking already named it in its reopen UPDATE (review of
  // Q706). The class rule is a real gate: an `<…>confirmed_at IS NULL THEN`
  // test BEFORE the function's first strike call.
  //
  // A gate is either the refusal shape (`<…>confirmed_at IS NULL THEN`) or the
  // accept stamp tested positively in an IF condition or in a boolean the
  // strike is gated on (`IF … member_confirmed_at IS NOT NULL AND …`,
  // `v_committed := … helper_confirmed_at IS NOT NULL`), the shape
  // block_user_and_settle has used since 2026-09-23. A WHERE clause or a SET is
  // still not a gate. Strike CALLS are counted with string literals blanked, so
  // a `to_regprocedure('public.apply_…')` existence check is not a strike.
  const GATE = [
    /confirmed_at\s+IS\s+NULL\s+THEN/i,
    /\bIF\b(?:(?!\bTHEN\b)[^;])*confirmed_at\s+IS\s+NOT\s+NULL/i,
    /:=(?:(?!\bTHEN\b)[^;])*confirmed_at\s+IS\s+NOT\s+NULL/i,
  ];
  const blankStrings = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, (m) => "'" + " ".repeat(m.length - 2) + "'");
  it("CLASS: every function that strikes for cancelling 'after committing' gates on an accept stamp before its first strike", () => {
    const strikers = [...newest.entries()].filter(([, v]) => /Cancelled after committing/i.test(v.body));
    // helper_cancel_booking and block_user_and_settle (Q729, 20261005172453) on 2026-10-05.
    expect(strikers.length).toBeGreaterThanOrEqual(2);
    // Every strike call (one per branch: crew, single Helpr) needs its own
    // gate between the previous strike (or the top) and itself.
    const missing = strikers
      .filter(([, v]) => {
        const segments = blankStrings(v.body).split(/apply_job_denial_consequence|apply_consequence_ladder|apply_cancellation_violation_consequence/i);
        if (segments.length < 2) return true;
        return segments.slice(0, -1).some((seg) => !GATE.some((g) => g.test(seg)));
      })
      .map(([k, v]) => `${k} (${v.file})`);
    expect(missing).toEqual([]);
  });
});
