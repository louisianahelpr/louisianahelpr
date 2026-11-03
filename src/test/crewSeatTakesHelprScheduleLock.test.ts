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
 *
 * Part 2 (the solo hire writers): the class is every BOOKING writer, a crew
 * seat insert OR a function that books a Helpr onto a job (UPDATE jobs SET
 * helper_id = <a Helpr>, status = 'accepted'): accept_application,
 * complete_direct_offer_accept, claim_series_dates. Each takes the lock before
 * its booking write and before any row lock, except
 * complete_direct_offer_accept, whose every caller already holds its job row:
 * there the lock must be the very next statement after that row lock, and its
 * callers are an exact set. complete_pending_accepts_on_setup (a caller that
 * loops FOR UPDATE OF j inside the Stripe status write) takes it before its
 * loop, inside a block that catches a deadlock. Lock order per function:
 * 20261103032329 / 20261103032330 headers. Proof:
 * src/test/pglite/soloHireTakesHelprScheduleLock.pglite.mjs (8 checks red, 2026-11-02, on
 * the live definitions with --before).
 */
// @mutate supabase/migrations/20261103025348_crew_seat_takes_helpr_schedule_lock.sql | PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' \|\| v_helper_id::text)); | PERFORM 1;
// @mutate supabase/migrations/20261103025348_crew_seat_takes_helpr_schedule_lock.sql |   FROM public.applications a\n  WHERE a.id = p_application_id; |   FROM public.applications a\n  WHERE a.id = p_application_id\n  FOR UPDATE;
// @mutate supabase/migrations/20261103032329_solo_hire_takes_helpr_schedule_lock.sql | PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' \|\| v_helper_id::text)); | PERFORM 1;
// @mutate supabase/migrations/20261103032329_solo_hire_takes_helpr_schedule_lock.sql | PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' \|\| p_helper::text)); | PERFORM 1;
// @mutate supabase/migrations/20261103032329_solo_hire_takes_helpr_schedule_lock.sql | FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;\n | FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;\n  PERFORM public.are_users_blocked(p_helper, v_customer);\n
// @mutate supabase/migrations/20261103032329_solo_hire_takes_helpr_schedule_lock.sql |   BEGIN\n  PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' \|\| NEW.user_id::text));\n  FOR r IN |   BEGIN\n  FOR r IN
// @mutate supabase/migrations/20261103032329_solo_hire_takes_helpr_schedule_lock.sql |   EXCEPTION WHEN deadlock_detected THEN |   EXCEPTION WHEN unique_violation THEN
// @mutate supabase/migrations/20261103032329_solo_hire_takes_helpr_schedule_lock.sql | 'pending_count', (SELECT count(*) | 'pending_total', (SELECT count(*)
// @mutate supabase/migrations/20261103032330_series_claim_takes_helpr_schedule_lock.sql | PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' \|\| v_uid::text)); | PERFORM 1;
// @mutate supabase/migrations/20261021102943_refund_requests.sql |       IF v_job.helper_id IS NOT NULL THEN\n        PERFORM pg_advisory_xact_lock | IF true THEN\n        PERFORM pg_advisory_xact_lock

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const EFFECTIVE = effectiveDefs(MIGRATIONS);
const body = (name: string) => blankSqlComments(EFFECTIVE.get(name)?.stmt ?? "");

const LOCK = /PERFORM\s+pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*'helpr_schedule:'\s*\|\|/i;
const ROW_LOCK = /\bFOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/i;
const SEAT_INSERT = /INSERT\s+INTO\s+(public\.)?group_job_helpers\b/i;

/** Every function whose newest definition takes the per-Helpr schedule lock. */
const EXPECTED_LOCK_TAKERS = [
  "accept_application",
  "accept_group_application",
  "claim_series_dates",
  "complete_direct_offer_accept",
  "complete_pending_accepts_on_setup",
  "respond_job_schedule_change",
];

/** Hire writers whose every caller already holds the job row: the lock is the next statement after it. */
const LOCK_AFTER_CALLERS_ROW = ["complete_direct_offer_accept"];
/** Every caller of complete_direct_offer_accept (each holds the job row first; a new one needs its own review). */
const EXPECTED_DIRECT_ACCEPT_CALLERS = [
  "complete_pending_accepts_on_setup",
  "quote_job_funded_hires_quoter",
  "respond_to_direct_offer",
];

function seatWriters(): string[] {
  return [...EFFECTIVE.keys()].filter((n) => SEAT_INSERT.test(body(n))).sort();
}

/** The SET clauses of every UPDATE of public.jobs in a body. */
function jobUpdateSets(b: string): string[] {
  const out: string[] = [];
  const re = /UPDATE\s+(?:public\.)?jobs\b(?:\s+\w+)?\s+SET\b([\s\S]*?)(?:\bWHERE\b|;)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(b))) out.push(m[1]);
  return out;
}
const HIRE_SET = (set: string) => /\bhelper_id\s*=\s*(?!NULL\b)[\w(]/i.test(set) && /\bstatus\s*=\s*'accepted'/i.test(set);

/** Functions that book a Helpr onto a job: UPDATE jobs SET helper_id = <a Helpr>, status = 'accepted'. */
function hireWriters(): string[] {
  return [...EFFECTIVE.keys()].filter((n) => jobUpdateSets(body(n)).some(HIRE_SET)).sort();
}

/** Offset of the first booking write in a body (seat insert or hire UPDATE), or -1. */
function firstBookingWrite(b: string): number {
  const seat = b.search(SEAT_INSERT);
  const re = /UPDATE\s+(?:public\.)?jobs\b(?:\s+\w+)?\s+SET\b([\s\S]*?)(?:\bWHERE\b|;)/gi;
  let m: RegExpExecArray | null;
  let hire = -1;
  while ((m = re.exec(b))) if (HIRE_SET(m[1])) { hire = m.index; break; }
  const hits = [seat, hire].filter((i) => i >= 0);
  return hits.length ? Math.min(...hits) : -1;
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

  it("finds the hire writers (inventory, exact)", () => {
    expect(hireWriters()).toEqual(["accept_application", "claim_series_dates", "complete_direct_offer_accept"]);
  });

  it("every booking writer takes the schedule lock before its booking write and before any row lock (one reviewed exception)", () => {
    const writers = [...new Set([...seatWriters(), ...hireWriters()])].sort();
    expect(writers.length).toBeGreaterThan(3);
    const bad: string[] = [];
    for (const n of writers) {
      const b = body(n);
      const lock = b.search(LOCK);
      const write = firstBookingWrite(b);
      const rowLock = ROW_LOCK.exec(b);
      if (lock < 0) { bad.push(`${n}: no schedule lock`); continue; }
      if (write >= 0 && write < lock) bad.push(`${n}: the booking write comes before the schedule lock`);
      if (rowLock && rowLock.index < lock) {
        if (!LOCK_AFTER_CALLERS_ROW.includes(n)) bad.push(`${n}: a row lock comes before the schedule lock (wait-cycle risk)`);
        else {
          // The exception: the lock is the very next statement after that row lock.
          const stmtEnd = b.indexOf(";", rowLock.index) + 1;
          if (b.slice(stmtEnd, lock).trim() !== "") bad.push(`${n}: something runs between its job row lock and the schedule lock`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("complete_direct_offer_accept's callers are exactly the reviewed set", () => {
    const callers = [...EFFECTIVE.keys()]
      .filter((n) => n !== "complete_direct_offer_accept" && /\bcomplete_direct_offer_accept\s*\(/i.test(body(n)))
      .sort();
    expect(callers).toEqual(EXPECTED_DIRECT_ACCEPT_CALLERS);
  });

  it("the setup trigger takes the lock before its FOR UPDATE OF j loop, inside a block that catches a deadlock", () => {
    const b = body("complete_pending_accepts_on_setup");
    const lock = b.search(LOCK);
    const loop = b.search(/FOR\s+UPDATE\s+OF\s+j\b/i);
    expect(lock).toBeGreaterThan(0);
    expect(loop).toBeGreaterThan(lock);
    expect(b).toMatch(/BEGIN\s+PERFORM pg_advisory_xact_lock\(hashtext\('helpr_schedule:' \|\| NEW\.user_id::text\)\);\s+FOR r IN/);
    expect(b.slice(loop)).toMatch(/END LOOP;\s+EXCEPTION WHEN deadlock_detected THEN\s+INSERT INTO public\.error_logs/);
    // The log row makes a stuck accept findable: who, and how many accepts still wait (lead 2026-11-02).
    const handler = b.slice(b.search(/EXCEPTION WHEN deadlock_detected THEN/));
    expect(handler).toMatch(/'user_id', NEW\.user_id/);
    expect(handler).toMatch(/'pending_count', \(SELECT count\(\*\) FROM public\.job_accept_pending p WHERE p\.helper_id = NEW\.user_id\)/);
  });

  it("each hire writer keys the lock on the Helpr it books", () => {
    expect(body("accept_application")).toMatch(/PERFORM pg_advisory_xact_lock\(hashtext\('helpr_schedule:' \|\| v_helper_id::text\)\);/);
    expect(body("complete_direct_offer_accept")).toMatch(/PERFORM pg_advisory_xact_lock\(hashtext\('helpr_schedule:' \|\| p_helper::text\)\);/);
    expect(body("claim_series_dates")).toMatch(/PERFORM pg_advisory_xact_lock\(hashtext\('helpr_schedule:' \|\| v_uid::text\)\);/);
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
    const p2 = resolve(__dirname, "pglite/soloHireTakesHelprScheduleLock.pglite.mjs");
    expect(existsSync(p2)).toBe(true);
    const src2 = readFileSync(p2, "utf8");
    for (const c of ["A1 accept_application holds", "D1 complete_direct_offer_accept holds", "C1 claim_series_dates holds",
      "S1 the setup trigger holds", "S3 a deadlock in the trigger's loop", "process.exit(failures === 8 ? 0 : 1)"]) {
      expect(src2).toContain(c);
    }
  });
});
