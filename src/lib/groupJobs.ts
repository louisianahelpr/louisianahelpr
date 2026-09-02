/**
 * Group jobs are WITHDRAWN as of 2026-09-01. This is a withdrawal, not a
 * "coming soon" — the control shipped, and everything behind it was built for
 * exactly one helper.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * `accept_group_application` (20260804122000) fills `group_job_helpers` and
 * sets `jobs.helper_id` to the FIRST accepted helper, "so existing
 * payout/notification paths keep resolving". Only eleven places in the
 * repository know the roster table exists (`docs/audit/COVERAGE_2026-08-31.md`
 * §4.1); the entire rest of the job lifecycle reads `jobs.helper_id` as "the
 * helper". So the second and subsequent members of a crew hit all five of
 * these, none of them cosmetic:
 *
 *   (a) They cannot message the poster. `can_message_in_job` matched only
 *       `customer_id` / `offered_to_helper_id` / `helper_id`, and `messages`
 *       INSERT is gated on it. They hold the customer's street address —
 *       `user_may_see_job_address` IS roster-aware — with no channel to the
 *       person whose house it is.  → FIXED, 20260902xxxxxx.
 *   (b) They cannot confirm, mark on-the-way, mark arrival, or mark complete.
 *       The `jobs` UPDATE policy is `USING (auth.uid() = helper_id)`
 *       (20260312010219); `mark_helper_arrival` and `helper_mark_on_the_way`
 *       raise `not_the_assigned_helper`; create-payment's `action:"release"`
 *       authorizes on `job.helper_id === user.id`.  → NOT FIXED.
 *   (c) The job vanishes from their Activity the moment the roster fills —
 *       `get_jobs_for_my_applications` required `customer_id = me OR
 *       helper_id = me OR status = 'open'`, and the last accept flips the
 *       status.  → FIXED, 20260902xxxxxx.
 *   (d) Neither direction can leave a review. `reviews` carries
 *       UNIQUE (job_id, reviewer_id), so a poster gets exactly ONE review per
 *       job however many people worked it, and `enforce_review_validity`
 *       (20260504154800) + the INSERT policy both read the scalar
 *       `jobs.helper_id`.  → NOT FIXED.
 *   (e) `admin_release_dispute` paid `jobs.helper_id` a 1/N share and flipped
 *       the job to `completed` / `released`, stranding every other roster
 *       member's share on the platform balance with no retry.  → FIXED
 *       (refuses now, moves no money).
 *
 * ── WHY (b) AND (d) ARE NOT PATCHES ─────────────────────────────────────────
 *
 * (b) is blocked on the DATA MODEL, not on a policy. `jobs` carries scalar
 * `helper_confirmed_at` / `helper_on_the_way_at` / `helper_arrived_at` /
 * `helper_arrival_verified_at` / `helper_completed_at`. The schema cannot
 * represent N arrivals or N completions, so there is no answer to "does this
 * job complete when ALL helpers mark complete, or the first?" that the current
 * columns can even store.
 *
 * And widening the UPDATE policy to the roster WITHOUT that model is worse than
 * the lockout. `enforce_helper_completion_gates` and
 * `enforce_helper_jobs_column_whitelist` (both 20260828011057) early-return on
 * `auth.uid() IS DISTINCT FROM OLD.helper_id`, so helpers 2..N would be able to
 * mark the job complete with no verified arrival, no proof photos and no
 * 30-minute work floor — and write arbitrary `jobs` columns on the way past.
 * That trades a lockout for an escrow hole.
 *
 * (d) needs UNIQUE (job_id, reviewer_id) to become
 * UNIQUE (job_id, reviewer_id, reviewee_id), which changes the inputs to the
 * trust ladder, the tier calculation, the double-blind reveal
 * (20260506192638) and the review-nag cron. Not something to slip in behind a
 * segmented control.
 *
 * ── WHY WITHDRAW RATHER THAN LEAVE IT ───────────────────────────────────────
 *
 * Prod has never held a real group job: 2 rows, both `is_seed = true`, and
 * `group_job_helpers` has had zero rows for its entire history (verified
 * read-only 2026-09-01). The control was live in the post-job form, so the
 * first poster to tap it would have hit all five. Shipping a control that
 * produces five breakages is worse than not shipping it, and withdrawing it
 * before anyone is hurt is cheaper than withdrawing it after.
 *
 * ── TURNING IT BACK ON ──────────────────────────────────────────────────────
 *
 * `src/pages/postjob/groupJobsGate.test.ts` links this flag to the schema
 * change that unblocks (b): flipping it to `true` without per-member lifecycle
 * columns on `group_job_helpers` fails that test. (d) has no such tripwire —
 * it needs a deliberate decision about the review model.
 */
export const GROUP_JOBS_ENABLED = false;
