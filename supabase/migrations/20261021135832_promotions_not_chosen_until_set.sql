-- Q2299 (owner, 2026-10-21, issue #3498): the sign-up email box ALONE is
-- enough for the welcome emails and the come-back ("follow-up") emails. The
-- Promotions email switch in Settings still stops them, but only when the
-- member turned it off themselves; so does every unsubscribe and suppression.
--
-- WHAT WAS BROKEN. Every commercial sender required BOTH
-- profiles.marketing_consent (the sign-up box) AND
-- notification_preferences.email_promotions. email_promotions was
-- NOT NULL DEFAULT false (20260312192409) and every account gets its row from
-- handle_new_user with the defaults (20260903012715), so "off" meant either
-- "the member turned it off" or "nobody ever touched it", and nothing could
-- tell the two apart. Measured on prod 2026-10-21 (read-only): 20 real members
-- with a confirmed email ticked the box and all 20 had email_promotions false,
-- so the welcome drip (no welcome_drip mail since 2026-08-28) and the
-- come-back emails could reach nobody.
--
-- THE DESIGN: email_promotions becomes three-valued.
--   NULL  = never chosen (the new column default). The sign-up box decides.
--   true  = the member turned Promotions on.
--   false = the member turned Promotions off, or an unsubscribe link did.
-- Welcome and come-back emails skip only an explicit false (and the Email
-- master off, as before). send-marketing-blast and the 'promotion'
-- notification email are NOT changed in what they do: both still need an
-- explicit true (NULL now stands where the old default false stood).
--
-- THE ONE-TIME BACKFILL, and why it is conservative. A row whose updated_at
-- still equals its created_at was never written after it was created, so its
-- false is the column default, not a choice: it becomes NULL. Every row that
-- was ever updated keeps its false, because the Settings screen writes the
-- WHOLE row on any switch (NotificationPreferences.tsx toggle/patchPrefs), so
-- an update cannot say which switch the member pressed, and an unsubscribe
-- link writes false too. Measured 2026-10-21: 100 of 109 rows never updated,
-- none of them created before the 20260903012715 backfill (so none was
-- created by a member's own whole-row write); of the 20 box-ticked members,
-- 16 never updated (they become NULL) and 4 updated (they stay off until they
-- turn Promotions on). Under-mailing is the safe direction.
--
-- Also restated here: claim_come_back_emails (20261021113827) skips
-- `email_promotions IS FALSE` instead of `IS NOT TRUE`. Nothing else in it
-- changes.
--
-- Proof: src/test/pglite/promotionsNotChosen.pglite.mjs (this migration 3x on
-- top of the real switch and come-back migrations). Guard:
-- src/test/promotionsNotChosen.test.ts.
--
-- REPLAY-SAFETY: DROP NOT NULL / SET DEFAULT are idempotent; the backfill only
-- matches a false that was never written after insert (a replay finds the
-- rows it NULLed already updated, so it leaves them); CREATE OR REPLACE for
-- the claim, which 20261021113827 defines earlier; grants restated by role
-- name.

ALTER TABLE public.notification_preferences ALTER COLUMN email_promotions DROP NOT NULL;
ALTER TABLE public.notification_preferences ALTER COLUMN email_promotions SET DEFAULT NULL;

COMMENT ON COLUMN public.notification_preferences.email_promotions IS
  'Promotions email switch. NULL = never chosen (welcome and come-back emails follow the sign-up box, profiles.marketing_consent); true = turned on; false = turned off by the member or an unsubscribe link (no commercial email). send-marketing-blast and the promotion notification email need true. Q2299, owner 2026-10-21.';

UPDATE public.notification_preferences
   SET email_promotions = NULL
 WHERE email_promotions IS FALSE
   AND updated_at = created_at;

-- ── The come-back claim: only an explicit Promotions-off stops it ─────────
CREATE OR REPLACE FUNCTION public.claim_come_back_emails(p_step integer, p_limit integer DEFAULT 20)
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
BEGIN
  IF p_step IS NULL OR p_step NOT IN (1, 2) THEN
    RAISE EXCEPTION 'invalid_step' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT p.user_id AS uid, p.email AS addr, p.full_name AS name
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.user_id
     WHERE p.email IS NOT NULL
       AND p.email_verified IS TRUE
       AND p.marketing_consent IS TRUE
       AND p.is_seed IS NOT TRUE
       AND p.anonymized_at IS NULL
       AND p.ban_status = 'active'
       AND (p.auto_suspended_until IS NULL OR p.auto_suspended_until <= now())
       AND u.deleted_at IS NULL
       -- The address mailed is the one the login record confirmed.
       AND u.email_confirmed_at IS NOT NULL
       AND lower(u.email) = lower(p.email)
       AND u.is_anonymous IS NOT TRUE
       AND (u.banned_until IS NULL OR u.banned_until <= now())
       AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.user_bans b
          WHERE b.user_id = p.user_id AND b.is_active IS TRUE
            AND (b.expires_at IS NULL OR b.expires_at > now()))
       AND NOT EXISTS (
         SELECT 1 FROM public.notification_preferences np
          WHERE np.user_id = p.user_id
            AND (np.email_promotions IS FALSE OR np.email_enabled IS FALSE))
       AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails s WHERE lower(s.email) = lower(p.email))
       AND NOT public.is_fixture_email(p.email)
       AND lower(p.email) !~ '@([a-z0-9-]+\.)*(example\.(com|net|org)|[a-z0-9-]+\.(test|example|invalid|localhost)|test|example|invalid|localhost)$'
       AND (p.last_drip_at IS NULL OR p.last_drip_at < now() - interval '20 hours')
       -- Never came back: no sign of use from 24 hours after sign-up on.
       AND NOT (u.last_sign_in_at IS NOT NULL AND u.last_sign_in_at >= p.created_at + interval '24 hours')
       AND NOT EXISTS (
         SELECT 1 FROM auth.sessions se
          WHERE se.user_id = p.user_id
            AND greatest(se.created_at, se.updated_at, se.refreshed_at AT TIME ZONE 'UTC') >= p.created_at + interval '24 hours')
       AND NOT EXISTS (
         SELECT 1 FROM public.login_history lh
          WHERE lh.user_id = p.user_id AND lh.created_at >= p.created_at + interval '24 hours')
       AND NOT EXISTS (
         SELECT 1 FROM public.analytics_events ae
          WHERE ae.user_id = p.user_id AND ae.created_at >= p.created_at + interval '24 hours')
       -- The step's own window.
       AND (
         (p_step = 1
           AND p.created_at <= now() - interval '3 days'
           AND p.created_at > now() - interval '10 days'
           AND NOT EXISTS (SELECT 1 FROM public.come_back_email_sends c WHERE c.user_id = p.user_id AND c.email_step = 1))
         OR
         (p_step = 2
           AND p.created_at <= now() - interval '10 days'
           AND p.created_at > now() - interval '17 days'
           AND EXISTS (SELECT 1 FROM public.come_back_email_sends c
                        WHERE c.user_id = p.user_id AND c.email_step = 1 AND c.queued_at <= now() - interval '5 days')
           AND NOT EXISTS (SELECT 1 FROM public.come_back_email_sends c WHERE c.user_id = p.user_id AND c.email_step = 2))
       )
       -- The hidden switch, decided for this member (off = nobody).
       AND public.feature_enabled_for_user('come_back_emails', p.user_id)
     ORDER BY p.created_at
     LIMIT v_limit
  ),
  claimed AS (
    -- Two overlapping runs: the second's insert waits on the first's row and
    -- then does nothing, so it returns no row and mails no one.
    INSERT INTO public.come_back_email_sends AS c (user_id, email_step)
    SELECT due.uid, p_step::smallint FROM due
    ON CONFLICT ON CONSTRAINT come_back_email_sends_pkey DO NOTHING
    RETURNING c.user_id
  )
  SELECT due.uid, due.addr, due.name
    FROM due
    JOIN claimed ON claimed.user_id = due.uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_come_back_emails(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_come_back_emails(integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_come_back_emails(integer, integer) IS
  'Come-back emails: claims up to p_limit members due for step p_step (1 about day 3, 2 about day 10) by inserting their come_back_email_sends row, and returns only the rows it inserted. Needs the sign-up box (marketing_consent); skips an explicit Promotions-off (email_promotions false) and the Email master off. Off unless the come_back_emails switch is on for the member. service_role only.';
