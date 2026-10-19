/**
 * The accessible names the messy-input applicant sweeps (edit-job, cancel-job,
 * applicants-note, decline-applicant) press on the poster's open-job card.
 *
 * Kept here, free of Playwright imports, so src/test/messyInputApplicantNames.test.ts
 * can check every one against the names the app actually renders. They went
 * stale twice without anyone noticing until prod-audit timed out (run
 * 39102037116, 2026-10-18: all four sweeps failed at 22.3 s on
 * `getByRole('button', { name: /^edit job$/i })`):
 *  - 2026-10-08 (f9fa16060): every chip of the card's row moved under `More`
 *    (JobStepCard / JobActionRow `JobStepOverflowChip`), so "Edit job" is not
 *    on the card until More is pressed;
 *  - ApplicantsPanel's note button reads "Add a private note on <name>", which
 *    `/add private note/i` never matched.
 */

/** JobStepOverflowChip's trigger: "More — 4 more actions for this job". */
export const MORE_BUTTON = /^more\b/i;
/** The popover JobStepOverflowChip opens: "More actions for this job". */
export const MORE_PANEL = /^more actions for this job$/i;
/** OpenStep's Edit chip: "Edit job" (JobActionRow composeAccessibleName keeps an ariaLabel that already opens with its label). */
export const EDIT_JOB_CHIP = /\bedit job$/i;
/** OpenStep's Cancel chip: "Cancel job". */
export const CANCEL_JOB_CHIP = /\bcancel job$/i;
/** OpenStep's primary on an open job: "Applicants (1)". */
export const APPLICANTS_PRIMARY = /^applicants\b/i;
/** ApplicantsPanel's note icon: "Add a private note on <name>" (or "Edit your private note on <name>"). */
export const PRIVATE_NOTE_BUTTON = /^(add a|edit your) private note on /i;
/** ApplicantHireRow's decline (x): "Decline <name>". */
export const DECLINE_BUTTON = /^decline /i;
