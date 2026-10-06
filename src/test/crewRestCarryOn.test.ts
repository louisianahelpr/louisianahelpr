import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * Q1378 (docs/OPEN.md; owner decision 2026-10-05 ~18:40 CT): when a member
 * leaves a full crew, THE REST CARRY ON.
 *
 * THE CLASS: a writer that takes a member off a crew (deletes their
 * group_job_helpers row) and sends the booked crew back to 'open'. An open
 * crew cannot be worked (the member set-out and arrival RPCs need accepted or
 * in_progress), and auto-expire-jobs then cancels it as "no Helpr assigned"
 * with no fee for the members who turned up.
 *
 * The inventory is read from the EFFECTIVE definitions and is EXACT and
 * two-way: every function whose body deletes a roster row is listed here, so a
 * new one fails until someone checks it keeps the rest of the crew booked.
 * Each one may reopen a crew only when NOBODY is left on it.
 *
 * Behaviour: src/test/pglite/crewRestCarryOn.pglite.mjs (8 checks RED on the
 * old functions with --before, all green after, migration applied 3x).
 */

// @mutate supabase/migrations/20261006015121_crew_rest_carry_on.sql |     IF v_job.status::text = 'accepted' AND v_remaining = 0 THEN | IF v_job.status::text = 'accepted' AND v_remaining < COALESCE(v_job.helpers_needed, 1) THEN
// @mutate supabase/migrations/20261006015121_crew_rest_carry_on.sql |     IF v_crew.status = 'accepted' AND v_remaining = 0 THEN |     IF v_crew.status = 'accepted' AND v_remaining < COALESCE(v_crew.helpers_needed, 1) THEN
// @mutate supabase/migrations/20261006015121_crew_rest_carry_on.sql |       IF v_cjob.status = 'accepted' AND v_remaining = 0 THEN |       IF v_cjob.status = 'accepted' AND v_remaining < COALESCE(v_cjob.helpers_needed, 1) THEN
// @mutate supabase/migrations/20261006015121_crew_rest_carry_on.sql |   IF v_job_status IS NULL OR v_job_status NOT IN ('open', 'accepted') THEN |   IF v_job_status IS DISTINCT FROM 'open' THEN
// @mutate supabase/migrations/20261006015121_crew_rest_carry_on.sql |    WHERE id = v_job_id\n     -- A refill of a booked crew (Q1378) leaves it booked, full or not.\n     AND v_job_status = 'open'; |    WHERE id = v_job_id;
// @mutate supabase/migrations/20261006015121_crew_rest_carry_on.sql |         || CASE WHEN v_cjob.status = 'accepted' AND v_remaining > 0 |         || CASE WHEN false
// @mutate src/pages/posts/postedJobCard/crewRefill.ts |   return filled < needed; |   return false;

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const EFFECTIVE = effectiveDefs(MIGRATIONS);
const body = (name: string) => blankSqlComments(EFFECTIVE.get(name)?.stmt ?? "");
const THIS = "20261006015121_crew_rest_carry_on.sql";

/** Every function that takes a member off a crew, and the roster DELETE that does it. */
const ROSTER_DELETERS: Record<string, string> = {
  helper_cancel_booking: "DELETE FROM public.group_job_helpers WHERE id = v_slot_id;",
  block_user_and_settle: "DELETE FROM public.group_job_helpers WHERE id = v_crew.slot_id;",
  expire_unanswered_offers: "DELETE FROM public.group_job_helpers WHERE id = v_slot.slot_id;",
};

describe("Q1378: a booked crew a member leaves stays booked for the rest", () => {
  it("knows every function that deletes a roster row (exact, two-way)", () => {
    const deleters = [...EFFECTIVE.keys()]
      .filter((n) => /\bDELETE\s+FROM\s+(?:public\.)?group_job_helpers\b/i.test(body(n)))
      .sort();
    expect(deleters.length, "the inventory read nothing: the parser is broken").toBeGreaterThan(2);
    expect(deleters, "a function takes members off a crew and is not checked for the rest-carry-on rule").toEqual(
      Object.keys(ROSTER_DELETERS).sort(),
    );
  });

  it.each(Object.entries(ROSTER_DELETERS))("%s reopens a crew only when nobody is left", (fn, del) => {
    expect(EFFECTIVE.get(fn)?.file, `${fn} is not the Q1378 definition`).toBe(THIS);
    const b = body(fn);
    const at = b.indexOf(del);
    expect(at, `${fn}: its roster DELETE moved; re-read the function`).toBeGreaterThan(-1);
    // Everything after the member is taken off, up to the end of that branch.
    const after = b.slice(at, at + 2500);
    const flips = [...after.matchAll(/UPDATE public\.jobs\s+SET status = 'open'/g)];
    expect(flips.length, `${fn}: no reopen after the DELETE (an empty crew must still reopen)`).toBe(1);
    const guard = after.slice(Math.max(0, flips[0].index! - 120), flips[0].index!);
    expect(guard, `${fn}: a booked crew with members left is sent back to open`).toMatch(
      /= 'accepted' AND v_remaining = 0 THEN\s*$/,
    );
    expect(after).not.toMatch(/v_remaining < COALESCE\(/);
    // The poster is told the rest of the crew is still on (copy class: no
    // "open to everyone again" for a crew that stays booked).
    expect(after).toMatch(/AND v_remaining > 0\s+THEN '"\. The rest of your crew is still on\./);
  });

  it("accept_group_application refills a booked crew's free spot and keeps it booked", () => {
    expect(EFFECTIVE.get("accept_group_application")?.file).toBe(THIS);
    const b = body("accept_group_application");
    expect(b).toMatch(/IF v_job_status IS NULL OR v_job_status NOT IN \('open', 'accepted'\) THEN\s+RAISE EXCEPTION 'job_not_open';/);
    // A full booked crew still takes nobody, and never inside 15 minutes of the start.
    expect(b).toMatch(/IF v_current >= v_needed THEN\s+RAISE EXCEPTION 'roster_full';/);
    expect(b).toMatch(/IF v_cutoff IS NOT NULL AND v_cutoff <= now\(\) \+ interval '15 minutes' THEN\s+RAISE EXCEPTION 'job_starts_too_soon';/);
    // Only a STAFFING crew's status is written; a refill leaves a booked crew booked.
    expect(b).toMatch(/ELSE 'open' END\)::job_status\s+WHERE id = v_job_id\s+AND v_job_status = 'open';/);
  });

  it("restates the grants the live functions carry", () => {
    const sql = blankSqlComments(readFileSync(resolve(MIGRATIONS, THIS), "utf8"));
    for (const sig of ["helper_cancel_booking(uuid)", "block_user_and_settle(uuid, text)", "accept_group_application(uuid, timestamp with time zone, text)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated, service_role;`);
    }
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.expire_unanswered_offers() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.expire_unanswered_offers() TO service_role;");
  });

  it("the poster's card offers the refill on a booked crew with a free spot", () => {
    const card = blankComments(readFileSync(resolve(ROOT, "src/pages/posts/PostedJobCard.tsx"), "utf8"));
    expect(card).toMatch(/\(job\.status === "open" \|\| crewSpotRefillable\(job, initialGroupHelpers\)\) && \(\s*<PostedJobApplicants/);
  });

  it("has a PGlite proof that is red on the old functions", () => {
    const proof = resolve(ROOT, "src/test/pglite/crewRestCarryOn.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    const src = readFileSync(proof, "utf8");
    expect(src).toContain(`const THIS = "${THIS}"`);
    expect(src).toContain("effectiveDefs(DIR, { before: THIS })");
    for (const c of ["C1 a member leaves a booked crew", "C2 a member left can still set out", "B1 the poster blocks one member",
      "B2 a member blocks the poster", "E1 an unanswered spot expires", "R1 the poster refills the spot", "Z1 a crew with nobody left reopens",
      "const expected = 8;"]) {
      expect(src).toContain(c);
    }
  });
});
