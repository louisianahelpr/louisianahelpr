import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * THE CLASS: a cron or a count that finds "the booked Helpr" through
 * jobs.helper_id and never reads the roster.
 *
 * A crew has no lead (Q407, 20260925154606): jobs.helper_id is NULL on every
 * group job, so `j.helper_id IS NOT NULL` skips every crew and
 * `j.helper_id = <user>` never counts a crew member's job. Before
 * 20260925235506 (docs/OPEN.md Q408) that meant no day-of, start or no-show
 * message to any crew member, no auto-start, and crew jobs missing from every
 * completed count (red on the before state:
 * src/test/pglite/groupCrewReminders.pglite.mjs R1-R5).
 *
 * The inventory below is EXACT and two-way, read from the effective
 * definitions: every function that matches the pattern without reading
 * group_job_helpers is listed with why a crew does not need it (or which Q line
 * owns building it). A new one fails here until someone decides; a fixed one
 * fails until it is taken off.
 */

// @mutate supabase/migrations/20260925235506_group_crew_reminders_and_counts.sql |       AND j.is_group_job IS TRUE\n      AND j.status IN ('open', 'accepted')\n      AND j.date_needed IS NOT NULL\n      AND EXISTS | AND false\n      AND j.status IN ('open', 'accepted')\n      AND j.date_needed IS NOT NULL\n      AND EXISTS
// @mutate supabase/migrations/20260925235506_group_crew_reminders_and_counts.sql |          OR (j.is_group_job IS TRUE\n             AND EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)\n             AND NOT EXISTS |          OR (false\n             AND EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)\n             AND NOT EXISTS
// @mutate supabase/migrations/20260925235506_group_crew_reminders_and_counts.sql |                               WHERE g.job_id = j.id AND g.helper_id IS NOT NULL AND g.helper_confirmed_at IS NULL)) |                               WHERE false))
// @mutate supabase/migrations/20260925235506_group_crew_reminders_and_counts.sql |   JOIN public.jobs j\n    ON j.status = 'completed'\n   AND (j.helper_id = u.id\n        OR (j.is_group_job IS TRUE AND EXISTS ( |   JOIN public.jobs j\n    ON j.status = 'completed'\n   AND (j.helper_id = u.id\n        OR (false AND EXISTS (
// @mutate supabase/migrations/20260925235506_group_crew_reminders_and_counts.sql | REVOKE ALL ON FUNCTION public.get_helper_completed_counts(uuid[]) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.get_helper_completed_counts(uuid[]) FROM PUBLIC;

const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");
const THIS = "20260925235506_group_crew_reminders_and_counts.sql";
const EFFECTIVE = effectiveDefs(MIGRATIONS);
const body = (name: string) => blankSqlComments(EFFECTIVE.get(name)?.stmt ?? "");

/** Booked-job selection or a per-Helpr count through jobs.helper_id. */
const SINGLE_HELPER_SELECT =
  /\bj\.helper_id IS NOT NULL\b|\bj\.helper_id\s*=\s*(?:_user_id|p_user_id|t\.user_id|p\.user_id|ANY\s*\(\s*p_user_ids\s*\)|_helper_id|p_helper_id|u\.id|u\.user_id)\b/i;

const NOT_FOR_A_CREW: Record<string, string> = {
  expire_unanswered_offers:
    "a single Helpr's offer deadline; a crew member has none (accept_group_application writes no response_deadline). Whether an unconfirmed crew member's slot should expire is an owner question (Q408), since Q407(13) counts an offered member as hired",
  get_payout_batch_job_ids: "admin single-helper release batches (release-payout refuses a crew); a crew is paid only by process-scheduled-payouts' fan-out",
  get_payout_batches: "admin single-helper release batches (release-payout refuses a crew); a crew is paid only by process-scheduled-payouts' fan-out",
  get_helper_earnings_export:
    "NOT YET BUILT (Q408 follow-up): the earnings export reads jobs.helper_id, so a crew member's earnings (payout_transfers per member) are missing from it",
  get_neighbor_hire_count: "NOT YET BUILT (Q408 follow-up): the 'hired by N neighbours' signal counts single-helper jobs only",
  get_top_helpers_by_parish: "NOT YET BUILT (Q408 follow-up): the parish top-10 ranking counts single-helper jobs only",
};

describe("a crew gets its reminders, auto-start and counts (Q408)", () => {
  it("every function that finds the booked Helpr through jobs.helper_id either reads the roster or is classified", () => {
    const found = [...EFFECTIVE.entries()]
      .filter(([, d]) => {
        const b = blankSqlComments(d.stmt);
        return SINGLE_HELPER_SELECT.test(b) && !/group_job_helpers/i.test(b);
      })
      .map(([n]) => n)
      .sort();
    expect(found.length).toBeGreaterThan(3);
    expect(found, "an unclassified helper_id-only cron or count: give a crew its roster version, or classify it").toEqual(
      Object.keys(NOT_FOR_A_CREW).sort(),
    );
    // Inventory floor for the fixed side: these read the roster now.
    const fixed = [
      "sweep_dayof_confirm_reminders", "sweep_job_start_reminders", "sweep_no_show_alerts", "auto_start_due_jobs",
      "get_helper_completed_counts", "get_helper_parish_badges", "get_public_profile_stats",
    ];
    for (const fn of fixed) {
      const b = body(fn);
      expect(b, `${fn} is gone`).not.toHaveLength(0);
      expect(b, `${fn} no longer reads the roster`).toMatch(/group_job_helpers/);
      expect(EFFECTIVE.get(fn)?.file, `${fn} is not the Q408 definition`).toBe(THIS);
    }
  });

  it("the crew reminder passes stamp the job once and address the members from the roster", () => {
    const dayof = body("sweep_dayof_confirm_reminders");
    // Each crew path selects crews (not a constant-false branch).
    expect(dayof).toMatch(/WHERE j\.dayof_confirm_reminder_sent_at IS NULL\s+AND j\.is_group_job IS TRUE\s+AND j\.status IN \('open', 'accepted'\)/);
    expect(dayof).toMatch(/WHERE j\.dayof_unanswered_poster_alert_sent_at IS NULL\s+AND j\.is_group_job IS TRUE/);
    expect(body("sweep_job_start_reminders")).toMatch(/WHERE j\.start_reminder_sent_at IS NULL\s+AND j\.is_group_job IS TRUE/);
    expect(body("sweep_no_show_alerts")).toMatch(/WHERE j\.no_show_alert_sent_at IS NULL\s+AND j\.is_group_job IS TRUE/);
    expect(body("auto_start_due_jobs")).toMatch(/OR \(j\.is_group_job IS TRUE\s+AND EXISTS \(SELECT 1 FROM public\.group_job_helpers g WHERE g\.job_id = j\.id AND g\.helper_id IS NOT NULL\)/);
    expect(body("get_helper_completed_counts")).toMatch(/OR \(j\.is_group_job IS TRUE AND EXISTS \(\s*SELECT 1 FROM public\.group_job_helpers g WHERE g\.job_id = j\.id AND g\.helper_id = u\.id\)\)/);
    expect(body("get_helper_parish_badges")).toMatch(/OR \(j\.is_group_job IS TRUE AND EXISTS \(\s*SELECT 1 FROM public\.group_job_helpers g WHERE g\.job_id = j\.id AND g\.helper_id = _user_id\)\)/);
    expect(body("get_public_profile_stats")).toMatch(/OR \(j\.is_group_job IS TRUE AND EXISTS \(\s*SELECT 1 FROM public\.group_job_helpers g WHERE g\.job_id = j\.id AND g\.helper_id = t\.user_id\)\)/);
    expect(dayof).toMatch(/g\.helper_dayof_confirmed_at IS NULL\s+AND \(g\.helper_confirmed_at IS NULL OR v_start - g\.helper_confirmed_at > INTERVAL '24 hours'\)/);
    expect(dayof.match(/UPDATE public\.jobs SET dayof_confirm_reminder_sent_at = NOW\(\)/g)?.length).toBe(2);
    expect(dayof.match(/UPDATE public\.jobs SET dayof_unanswered_poster_alert_sent_at = NOW\(\)/g)?.length).toBe(2);
    expect(body("sweep_no_show_alerts")).toMatch(/g\.helper_arrived_at IS NULL/);
    // Auto-start never starts a crew with an unconfirmed member.
    expect(body("auto_start_due_jobs")).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.group_job_helpers g\s+WHERE g\.job_id = j\.id AND g\.helper_id IS NOT NULL AND g\.helper_confirmed_at IS NULL\)/);
  });

  it("grants: get_helper_completed_counts is authenticated-only; the PGlite proof runs the effective definitions", () => {
    const sql = blankSqlComments(readFileSync(resolve(MIGRATIONS, THIS), "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.get_helper_completed_counts(uuid[]) FROM PUBLIC, anon;");
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.get_helper_completed_counts\(uuid\[\]\) TO [^;]*\banon\b/);
    const proof = resolve(root, "src/test/pglite/groupCrewReminders.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    const src = readFileSync(proof, "utf8");
    expect(src).toContain("effectiveDefs(DIR, { before: THIS })");
    for (const c of ["R1 nobody on the crew", "R4 a fully confirmed crew", "R5 M1's two completed crew jobs", "A7 auto-start", "A8 M1's two crew jobs count"]) {
      expect(src).toContain(c);
    }
  });
});
