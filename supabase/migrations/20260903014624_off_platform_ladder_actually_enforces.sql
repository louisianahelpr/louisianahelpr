-- The off-platform suspension enforced nothing and said otherwise.
--
-- scan_message_content() is the SERVER-side backstop: the BEFORE INSERT trigger
-- that catches contraband when a modified client skips ViolationDialog. On the
-- second flag in 24h it did this:
--
--     UPDATE public.profiles
--        SET auto_suspended_until = now() + interval '7 days'
--      WHERE user_id = NEW.sender_id ...;
--
--     INSERT INTO notifications ... '🚫 Account temporarily suspended'
--       'Your account has been auto-suspended for 7 days ...'
--
-- Measured against prod, that notification was the ONLY thing that happened.
-- Three reasons, each sufficient on its own:
--
--   1. NOTHING READS auto_suspended_until ALONE. Every consumer of a
--      suspension keys on ban_status, which the scanner never set:
--        is_caller_banned()            ban_status IN ('banned','temp_banned','permanently_banned')
--        ProtectedRoute.tsx:288        same three
--        StrikeBanner.tsx:46           ban_status === 'temp_banned'
--        AutoRestrictedRail.tsx:59     .eq('ban_status','temp_banned')
--        sweep_expired_auto_bans()     WHERE ban_status = 'temp_banned'
--      So the "suspended" user could still post, bid and message; saw no
--      banner; never appeared in the admin rail; and — because the sweeper
--      also filters on ban_status — the stray timestamp would never have been
--      lifted either. Unenforced AND unliftable.
--
--   2. THE UPDATE DID NOT EVEN WRITE. prevent_self_escalation (BEFORE UPDATE on
--      profiles) pins NEW.ban_status AND NEW.auto_suspended_until back to OLD
--      for any caller that is not an admin, not a NULL auth.uid(), and has not
--      set app.trusted_ladder_write. The scanner runs as the OFFENDER's own
--      session and never set that flag, so the column it targeted was restored
--      before the row hit disk. An UPDATE returning no error is not a write —
--      the zero-row class from CLAUDE.md, wearing a trigger.
--
--   3. IT NEVER FED THE LADDER. It wrote fraud_flags, not user_violations, so
--      apply_message_violation_consequence — the owner-approved ladder that
--      DOES enforce — never saw it, and no admin was asked to review anything.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT TOUCH.
-- The consequence ladder itself is correct and current. Since
-- 20260829030000_consolidate_consequence_ladders.sql all three ladders share
-- one core (apply_consequence_ladder), and the message wrapper already sets
-- app.trusted_ladder_write, already dedupes, and already passes the right rungs.
-- Nothing here redefines it, for two reasons: it is not broken, and
-- src/lib/reliabilityLadder.parity.test.ts reads those rung/copy arrays out of
-- 20260829030000 BY PATH. A later migration that redefines any of those
-- functions does not fail that test — it makes it assert against a superseded
-- file and pass while blind. So the fix below adds a caller, never a second
-- copy of the policy.
--
-- THE FIX. The scanner stops inventing a consequence of its own and reports the
-- offence to the ladder the client path already uses, so a user who bypasses
-- the client lands exactly where an honest one does — no harsher, and no longer
-- free. It can call the existing RPC unchanged because the RPC acts on
-- auth.uid() and the messages INSERT policy is
--     ((SELECT auth.uid()) = sender_id) AND can_message_in_job(...)
-- so for every client-originated message the caller IS the sender.
--
-- WHY THE CONSEQUENCE MOVES TO AN *AFTER* TRIGGER. Escalating from the existing
-- BEFORE INSERT trigger deadlocks the feature against itself. Both fire BEFORE
-- INSERT on messages, and BEFORE-row triggers fire in alphabetical name order
-- (verified on prod):
--     1 enforce_message_rate        2 messages_scan_content   <- consequence
--     3 messages_validate_reply_trg 5 scan_message_on_edit
--     6 trg_ban_gate_messages       <- is_caller_banned() -> RAISE
-- so the scanner would suspend the sender and then trg_ban_gate_messages,
-- running four triggers later in the SAME statement, would see the fresh
-- 'temp_banned' and RAISE 'account_restricted'. That aborts the transaction,
-- which rolls back the ban, the violation row, the fraud flag and every
-- notification: the user gets a hard error, nothing is recorded, and every
-- retry repeats it forever. Reproduced in PGlite before choosing against it.
-- Detection therefore stays BEFORE (it must, to mutate NEW.flagged_hidden);
-- the consequence moves to AFTER, where the gate for THIS message has already
-- passed and the restriction applies from the next message on.

-- ── 1. Detection stays BEFORE, and now only detects ──
-- Matching rules byte-identical to the deployed version, including the
-- full-width-digit normalisation and the phone pattern strengthened in
-- 20260819070000. Everything it used to do after deciding v_matched — the
-- fraud flag, the 24h count, the two notifications, the phantom UPDATE — moves
-- to the AFTER trigger below.
CREATE OR REPLACE FUNCTION public.scan_message_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_matched boolean := false;
  v_reason text := null;
  v_norm text := translate(
    NEW.content,
    '０１２３４５６７８９',
    '0123456789'
  );
BEGIN
  IF v_norm ~* '[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}' THEN
    v_matched := true; v_reason := 'Phone number detected';
  ELSIF NEW.content ~* '(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}' THEN
    v_matched := true; v_reason := 'Phone number detected';
  ELSIF NEW.content ~* '[a-z0-9._]+@[a-z0-9]+\.[a-z]{2,}' THEN
    v_matched := true; v_reason := 'Email address detected';
  ELSIF NEW.content ~* '(venmo|cashapp|cash app|zelle|paypal|apple\s*pay|google\s*pay|crypto|bitcoin|\mbtc\M|\meth\M)' THEN
    v_matched := true; v_reason := 'Off-platform payment service mentioned';
  ELSIF NEW.content ~* '(pay me direct|off the app|outside the app|skip the fee|avoid the fee|cash only|in cash|text me|call me|whatsapp|telegram|dm me|hit me up|contact me at|reach me at|send money to|pay outside)' THEN
    v_matched := true; v_reason := 'Off-platform payment intent detected';
  END IF;

  IF v_matched THEN
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. The consequence, AFTER the row has cleared every BEFORE gate ──
-- Keyed off the flag the BEFORE trigger just set, so the two cannot disagree
-- about what was caught.
CREATE OR REPLACE FUNCTION public.apply_message_scan_consequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reason text := COALESCE(NEW.flag_reason, 'Off-platform contact detected');
  v_result jsonb;
BEGIN
  -- Evidence trail, unchanged in shape and column set so anything already
  -- reading fraud_flags keeps working.
  INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
  VALUES (NEW.sender_id, 'off_platform_contact',
    v_reason || ' — message: ' || left(NEW.content, 200),
    NEW.job_id);

  -- One ladder, one policy, one admin queue.
  --
  -- The RPC acts on auth.uid(), and the messages INSERT policy already
  -- guarantees auth.uid() = sender_id, so this strikes the author and nobody
  -- else. The equality is re-checked rather than assumed: if a message is ever
  -- written by a service-role job, a migration backfill or a SQL console —
  -- where auth.uid() is NULL or someone else — the correct action is to record
  -- the evidence and escalate NOBODY, because striking the wrong account is a
  -- far worse failure than not striking. (It would also RAISE
  -- 'not_authenticated' and abort the insert outright.) Unreachable from the
  -- app today; the guard is here so it stays harmless if that ever changes.
  IF auth.uid() IS NULL OR auth.uid() <> NEW.sender_id THEN
    RETURN NULL;
  END IF;

  v_result := public.apply_message_violation_consequence(v_reason, NEW.content);

  -- The ladder speaks for itself on a first, second or third strike. It stays
  -- silent only on 'duplicate' (this exact message inside 24h) — and a hidden
  -- message with no explanation at all is its own trust defect, so cover that
  -- one case here. Exactly one notification per hidden message, either way.
  IF v_result->>'action' = 'duplicate' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.sender_id, 'Message hidden',
      'Your message was hidden because it looked like off-platform contact or payment info. Keep payments and contact on Helpr — repeated attempts can lead to a temporary restriction.',
      'warning', '/profile?tab=warnings');
  END IF;

  RETURN NULL;  -- AFTER trigger: the return value is ignored.
END;
$$;

-- Internal: reachable only as a trigger. It takes its victim from the row, so
-- a direct grant would let a caller strike anyone they can name in sender_id.
REVOKE ALL ON FUNCTION public.apply_message_scan_consequence() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_scan_consequence ON public.messages;
DROP TRIGGER IF EXISTS messages_scan_consequence_on_edit ON public.messages;

-- Guarded for a from-scratch replay that has not yet created public.messages.
DO $$
BEGIN
  IF to_regclass('public.messages') IS NULL THEN
    RAISE NOTICE 'public.messages not present yet — skipping scan-consequence triggers (replay-safe).';
    RETURN;
  END IF;

  EXECUTE $t$
    CREATE TRIGGER messages_scan_consequence
      AFTER INSERT ON public.messages
      FOR EACH ROW
      WHEN (NEW.flagged_hidden)
      EXECUTE FUNCTION public.apply_message_scan_consequence()
  $t$;

  -- The edit re-scan (scan_message_on_edit, 20260831015232) needs the same
  -- consequence, or editing a clean message into contraband would be free.
  EXECUTE $t$
    CREATE TRIGGER messages_scan_consequence_on_edit
      AFTER UPDATE OF content ON public.messages
      FOR EACH ROW
      WHEN (NEW.flagged_hidden AND OLD.content IS DISTINCT FROM NEW.content)
      EXECUTE FUNCTION public.apply_message_scan_consequence()
  $t$;

  -- The BEFORE detection trigger is unchanged and deliberately left in place;
  -- recreated only if a from-scratch replay has not reached the migration that
  -- defines it.
  IF to_regprocedure('public.scan_message_content()') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'messages' AND t.tgname = 'messages_scan_content'
          AND NOT t.tgisinternal
     ) THEN
    EXECUTE 'CREATE TRIGGER messages_scan_content BEFORE INSERT ON public.messages
             FOR EACH ROW EXECUTE FUNCTION public.scan_message_content()';
  END IF;
END $$;
