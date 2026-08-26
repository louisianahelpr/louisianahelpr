/**
 * reliabilityLadder — the ONE statement of the shared reliability-strike
 * ladder the backend actually enforces (`apply_job_denial_consequence`,
 * migration 20260829010000, where it shares `apply_consequence_ladder` with the
 * message and cancellation ladders; also applied by `helper_cancel_booking`):
 *
 *   strike 1  — recorded, courtesy warning only
 *   strike 2  — FINAL WARNING (ban_status 'final_warning', RPC action "warning")
 *   strike 3  — 7-DAY SUSPENSION (temp_banned + auto_suspended_until,
 *               RPC action "temp_ban")
 *   strike 4+ — 7-DAY RESTRICTION + HUMAN BAN REVIEW (RPC action
 *               "pending_ban_review"; an admin confirms or dismisses in
 *               /admin?view=banreview — a permanent ban is never automatic)
 *
 * Every surface that DESCRIBES the ladder reads these strings. Two surfaces
 * (the decline confirm and the poster's denial-policy bullets) were still
 * describing the retired 5-strike ladder after the RPC moved on — copy that
 * quotes a consequence must not be able to drift from the code that applies it.
 */

/** Bullet-list rungs, e.g. for the poster-facing "Denial policy" dialog. */
export const RELIABILITY_LADDER_RUNGS = [
  "1st — recorded, no penalty",
  "2nd — final warning",
  "3rd — 7-day suspension",
  "4th — 7-day restriction, admin reviews for a permanent ban",
] as const;

/**
 * One-sentence version for confirm callouts. Callers prepend what earns the
 * strike ("Declining after accepting counts as a reliability strike — …").
 */
export const RELIABILITY_LADDER_SENTENCE =
  "a second is a final warning, a third suspends your account for 7 days, and a fourth restricts it for 7 days while an admin decides on a permanent ban";
