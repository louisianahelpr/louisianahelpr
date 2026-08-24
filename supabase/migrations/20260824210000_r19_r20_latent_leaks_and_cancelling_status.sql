-- R19 + R20 from the 2026-08-23 Fable lead audit — the latent items (0 rows
-- affected today, fire on first use). Every claim below was re-verified against
-- the LIVE database (pg_policies / pg_proc ACLs / cron.job / pg_constraint)
-- before this migration was written; nothing here is from the report alone.
--
-- R19a  evacuation_pets: "Evacuation pets public read" was USING(true) for
--       {public} — anon could read every row including destination_address,
--       exactly when it matters (a hurricane). No client reads the table
--       directly (only the get_job_pets SECURITY DEFINER RPC, which scopes to
--       job participants), so the read policy narrows to owner/helper/admin.
--
-- R19b  reviews: "Authenticated users can view reviews" was USING(true),
--       defeating both the moderation `status` column and the double-blind
--       feedback_visible_at hold that every client query already respects
--       (PublicReviewWall filters it client-side; RLS now enforces it).
--       Reviewers keep sight of their own rows; admins keep their existing
--       "Admins can view all reviews" policy.
--
-- R19c  15 cron/sweep/cleanup SECURITY DEFINERs were executable by any
--       signed-in user via PUBLIC EXECUTE (cleanup_stripe_webhook_events
--       destroys the webhook idempotency ledger; sweep_daily_job_digest
--       re-fires the daily digest at will). All 15 verified against cron.job
--       and a caller grep: 12 run via pg_cron SQL (as postgres — unaffected
--       by these revokes), expire_pending_direct_offers runs from the
--       auto-expire-jobs edge function (service_role — granted explicitly),
--       fan_out_broadcast_to_notifications is called only by the sweep, and
--       the two cleanup_* have no caller at all yet.
--
-- R19d  get_pending_invite_for_email answered for ANY email — an email-
--       existence oracle plus a business-name leak. Its one caller
--       (Signup.tsx, post-auth, own email) keeps working: the function now
--       returns rows only when the asked-for email matches the caller's JWT.
--
-- R20   create-payment's cancel_escrow branch claims jobs with
--       payment_status='cancelling' (a deliberate two-phase claim so a
--       crashed run stays re-claimable), but jobs_payment_status_check never
--       learned the value — the write fails 100% the moment the path is
--       wired. The constraint gains 'cancelling'.
--
-- Verified NON-findings from the same audit line, recorded so nobody "fixes"
-- them later:
-- * is_licensed / is_insured stay client-writable BY DESIGN. They are the
--   user's own self-declaration inputs (CredentialsTab); the Licensed/Insured
--   badge additionally requires license_status/insurance_status = 'verified'
--   (CredentialBadge.tsx), and those columns ARE pinned by
--   prevent_self_escalation. Pinning the booleans would break the form.
-- * job-photos stays a public bucket — photos attach to publicly-browsable
--   listings and every stored URL is a public URL; flipping the bucket
--   private breaks them all. Decision recorded in the audit doc.

-- ── R19a — evacuation_pets read scope ───────────────────────────────────────
DROP POLICY IF EXISTS "Evacuation pets public read" ON public.evacuation_pets;
DROP POLICY IF EXISTS "Evacuation participants read" ON public.evacuation_pets;
CREATE POLICY "Evacuation participants read" ON public.evacuation_pets
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = owner_id
    OR (SELECT auth.uid()) = helper_id
    OR has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- ── R19b — reviews visibility follows moderation + the double-blind hold ────
DROP POLICY IF EXISTS "Authenticated users can view reviews" ON public.reviews;
DROP POLICY IF EXISTS "Published reviews visible after reveal" ON public.reviews;
CREATE POLICY "Published reviews visible after reveal" ON public.reviews
  FOR SELECT TO authenticated
  USING (
    reviewer_id = (SELECT auth.uid())
    OR (
      status = 'published'
      AND feedback_visible_at IS NOT NULL
      AND feedback_visible_at <= now()
    )
  );

-- ── R19c — cron/sweep/cleanup definers stop being user-callable ─────────────
-- Same PUBLIC-EXECUTE blind spot as 20260823220000: revoking a role's direct
-- grant does nothing while PUBLIC still holds EXECUTE, so revoke PUBLIC too.
-- pg_cron invokes these as postgres (owner) and keeps working; the edge-
-- function caller gets an explicit service_role grant.
DO $$
DECLARE
  fn text;
  sigs text[] := ARRAY[
    'public.extend_boosts_with_no_applications()',
    'public.sweep_pending_broadcast_fan_outs()',
    'public.sweep_job_start_reminders()',
    'public.sweep_no_show_alerts()',
    'public.sweep_expired_auto_bans()',
    'public.sweep_daily_job_digest()',
    'public.sweep_old_notifications()',
    'public.sweep_old_error_logs()',
    'public.sweep_old_email_send_log()',
    'public.detect_suspicious_user_patterns()',
    'public.detect_stuck_payments()',
    'public.cleanup_stripe_webhook_events()',
    'public.cleanup_observability_tables()',
    'public.expire_pending_direct_offers()',
    'public.fan_out_broadcast_to_notifications(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY sigs LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;

-- ── R19d — the invite lookup answers only for the caller's own email ────────
CREATE OR REPLACE FUNCTION public.get_pending_invite_for_email(_email text)
RETURNS TABLE(invite_id uuid, business_id uuid, business_name text, invited_by_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT bm.id, bm.business_id, b.name, p.full_name
  FROM public.business_members bm
  JOIN public.businesses b ON b.id = bm.business_id
  LEFT JOIN public.profiles p ON p.user_id = bm.invited_by
  WHERE lower(bm.invited_email) = lower(_email)
    -- The oracle fix: no JWT email, or someone else's email → zero rows.
    AND lower(_email) = lower(coalesce((SELECT auth.jwt() ->> 'email'), ''))
    AND bm.status = 'pending'
  ORDER BY bm.invited_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_pending_invite_for_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_invite_for_email(text) TO authenticated, service_role;

-- ── R20 — payment_status learns the claim state cancel_escrow writes ────────
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_payment_status_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'unpaid'::text, 'escrow'::text, 'payout_pending'::text, 'released'::text,
    'refunded'::text, 'cancelled'::text, 'abandoned'::text, 'failed'::text,
    'chargeback'::text, 'cancelling'::text
  ]));
