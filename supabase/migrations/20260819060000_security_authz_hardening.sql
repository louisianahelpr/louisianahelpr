-- Security hardening: four confirmed authorization holes.
--
-- Every claim below was verified against the LIVE database (pg_proc /
-- pg_policies / pg_trigger / information_schema) before this file was written,
-- not inferred from migration history.
--
-- The recurring root cause is one pattern: SECURITY DEFINER + EXECUTE granted
-- broadly + no auth.uid() check. That combination lets any caller act as the
-- function's owner with a caller-supplied identity.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. process_referral() — any user could bind ANY other user as their referee.
--
-- Verified live: prosecdef = true, granted to `authenticated`, and the body
-- contained ZERO references to auth.uid(). It inserted referrals(referrer_id,
-- referred_id) using the CLIENT-SUPPLIED p_new_user_id verbatim. Guards present
-- were only "code exists", "not self-referral", "not already referred" — none
-- of which check that the caller IS the person being referred.
--
-- Impact was real money: check_referral_bonus() mints referral_credits, which
-- cash-out-credits pays out over Stripe Connect. And because referrals
-- .referred_id is UNIQUE, claiming a victim also permanently locked out their
-- legitimate referrer.
--
-- Body is otherwise preserved exactly as deployed.
CREATE OR REPLACE FUNCTION public.process_referral(p_referral_code text, p_new_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code_record RECORD;
BEGIN
  -- THE FIX: the caller may only enrol THEMSELVES. Without this, p_new_user_id
  -- is an unauthenticated assertion — and every other uuid on the platform is
  -- readable from jobs.customer_id / get_safe_profiles.
  IF auth.uid() IS NULL OR auth.uid() <> p_new_user_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, user_id INTO v_code_record
  FROM public.referral_codes
  WHERE code = UPPER(p_referral_code);

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_code_record.user_id = p_new_user_id THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = p_new_user_id) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_id, referral_code_id)
  VALUES (v_code_record.user_id, p_new_user_id, v_code_record.id);

  RETURN TRUE;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. can_message_in_job() — its second branch never referenced the sender.
--
-- The messages INSERT policy is
--   auth.uid() = sender_id AND can_message_in_job(job_id, auth.uid())
-- so sender_id itself cannot be spoofed. But branch 2 read, verbatim:
--
--   OR EXISTS (SELECT 1 FROM messages m JOIN jobs j ON j.id = m.job_id
--              WHERE m.job_id = _job_id AND m.sender_id = j.customer_id)
--
-- — true for ANY caller as soon as the job's poster had ever sent one message
-- in that thread. That made it a platform-wide unsolicited-DM primitive: any
-- authenticated user could insert into any opened thread with receiver_id set
-- to any victim.
--
-- Intent was "the other party can reply once the poster opens the thread", so
-- the fix binds branch 2 to the sender being that thread's RECIPIENT rather
-- than widening or narrowing who may talk.
--
-- Reads were never affected — the SELECT policy is correctly scoped to
-- sender/receiver — so this was message injection, not eavesdropping.
CREATE OR REPLACE FUNCTION public.can_message_in_job(_job_id uuid, _sender uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = _job_id AND j.customer_id = _sender
    )
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.jobs j ON j.id = m.job_id
      WHERE m.job_id = _job_id
        AND m.sender_id = j.customer_id
        AND m.receiver_id = _sender   -- ← the poster messaged THIS sender
    );
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. instant_book_claim() was EXECUTE-able by `anon`.
--
-- Verified live: the ACL carried anon=X. The body does reference auth.uid(),
-- but for an anonymous PostgREST caller auth.uid() is NULL, which made the
-- own-job guard compare against NULL (never true) and set helper_id = NULL.
-- enforce_helper_jobs_column_whitelist also returns early on NULL uid — it
-- treats "uid IS NULL" as "trusted service role", which an anon request also
-- satisfies. Net effect: anyone holding the public publishable key could flip
-- every open instant-book job to 'accepted' with no helper attached.
--
-- No money moves on that path, but the board is bricked: jobs leave the public
-- feed and cannot be assigned. Revoking anon closes it at the door.
-- Guarded with to_regprocedure: a from-scratch rebuild replays migrations in
-- timestamp order, and an unguarded REVOKE against a function defined by a
-- LATER migration aborts the whole rebuild (and reds the Supabase Preview check
-- on every migration PR). CLAUDE.md calls this out explicitly.
DO $$
BEGIN
  IF to_regprocedure('public.instant_book_claim(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.instant_book_claim(uuid) FROM anon';
  END IF;
  IF to_regprocedure('public.can_message_in_job(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) FROM anon';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A message recipient could rewrite the sender's message.
--
-- Verified live: policy "Users can mark messages as read" is FOR UPDATE
-- USING (auth.uid() = receiver_id) with a NULL with_check, while `authenticated`
-- held column-level UPDATE on content, sender_id, receiver_id, flagged_hidden
-- and flag_reason. A recipient could therefore rewrite the message body, forge
-- sender_id, or clear flagged_hidden to un-hide a moderated message — undoing
-- the content scanner's only sanction on rows admins read as dispute evidence.
--
-- The policy's NAME states the whole intended capability: mark as read.
REVOKE UPDATE ON public.messages FROM authenticated;
REVOKE UPDATE ON public.messages FROM anon;
GRANT  UPDATE (read) ON public.messages TO authenticated;

DROP POLICY IF EXISTS "Users can mark messages as read" ON public.messages;
CREATE POLICY "Users can mark messages as read"
  ON public.messages
  FOR UPDATE
  USING (auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = receiver_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Duplicate moderation trigger double-flagged every violation.
--
-- Verified live: messages carried BOTH `messages_scan_content` (BEFORE INSERT)
-- and `scan_message_on_insert` (AFTER INSERT), both enabled, both executing
-- scan_message_content(). A later migration dropped two other trigger names but
-- not this one. Each flagged message therefore wrote TWO fraud_flags rows, and
-- the escalation branch trips at >= 2 — so a user's FIRST offence produced a
-- 7-day auto-suspension.
--
-- The BEFORE trigger is the one to keep: it can block the insert, which is what
-- makes moderation server-enforced rather than advisory.
DROP TRIGGER IF EXISTS scan_message_on_insert ON public.messages;
