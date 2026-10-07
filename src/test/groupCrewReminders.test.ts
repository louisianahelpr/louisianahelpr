import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * THE CLASS: a cron or a count that finds "the booked Helpr" through
 * jobs.helper_id and never reads the roster.
 *
 * A crew has no lead (Q407, 20260925154606): jobs.helper_id is NULL on every
 * group job, so `j.helper_id IS NOT NULL` skips every crew and
 * `j.helper_id = <user>` never counts a crew member's job. Before
 * 20260927012241 (docs/OPEN.md Q728) that meant no day-of, start or no-show
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

// @mutate supabase/migrations/20260927012241_group_crew_reminders_and_counts.sql |       AND j.is_group_job IS TRUE\n      AND j.status IN ('open', 'accepted')\n      AND j.date_needed IS NOT NULL\n      AND EXISTS | AND false\n      AND j.status IN ('open', 'accepted')\n      AND j.date_needed IS NOT NULL\n      AND EXISTS
// @mutate supabase/migrations/20260927012241_group_crew_reminders_and_counts.sql |          OR (j.is_group_job IS TRUE\n             AND EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)\n             AND NOT EXISTS |          OR (false\n             AND EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)\n             AND NOT EXISTS
// @mutate supabase/migrations/20260927012241_group_crew_reminders_and_counts.sql |                               WHERE g.job_id = j.id AND g.helper_id IS NOT NULL AND g.helper_confirmed_at IS NULL)) |                               WHERE false))
// @mutate supabase/migrations/20260927012241_group_crew_reminders_and_counts.sql |   JOIN public.jobs j\n    ON j.status = 'completed'\n   AND (j.helper_id = u.id\n        OR (j.is_group_job IS TRUE AND EXISTS ( |   JOIN public.jobs j\n    ON j.status = 'completed'\n   AND (j.helper_id = u.id\n        OR (false AND EXISTS (
// @mutate supabase/migrations/20260927012241_group_crew_reminders_and_counts.sql | REVOKE ALL ON FUNCTION public.get_helper_completed_counts(uuid[]) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.get_helper_completed_counts(uuid[]) FROM PUBLIC;
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |     JOIN public.jobs j ON j.id = g.job_id AND j.is_group_job IS TRUE AND j.status = 'completed'\n  ),\n  -- Timing | WHERE false\n  ),\n  -- Timing
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |     FROM worked w\n    WHERE w.customer_id IS NOT NULL | FROM target t JOIN public.jobs j ON j.helper_id = t.user_id CROSS JOIN LATERAL (SELECT t.user_id, j.customer_id) w\n    WHERE w.customer_id IS NOT NULL
// @mutate supabase/migrations/20261005171601_crew_counts_exports_and_ban_alert.sql |       WHERE p.job_id = j.id AND p.helper_id = g.helper_id AND p.status = 'paid' |       WHERE false
// @mutate supabase/migrations/20261005171601_crew_counts_exports_and_ban_alert.sql |            OR (j.is_group_job IS TRUE AND EXISTS (\n                 SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = p_helper_id))) |            OR (false AND EXISTS (\n                 SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = p_helper_id)))
// @mutate supabase/migrations/20261005171601_crew_counts_exports_and_ban_alert.sql |       OR (j.is_group_job IS TRUE AND EXISTS (\n            SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = p.user_id)) |       OR (false AND EXISTS (\n            SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = p.user_id))
// @mutate supabase/migrations/20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql |         OR (j.is_group_job IS TRUE\n            AND j.status::text IN ('completed', 'cancelled') |         OR (false\n            AND j.status::text IN ('completed', 'cancelled')

// @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql |          OR (j.customer_id = p_blocked AND g.helper_id = v_user) |          OR false
// @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql |     DELETE FROM public.group_job_helpers WHERE id = v_crew.slot_id; |     PERFORM 1;
// @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql |           p_violation_type            => 'cancel_with_helper',\n          p_description               => 'Removed |           p_violation_type            => 'x',\n          p_description               => 'Removed
// @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql |       ELSIF v_member_fee > 0 THEN |       ELSIF false THEN
// @mutate supabase/migrations/20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql |        AND g.response_deadline < now()\n  LOOP |        AND false\n  LOOP
// @mutate supabase/migrations/20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql |       DELETE FROM public.group_job_helpers WHERE id = v_slot.slot_id; |       PERFORM 1;
// @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql |      SET response_deadline = v_crew_deadline |      SET response_deadline = NULL
// @mutate supabase/migrations/20261005172453_crew_block_and_unanswered_spot.sql |     'proof_after_urls',\n    'response_deadline'\n  ]; |     'proof_after_urls'\n  ];
// @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql | v_crew_deadline := LEAST(GREATEST(LEAST(COALESCE(p_deadline, now() + interval '48 hours'), now() + interval '48 hours'), now() + interval '55 minutes'), v_cutoff); | v_crew_deadline := p_deadline;
// @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql |        WHERE r.role = 'admin'\n         AND v_new_block; |        WHERE r.role = 'admin';
// @mutate supabase/migrations/20261005172453_crew_block_and_unanswered_spot.sql |   IF v_row.helper_confirmed_at IS NULL THEN\n    RAISE EXCEPTION 'helper_not_confirmed' USING ERRCODE = '23514',\n      HINT = 'Confirm the job before marking arrival.'; |   IF false THEN\n    RAISE EXCEPTION 'helper_not_confirmed' USING ERRCODE = '23514',\n      HINT = 'Confirm the job before marking arrival.';
// @mutate supabase/functions/auto-expire-jobs/index.ts |       .not("is_group_job", "is", true)\n      .lte("date_needed", tomorrow) |       .lte("date_needed", tomorrow)
const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");
const THIS = "20260927012241_group_crew_reminders_and_counts.sql";
/** Q731 + Q729 (2026-10-05): the last helper_id-only readers a crew needs. */
const CREW_COUNTS = "20261005171601_crew_counts_exports_and_ban_alert.sql";
const Q1324_FOLLOW_UP = "20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql";
/** Q729 + Q1282 (2026-10-05): a block, and an unanswered spot, reach a crew member. */
const CREW_BLOCK = "20261005172453_crew_block_and_unanswered_spot.sql";
const EFFECTIVE = effectiveDefs(MIGRATIONS);
const body = (name: string) => blankSqlComments(EFFECTIVE.get(name)?.stmt ?? "");

/** Booked-job selection or a per-Helpr count through jobs.helper_id. */
const SINGLE_HELPER_SELECT =
  /\bj\.helper_id IS NOT NULL\b|\bj\.helper_id\s*=\s*(?:_user_id|p_user_id|t\.user_id|p\.user_id|ANY\s*\(\s*p_user_ids\s*\)|_helper_id|p_helper_id|u\.id|u\.user_id)\b/i;

const NOT_FOR_A_CREW: Record<string, string> = {
  get_payout_batch_job_ids: "admin single-helper release batches (release-payout refuses a crew); a crew is paid only by process-scheduled-payouts' fan-out",
  get_payout_batches: "admin single-helper release batches (release-payout refuses a crew); a crew is paid only by process-scheduled-payouts' fan-out",
};

describe("a crew gets its reminders, auto-start and counts (Q728)", () => {
  it("every function that finds the booked Helpr through jobs.helper_id either reads the roster or is classified", () => {
    const found = [...EFFECTIVE.entries()]
      .filter(([, d]) => {
        const b = blankSqlComments(d.stmt);
        return SINGLE_HELPER_SELECT.test(b) && !/group_job_helpers/i.test(b);
      })
      .map(([n]) => n)
      .sort();
    expect(found.length).toBeGreaterThan(1);
    expect(found, "an unclassified helper_id-only cron or count: give a crew its roster version, or classify it").toEqual(
      Object.keys(NOT_FOR_A_CREW).sort(),
    );
    // Inventory floor for the fixed side: these read the roster now.
    const fixed = [
      "sweep_dayof_confirm_reminders", "sweep_job_start_reminders", "sweep_no_show_alerts", "auto_start_due_jobs",
      "get_helper_completed_counts", "get_public_profile_stats",
    ];
    for (const fn of fixed) {
      const b = body(fn);
      expect(b, `${fn} is gone`).not.toHaveLength(0);
      expect(b, `${fn} no longer reads the roster`).toMatch(/group_job_helpers/);
      // 20261007033530 (Q552) restates get_public_profile_stats with its seed clauses only.
      const want = fn === "get_public_profile_stats" ? [CREW_COUNTS, "20261007033530_seed_switch_hides_test_profiles.sql"] : [THIS];
      expect(want, `${fn} is not the Q728 (or Q731/Q552) definition`).toContain(EFFECTIVE.get(fn)?.file);
    }
    for (const fn of ["get_helper_earnings_export", "get_helper_tiers", "get_neighbor_hire_count", "settle_one_off_jobs_for_banned_account"]) {
      expect(body(fn), `${fn} no longer reads the roster`).toMatch(/group_job_helpers/);
      // settle_one_off_jobs_for_banned_account is restated by Q1324's follow-up
      // (the confirm's as-of price), body otherwise the Q731 one.
      expect(EFFECTIVE.get(fn)?.file, `${fn} is not the Q731/Q729 definition`).toBe(
        fn === "settle_one_off_jobs_for_banned_account" ? Q1324_FOLLOW_UP
          // Q1379 restates the export (one definition of net); it still reads the roster.
          : fn === "get_helper_earnings_export" ? "20261007145338_earnings_export_one_net.sql"
          : CREW_COUNTS,
      );
    }
  });

  it("Q731/Q729: the profile timing and repeat figures, the export, tiers, neighbours and a ban all reach a crew member", () => {
    const stats = body("get_public_profile_stats");
    // One `worked` set, single jobs UNION the member's crew jobs with their own
    // roster arrival; timing and repeat-client both read only it.
    expect(stats).toMatch(/worked AS \([\s\S]*JOIN public\.jobs j ON j\.helper_id = t\.user_id AND j\.status = 'completed'\s+UNION ALL[\s\S]*g\.helper_arrived_at[\s\S]*JOIN public\.group_job_helpers g ON g\.helper_id = t\.user_id\s+JOIN public\.jobs j ON j\.id = g\.job_id AND j\.is_group_job IS TRUE AND j\.status = 'completed'/);
    const timing = stats.slice(stats.indexOf("timing AS ("), stats.indexOf("timing_agg AS ("));
    const repeat = stats.slice(stats.indexOf("repeat_clients AS ("), stats.indexOf("repeat_agg AS ("));
    for (const [name, cte] of [["timing", timing], ["repeat_clients", repeat]] as const) {
      expect(cte, `${name} reads jobs.helper_id again, so crews drop out`).toMatch(/FROM worked w/);
      expect(cte, `${name} reads jobs.helper_id again, so crews drop out`).not.toMatch(/helper_id/);
    }
    expect(body("get_neighbor_hire_count")).toMatch(/OR \(j\.is_group_job IS TRUE AND EXISTS \(\s*SELECT 1 FROM public\.group_job_helpers g WHERE g\.job_id = j\.id AND g\.helper_id = p_helper_id\)\)/);
    expect(body("get_helper_tiers")).toMatch(/LEFT JOIN public\.jobs j\s+ON j\.helper_id = p\.user_id\s+OR \(j\.is_group_job IS TRUE AND EXISTS \(\s*SELECT 1 FROM public\.group_job_helpers g WHERE g\.job_id = j\.id AND g\.helper_id = p\.user_id\)\)/);
    expect(body("get_helper_tiers")).toMatch(/OR EXISTS \(SELECT 1 FROM public\.group_job_helpers gg WHERE gg\.helper_id = p\.user_id\)/);
    expect(body("get_helper_earnings_export")).toMatch(/WHERE p\.job_id = j\.id AND p\.helper_id = g\.helper_id AND p\.status = 'paid'[\s\S]*WHERE g\.helper_id = _helper_id/);
    expect(body("settle_one_off_jobs_for_banned_account")).toMatch(/OR \(j\.is_group_job IS TRUE\s+AND j\.status::text IN \('completed', 'cancelled'\)\s+AND j\.payment_status IN \('escrow', 'payout_pending'\)\s+AND EXISTS \(SELECT 1 FROM public\.group_job_helpers g\s+WHERE g\.job_id = j\.id AND g\.helper_id = p_user\)/);
    const proof = readFileSync(resolve(root, "src/test/pglite/crewCountsAndBanAlert.pglite.mjs"), "utf8");
    expect(proof).toContain("effectiveDefs(DIR, { before: THIS })");
    for (const c of ["C1 a crew member's on-time", "C2 a crew member's paid shares", "C3 a crew-only Helpr", "C4 'hired by N neighbours'", "C5 a crew member banned", "RED as expected"]) {
      expect(proof).toContain(c);
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

  it("Q729/Q1282: a block takes only that member off the crew, and an unanswered spot expires", () => {
    expect(EFFECTIVE.get("enforce_group_member_lifecycle_server_owned")?.file).toBe(CREW_BLOCK);
    // 20261005184940 restated expire_unanswered_offers and accept_group_application
    // from the Q729 bodies (the offer cap), and 20261006015121 (Q1378, the rest
    // of a crew carry on) restates both with block_user_and_settle; the crew
    // rules below must survive every restatement.
    // 20261007073145 (Q1390, the crew block fee ledger) restates both once
    // more; the crew rules below must survive it too.
    for (const fn of ["block_user_and_settle", "accept_group_application"]) {
      expect(EFFECTIVE.get(fn)?.file, `${fn} is not the newest crew-aware definition`).toBe("20261007073145_crew_block_fee_ledger.sql");
    }
    // 20261006022526 (the money review of Q1378) restates the sweep once more:
    // its crew pass also covers a started crew.
    expect(EFFECTIVE.get("expire_unanswered_offers")?.file).toBe("20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql");
    const block = body("block_user_and_settle");
    expect(block).toMatch(/WHERE j\.is_group_job IS TRUE[\s\S]*\(j\.customer_id = v_user\s+AND g\.helper_id = p_blocked\)\s+OR \(j\.customer_id = p_blocked AND g\.helper_id = v_user\)/);
    expect(block).toMatch(/DELETE FROM public\.group_job_helpers WHERE id = v_crew\.slot_id;/);
    // The poster's strike and the by-hand fee alert (since Q1390 only for a
    // slotless legacy row; src/test/crewBlockFeeLedger.test.ts pins the
    // ledger); the member's strike mirrors helper_cancel_booking.
    expect(block).toMatch(/v_committed := public\.crew_fee_pays_unconfirmed\(\) OR v_crew\.member_confirmed_at IS NOT NULL;/);
    expect(block).toMatch(/p_violation_type\s+=> 'cancel_with_helper'/);
    expect(block).toMatch(/IF v_member_fee > 0 THEN[\s\S]{0,600}'Crew block: fee owed by hand'/);
    expect(block).toMatch(/v_crew\.member_confirmed_at IS NOT NULL\s+AND public\.is_late_cancellation\(true,[\s\S]*apply_job_denial_consequence\(\s*v_user, v_crew\.id/);
    const expire = body("expire_unanswered_offers");
    expect(expire).toMatch(/AND g\.helper_confirmed_at IS NULL\s+AND g\.response_deadline IS NOT NULL\s+AND g\.response_deadline < now\(\)\s+LOOP/);
    expect(expire).toMatch(/DELETE FROM public\.group_job_helpers WHERE id = v_slot\.slot_id;/);
    expect(body("accept_group_application")).toMatch(/SET response_deadline = v_crew_deadline\s+WHERE job_id = v_job_id AND slot_no = v_slot;/);
    expect(body("accept_group_application")).toMatch(/v_crew_deadline := LEAST\(GREATEST\(LEAST\(COALESCE\(p_deadline, now\(\) \+ interval '48 hours'\), now\(\) \+ interval '48 hours'\), now\(\) \+ interval '55 minutes'\), v_cutoff\);/);
    // Review fixes (lh-authz-rls 2026-10-05): no backdated deadline, no admin flood, no unconfirmed arrival.
    expect(body("accept_group_application")).toMatch(/now\(\) \+ interval '48 hours'\), now\(\) \+ interval '55 minutes'\)/);
    expect(block).toMatch(/WHERE r\.role = 'admin'\s+AND v_new_block;/);
    expect(block).toMatch(/GET DIAGNOSTICS v_updated = ROW_COUNT;\s+v_new_block := v_updated > 0;/);
    expect(EFFECTIVE.get("rpc_group_member_mark_arrival")?.file).toBe(CREW_BLOCK);
    expect(body("rpc_group_member_mark_arrival")).toMatch(/IF v_row\.helper_confirmed_at IS NULL THEN\s+RAISE EXCEPTION 'helper_not_confirmed'/);
    expect(body("enforce_group_member_lifecycle_server_owned")).toMatch(/'response_deadline'\s+\];[\s\S]*NEW\.response_deadline\s+:= NULL;/);
    const proof = readFileSync(resolve(root, "src/test/pglite/crewBlockAndUnansweredSpot.pglite.mjs"), "utf8");
    expect(proof).toContain("effectiveDefs(DIR, { before: THIS })");
    for (const c of ["B1 poster blocks a confirmed member", "B2 the member blocks the poster", "B3 a crew past its start", "E1 a crew hire keeps", "E2 an unconfirmed member", "L1 the poster cannot move", "E1b a backdated reply deadline", "RED as expected"]) {
      expect(proof).toContain(c);
    }
  });

  it("auto-expire-jobs never reopens a crew for a job-level confirmation it can never have (Q780 review)", () => {
    const src = blankComments(readFileSync(resolve(root, "supabase/functions/auto-expire-jobs/index.ts"), "utf8"));
    const i = src.indexOf("const { data: acceptedCandidates");
    expect(i).toBeGreaterThan(-1);
    const query = src.slice(i, src.indexOf(";", i));
    expect(query).toMatch(/\.is\("helper_confirmed_at", null\)/);
    expect(query, "the stale-acceptance sweep selects crews again").toMatch(/\.not\("is_group_job", "is", true\)/);
  });
});
