-- `open_jobs_browse` was silently missing the one column that makes its own
-- gate render, and unmasking an address on a stale condition.
--
-- 1. CREDENTIAL_TIER. A poster can restrict a job to helpers who hold a
-- verified license and/or insurance (CredentialTierSelector), and the server
-- genuinely enforces it — `trg_application_credential_gate` raises
-- `credential_tier_required` on an INSERT into `applications` that doesn't
-- clear the bar. But `credential_tier` was never projected by this view (nor
-- by get_ranked_open_jobs, get_public_open_jobs or get_open_jobs_for_map, all
-- of which are out of scope here), so `JobDetailFooter.tsx`'s
-- `(job.credential_tier ?? 0) > 0` — the client-side lock icon and "Get
-- Verified to Apply" copy — could never fire on the dashboard feed. A
-- restricted job read as an ordinary one, a helper applied normally, and the
-- only signal they ever got was the mapped-but-uninformative
-- `credential_tier_required` toast added separately. Column added last so
-- every existing SELECT list (positional or *) keeps working.
--
-- 2. PARISH. Present on get_ranked_open_jobs and get_open_jobs_for_map but
-- missing here, which is why the parish-based drive-time readout and the
-- dashboard's parish tie-break in ranking silently no-op on /dashboard while
-- working on /jobs — three surfaces reading the "same" data with different
-- shapes. Added for parity.
--
-- 3. THE DIRECT-OFFER ADDRESS LEAK. The CASE that unmasks `location` fires
-- for ANY row where `offered_to_helper_id = auth.uid()` — it never checked
-- `direct_offer_status`. Neither `respond_to_direct_offer` (declined) nor
-- `expire_pending_direct_offers` (expired) clears `offered_to_helper_id` —
-- deliberately, so the poster's own card can still say who declined or that
-- the offer lapsed. That's a reasonable reason to KEEP the column populated;
-- it is not a reason to keep UNMASKING off of it. The row-visibility
-- predicate below already gets this right (its declined/expired arm exists
-- specifically to let the job fall back into the open pool once an offer
-- resolves) — the unmask CASE just never matched it. Fixed by requiring
-- `direct_offer_status = 'pending'` in the same condition that grants
-- visibility, so a helper who declined or was timed out keeps seeing the
-- listing (correct — they may want to reconsider) but goes back to seeing
-- the masked address like every other browsing helper, not the literal one.
--
-- Everything else below is copied verbatim from the live definition
-- (20260903031231_browse_radius_coords_and_early_access_gate.sql) — no other
-- column, predicate, or ordering changed.

CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false) AS
  SELECT
    id,
    title,
    description,
    category,
    budget,
    date_needed,
    CASE
      WHEN offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending' THEN location
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
    (
      SELECT count(*)::integer
      FROM applications a
      WHERE a.job_id = jobs.id
    ) AS applicant_count,
    pricing_mode,
    round(latitude, 2) AS latitude,
    round(longitude, 2) AS longitude,
    parish,
    credential_tier
  FROM jobs
  WHERE status = 'open'::job_status
    AND customer_id IS NOT NULL
    AND payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND (
      offered_to_helper_id IS NULL
      OR direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
      OR offered_to_helper_id = auth.uid()
    )
    AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid())
    AND (NOT is_seed OR NOT seed_jobs_hidden_publicly());
