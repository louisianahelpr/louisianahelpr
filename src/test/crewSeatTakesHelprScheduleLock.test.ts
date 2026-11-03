import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * Q1919 (lh-authz-rls@78c205c37#1): a crew seat accepted at the same moment
 * as a schedule-change accept for the same Helpr could double-book them with
 * nobody told. respond_job_schedule_change re-checks the Helpr's bookings
 * under pg_advisory_xact_lock(hashtext('helpr_schedule:' || helper)); the crew
 * seat writer took no such lock, so neither saw the other's uncommitted row.
 *
 * The class: EVERY function that writes a crew seat (INSERT INTO
 * public.group_job_helpers; a seat is born 'accepted') takes the same lock,
 * before its first row lock, so the two take turns and no wait cycle forms.
 * The set of functions taking the lock is exact, so a new taker gets its own
 * lock-order review. The lock-order argument rests on
 * respond_job_schedule_change taking the lock only for a job with a lead,
 * which a crew job never is (trg_group_job_has_no_lead); that is pinned too.
 *
 * Proof the lock is held: src/test/pglite/crewSeatTakesHelprScheduleLock.pglite.mjs
 * (L1/L2 red on the live definition with --before).
 */
// @mutate supabase/migrations/20261103025348_crew_seat_takes_helpr_schedule_lock.sql | PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' \|\| v_helper_id::text)); | PERFORM 1;
// @mutate supabase/migrations/20261103025348_crew_seat_takes_helpr_schedule_lock.sql |   FROM public.applications a\n  WHERE a.id = p_application_id; |   FROM public.applications a\n  WHERE a.id = p_application_id\n  FOR UPDATE;
// @mutate supabase/migrations/20261021102943_refund_requests.sql |       IF v_job.helper_id IS NOT NULL THEN\n        PERFORM pg_advisory_xact_lock | IF true THEN\n        PERFORM pg_advisory_xact_lock

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const EFFECTIVE = effectiveDefs(MIGRATIONS);
const body = (name: string) => blankSqlComments(EFFECTIVE.get(name)?.stmt ?? "");

const LOCK = /PERFORM\s+pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*'helpr_schedule:'\s*\|\|/i;
const ROW_LOCK = /\bFOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/i;
const SEAT_INSERT = /INSERT\s+INTO\s+(public\.)?group_job_helpers\b/i;

/** Every function whose newest definition takes the per-Helpr schedule lock. */
const EXPECTED_LOCK_TAKERS = ["accept_group_application", "respond_job_schedule_change"];

function seatWriters(): string[] {
  return [...EFFECTIVE.keys()].filter((n) => SEAT_INSERT.test(body(n))).sort();
}

describe("a crew seat and a schedule change for the same Helpr take turns (Q1919)", () => {
  it("finds the crew-seat writers (inventory floor)", () => {
    const w = seatWriters();
    expect(w.length).toBeGreaterThan(0);
    expect(w).toContain("accept_group_application");
  });

  it("every crew-seat writer takes the Helpr's schedule lock before any row lock and before the seat insert", () => {
    const bad: string[] = [];
    for (const n of seatWriters()) {
      const b = body(n);
      const lock = b.search(LOCK);
      const firstRowLock = b.search(ROW_LOCK);
      const insert = b.search(SEAT_INSERT);
      if (lock < 0) bad.push(`${n}: no pg_advisory_xact_lock(hashtext('helpr_schedule:' || ...))`);
      else if (firstRowLock >= 0 && firstRowLock < lock) bad.push(`${n}: a row lock comes before the schedule lock (wait-cycle risk)`);
      else if (insert < lock) bad.push(`${n}: the seat insert comes before the schedule lock`);
    }
    expect(bad).toEqual([]);
  });

  it("accept_group_application keys the lock on the hired Helpr", () => {
    expect(body("accept_group_application")).toMatch(
      /PERFORM pg_advisory_xact_lock\(hashtext\('helpr_schedule:' \|\| v_helper_id::text\)\);/,
    );
  });

  it("respond_job_schedule_change takes the same key, only for a job with a lead (the lock-order premise)", () => {
    const b = body("respond_job_schedule_change");
    expect(b).toMatch(
      /IF v_job\.helper_id IS NOT NULL THEN\s+PERFORM pg_advisory_xact_lock\(hashtext\('helpr_schedule:' \|\| v_job\.helper_id::text\)\);\s+END IF;/,
    );
    // A crew job never has a lead, so it never holds a crew job's row while waiting for the lock.
    expect(body("enforce_group_job_has_no_lead")).toMatch(/IF NEW\.is_group_job IS TRUE AND NEW\.helper_id IS NOT NULL THEN\s+RAISE EXCEPTION 'group_job_has_no_lead/);
  });

  it("the set of functions taking the schedule lock is exact (a new taker needs its own lock-order review)", () => {
    const takers = [...EFFECTIVE.keys()].filter((n) => LOCK.test(body(n))).sort();
    expect(takers).toEqual(EXPECTED_LOCK_TAKERS);
  });

  it("the PGlite proof exists and asserts the lock is held, with a pinned red count", () => {
    const p = resolve(__dirname, "pglite/crewSeatTakesHelprScheduleLock.pglite.mjs");
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, "utf8");
    for (const c of ["L1 the seat accept holds", "L2 it already holds it", "process.exit(failures === 2 ? 0 : 1)"]) {
      expect(src).toContain(c);
    }
  });
});
