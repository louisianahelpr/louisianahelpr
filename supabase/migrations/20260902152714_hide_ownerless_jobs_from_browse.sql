-- Hide ownerless jobs from the browse feed.
--
-- WHY
-- `20260901033011_account_deletion_retention_policy` made account deletion
-- ANONYMISE rather than delete: `jobs.customer_id` becomes NULL and the job
-- survives as a financial record. That migration deliberately preserves
-- `status` ("Title, budget, fees, dates, status and the Stripe ids stay"), so a
-- job that was `open` when its poster deleted their account STAYS `open` — and
-- therefore stays in this view and in the browse feed.
--
-- That job cannot be worked. The escrow may still be funded, but there is
-- nobody left to answer a question, approve the work, or release the money, so
-- an application to it could never be acted on. The same deletion also nulls
-- `location`, `latitude` and `longitude` and rewrites `description` to
-- '[removed at account deletion]', so it renders as an addressable-looking job
-- with a redacted body and no coordinates for distance sorting.
--
-- WHY IN THE VIEW rather than in the client
-- The browse feed AND the "N jobs" count both read `open_jobs_browse`
-- (`useDashboardData.ts` and `useDashboardJobsCount.ts`). A client-side filter
-- fixes the list and not the count, so the header would read "12 jobs" over a
-- list of 11. This view is already the single authority for browse visibility —
-- the early-access perk was deliberately moved into it for exactly that reason
-- (20260901022522) — so the ownership rule belongs here too, and the feed, the
-- recommended row, the map and the count all inherit it at once.
--
-- Discovery only. Nothing here hides the job from someone already attached to
-- it: the assigned helper still sees it in their activity, and admin still sees
-- it. Hiding an in-flight job from the person working it would strand them and
-- their payout.
--
-- REPLAY-SAFE: CREATE OR REPLACE VIEW is idempotent, and this migration is a
-- pure redefinition with no dependency on rows or on prior state.
--
-- `security_invoker = false` is RESTATED DELIBERATELY, not inherited. This view
-- runs as its owner so it can bypass the participant-scoped SELECT policies on
-- `public.jobs` — without that a browsing helper sees only jobs they posted
-- themselves. Losing this option would empty the feed for every user, so it is
-- written explicitly rather than left to CREATE OR REPLACE to carry forward.

CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false) AS
  SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() THEN location
            ELSE mask_job_location(location)
        END AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    special_requirements,
    status,
    created_at,
    updated_at,
    boosted_at,
    boost_expires_at,
    expires_at,
    recurrence_interval,
    recurrence_end_date,
    parent_job_id,
    payment_status,
    customer_id,
    offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    (( SELECT count(*) AS count
           FROM applications a
          WHERE a.job_id = jobs.id))::integer AS applicant_count,
    pricing_mode
   FROM jobs
  WHERE status = 'open'::job_status
    -- The only new predicate. Everything else below is the definition as it
    -- stood in prod, reproduced verbatim.
    AND customer_id IS NOT NULL
    AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]))
    AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid())
    AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid())
    AND (NOT is_seed OR NOT seed_jobs_hidden_publicly());

COMMENT ON VIEW public.open_jobs_browse IS
  'Curated browse feed: open, escrow-funded, non-seed jobs with the precise '
  'street address masked. Excludes jobs whose poster deleted their account '
  '(customer_id IS NULL) — those survive as financial records but cannot be '
  'worked, since nobody remains to approve the work or release the escrow. '
  'security_invoker=false is required: public.jobs SELECT policies are '
  'participant-scoped, so this view is the authority that lets a helper browse '
  'jobs they are not yet party to.';
