/**
 * THE FIVE ACTIVITY BUCKETS, AND THE TWO WORDS EACH ONE WEARS.
 *
 * A LEAF MODULE ON PURPOSE. It imports nothing, so the browser checks can
 * import the same inventory the app renders instead of restating it — exactly
 * why `src/lib/searchFieldFloor.ts` exists. `activityFilters.ts` pulls in
 * React, the expiry clock and the activity row types, none of which a
 * Playwright spec can (or should) load; keeping the vocabulary here is what
 * lets `e2e/prod-audit/activity-tabs-visible.spec.ts` assert that the word
 * PAINTED at each width is the word the bucket definitions name, without
 * hand-typing either list.
 *
 * `activityFilters.ts` re-exports all four names, so every existing import
 * site is unchanged and there is still exactly one definition.
 */

/**
 * WHOSE MOVE IS IT — the five buckets both Activity tabs filter by.
 *
 * They replace Active / All / Completed / Cancelled, which sorted by the job's
 * own lifecycle rather than by anything the reader can act on. That is why a
 * job whose work was finished and was sitting on the poster's approval still
 * appeared under "Active" (owner: "if this is completed it doesn't belong in
 * the active section") — "active" is true of it, and useless. It is also why
 * the per-card status band had to exist at all: one bucket held open jobs,
 * offered jobs, in-progress jobs and jobs awaiting a decision, so every card
 * needed a label to say which. Sorting by whose move it is answers that in the
 * tab, which is what let the band come off.
 *
 * NEEDS YOU  — a decision is sitting with the reader RIGHT NOW. This is also
 *              where a PAST-DUE job lands, whatever its status — see
 *              `jobIsOverdue` in activityFilters.
 * WAITING    — the ball is in someone else's court; nothing to do but wait.
 * SCHEDULED  — agreed and UPCOMING, or underway today. Never a day that has
 *              already been and gone.
 * DONE       — finished successfully. Terminal.
 * CANCELLED  — cancelled, or (applied side) not selected. Terminal, but kept
 *              separate from DONE (product direction, 2026-08-30 — a
 *              cancelled job did not "finish", so folding it into the same
 *              tab as a completed one buried the distinction the reader
 *              actually cares about: did this job happen or not).
 *
 * Every job lands in exactly one, and the five are exhaustive — which is what
 * makes dropping the old catch-all "All" safe. There is no state that falls
 * through them.
 */
export type ActivityBucket = "needs_you" | "waiting" | "scheduled" | "done" | "cancelled";

/**
 * ORDER: Needs you · Waiting · Scheduled · Done · Cancelled (owner, 2026-09-19).
 *
 * It runs the job's own story: something is asked of you, then you are waiting
 * on somebody else, then it is agreed and upcoming, then it is over, then it
 * never happened. The two UNRESOLVED buckets sit together, then the settled
 * one, then the two terminal ones.
 *
 * Supersedes Needs you · Scheduled · Waiting · Done · Cancelled (owner,
 * 2026-08-30), which ranked by how much attention each deserved and put
 * Scheduled second because a commitment outranks a wait.
 *
 * WHY THE SWAP IS SAFE NOW, AND WAS NOT BEFORE: the objection to demoting
 * Scheduled was that it also held jobs happening TODAY and jobs already
 * underway — putting a job that starts in an hour below a bucket that by
 * definition needs nothing from you. `bucketFor` no longer files those under
 * Scheduled at all (see `jobIsLive`); Scheduled is now purely "agreed and still
 * ahead of you", which genuinely is the calmer of the two.
 */
export const BUCKET_ORDER: ActivityBucket[] = [
  "needs_you",
  "waiting",
  "scheduled",
  "done",
  "cancelled",
];

/**
 * The word each bucket wears. EXPORTED since 2026-09-19 because the collapsed
 * job card's status line uses it as its eyebrow — "whose move is it" is the
 * question both the tab and the card answer, and answering it twice in two
 * vocabularies is how "Needs you" on a tab ends up over "Waiting on them" on a
 * card inside it. See `src/components/activity/jobStatusLine.ts`.
 */
export const BUCKET_LABEL: Record<ActivityBucket, string> = {
  needs_you: "Needs You",
  waiting: "Waiting",
  scheduled: "Scheduled",
  done: "Done",
  cancelled: "Cancelled",
};

/**
 * THE SAME FIVE BUCKETS IN FEWER LETTERS, for phones narrower than 390pt.
 *
 * ── WHY THERE IS A SECOND VOCABULARY AT ALL ────────────────────────────────
 * Measured on prod 2026-09-19: the five tabs need 372px of content, and a 320
 * viewport gives the scroller 278px. The row scrolls, so nothing overflowed
 * the PAGE and every overflow guard in the repo passed — while "Done" was cut
 * to "Do" and "Cancelled" was not on the screen at all. Two of the five tabs
 * were invisible on the narrowest phones with no affordance saying so.
 *
 * Three layers fix it (owner, 2026-09-19, asked for all three): tighter type
 * and gap first, these words second, the scroller's edge fade third. This is
 * the layer that only the narrowest widths pay for — at 390 and up the tighter
 * type alone fits, and the owner's own five words stay on screen.
 *
 * ── AND THEY ONLY STAY ON SCREEN IF THE BREAKPOINT COMPILES ────────────────
 * On 2026-09-20 they did not. `min-[390px]:inline` was in the source and
 * emitted no CSS rule at all, so these stand-ins were the words a 414 phone
 * showed too — see `shortVariantClass` in
 * src/test/activityTabLabelsFitAPhone.test.ts for the cause, and
 * e2e/prod-audit/activity-tabs-visible.spec.ts for the check that now reads
 * the painted word off the screen rather than the class name off the file.
 *
 * ── WHY THESE WORDS ────────────────────────────────────────────────────────
 * Each is the part of its own label that carries the meaning, so the two
 * vocabularies never contradict: "You" and "Cancel" are literally inside
 * "Needs You" and "Cancelled". "Soon" is not inside "Scheduled" and is the one
 * real substitution — "Sched" and "Sch." are abbreviations, and an abbreviated
 * word in a 11px tab reads as a rendering fault rather than a name.
 * "Waiting" and "Done" are already short enough that shortening them would
 * only cost clarity.
 *
 * Nothing here is allowed to drift from BUCKET_LABEL: the key set is the same
 * `ActivityBucket` union, so a new bucket cannot be added without the compiler
 * asking for its short word too.
 */
export const BUCKET_SHORT_LABEL: Record<ActivityBucket, string> = {
  needs_you: "You",
  waiting: "Waiting",
  scheduled: "Soon",
  done: "Done",
  cancelled: "Cancel",
};
