/**
 * Owner, 2026-10-21 (jobs handoff 2, item 1): after a booked job's date or time
 * changes, BOTH sides confirm the NEW slot. On prod, job 7c6deb77 ("Mow two
 * lawns") kept the poster's confirmation of the OLD slot after the Helpr's
 * change was accepted, so the cards read "both confirmed" for a time nobody had
 * confirmed (measured 2026-10-21, read-only).
 *
 * The class: a confirmation is FOR a slot, so any path that moves a booked
 * job's slot must clear it. 20261021074803 puts that in one place, a BEFORE
 * UPDATE OF date_needed, start_time trigger on jobs, so every mover
 * (respond_job_schedule_change today, any future one) gets it. This guard reads
 * the trigger the migrations LEAVE (newest CREATE minus DROPs) and the newest
 * body of its function:
 *   - it exists, BEFORE UPDATE, on date_needed / start_time;
 *   - its body clears every slot confirmation (SLOT_CONFIRMS), the Helpr's
 *     day-of one only outside the 2-hour repost window (review M1);
 *   - its name sorts after the two column locks, so they judge the caller's
 *     own write and never see the clear (Postgres fires same-timing triggers
 *     in name order).
 * Behaviour proof: src/test/pglite/scheduleChangeClearsConfirms.pglite.mjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory } from "./helpers/migrationTriggers";

// Shown able to fail: each line alone reds this test.
// @mutate supabase/migrations/20261021074803_schedule_change_clears_confirms.sql |     NEW.poster_confirmed_at := NULL;\n |
// @mutate supabase/migrations/20261021074803_schedule_change_clears_confirms.sql |       NEW.helper_dayof_confirmed_at := NULL;\n |
// @mutate supabase/migrations/20261021074803_schedule_change_clears_confirms.sql |        > now() + interval '2 hours 15 minutes' THEN | > now() THEN
// @mutate supabase/migrations/20261021074803_schedule_change_clears_confirms.sql | CREATE TRIGGER zz_jobs_schedule_move_clears_confirms\n  BEFORE UPDATE OF date_needed, start_time ON public.jobs | CREATE TRIGGER zz_jobs_schedule_move_clears_confirms\n  BEFORE UPDATE OF title ON public.jobs
// @mutate supabase/migrations/20261021074803_schedule_change_clears_confirms.sql | CREATE TRIGGER zz_jobs_schedule_move_clears_confirms\n  BEFORE | CREATE TRIGGER zz_jobs_schedule_move_clears_confirms\n  AFTER

/** Every jobs column that confirms a particular day and time. */
const SLOT_CONFIRMS = ["poster_confirmed_at", "helper_dayof_confirmed_at"];
const LOCKS = ["trg_helper_jobs_column_whitelist", "trg_poster_jobs_money_lock"];

const MIG = join(process.cwd(), "supabase/migrations");
const files = migrationFiles(MIG);
const inv = triggerInventory(files.map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") })));
const defs = effectiveDefs(MIG);

describe("a booked job's slot moving clears both confirmations (owner, 2026-10-21)", () => {
  const trg = inv.get("jobs.zz_jobs_schedule_move_clears_confirms");

  it("the trigger exists, BEFORE UPDATE of date_needed / start_time", () => {
    expect(trg, "zz_jobs_schedule_move_clears_confirms is gone from public.jobs").toBeDefined();
    expect(trg!.timing.toUpperCase()).toBe("BEFORE");
    expect(trg!.events.replace(/\s+/g, " ")).toMatch(/UPDATE OF date_needed, start_time/i);
  });

  it("its function clears every slot confirmation", () => {
    const body = bodyOf(defs.get(trg!.fn)?.stmt ?? "").replace(/\s+/g, " ");
    expect(body.length).toBeGreaterThan(50);
    for (const col of SLOT_CONFIRMS) expect(body, `${col} is not cleared`).toContain(`NEW.${col} := NULL`);
  });

  it("the Helpr's day-of confirm survives a move inside the repost window (review M1)", () => {
    // sweep_confirm_reminders_and_repost hands back an accepted job starting
    // within 2 hours with no day-of confirm; clearing it on a short-notice
    // move would take the job off the Helpr who just agreed to it.
    const body = bodyOf(defs.get(trg!.fn)?.stmt ?? "").replace(/\s+/g, " ");
    expect(body).toMatch(/> now\(\) \+ interval '2 hours 15 minutes' THEN NEW\.helper_dayof_confirmed_at := NULL/);
  });

  it("it sorts after both column locks", () => {
    for (const lock of LOCKS) {
      expect(inv.get(`jobs.${lock}`), `${lock} renamed: re-check the order`).toBeDefined();
      expect(trg!.name > lock, `${trg!.name} must fire after ${lock}`).toBe(true);
    }
  });
});
