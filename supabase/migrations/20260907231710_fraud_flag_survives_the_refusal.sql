-- Two guards recorded a fraud flag and then threw it away in the same breath.
--
-- `INSERT INTO public.fraud_flags …; RAISE EXCEPTION …;` inside one plpgsql
-- function is a write that has NEVER persisted. The RAISE aborts the
-- transaction and takes the insert with it. It reads in review as "we log the
-- abuse and then refuse", and it logs nothing. Prod agrees: `fraud_flags` held
-- ZERO rows of ANY flag_type, and it stayed at zero through a live probe on
-- 2026-09-07 that tripped the application guard three times.
--
-- Two functions have this shape. Both are fixed here. Established by reading
-- the LIVE definitions of all ten functions that mention `fraud_flags`, not by
-- grepping the repo:
--
--   · enforce_application_limit  — BEFORE INSERT on applications.  BROKEN.
--   · enforce_message_rate       — BEFORE INSERT on messages.      BROKEN.
--   · rpc_open_dispute           — inserts `high_dispute_rate` on its SUCCESS
--     path and returns; its RAISEs are on earlier, unrelated branches. NOT
--     broken, and the reason a function can both insert and raise without
--     having this bug. Left alone.
--   · apply_message_scan_consequence, detect_suspicious_user_patterns,
--     enforce_referral_cap, enforce_referral_credit_eligibility,
--     flag_suspicious_review, track_revision_scope_creep — contain no
--     RAISE EXCEPTION at all, so their writes commit. Left alone. (A BEFORE
--     trigger returning NULL cancels its own row without aborting the
--     transaction, so the flag survives that too.)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY NOT AN AUTONOMOUS TRANSACTION
-- ═══════════════════════════════════════════════════════════════════════════
-- The textbook fix is to write the flag on a second connection so the abort
-- cannot reach it. Every available route was checked against prod rather than
-- assumed:
--
--   · `pg_background` — not in `pg_available_extensions`. Not an option.
--   · `dblink` — available but NOT installed. Installing it to write a fraud
--     flag means a credential in the database and a TCP connect inside a
--     BEFORE trigger on the apply path. A dblink connect that fails or hangs
--     would break applying for everyone, which is a far worse defect than the
--     one being fixed. Declined deliberately.
--   · `pg_net` — installed (0.20.0), and it does NOT survive a rollback.
--     PROVEN, not assumed: a DO block on prod called
--     `net.http_post(...)` (request id 55139) and then RAISEd. Afterwards both
--     `net.http_request_queue` and `net._http_response` held zero rows for
--     that id. pg_net queues into an ordinary table, so the abort removes the
--     request exactly like any other insert. `pgmq` is the same shape.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IT DOES INSTEAD: FLAG ON ARRIVAL, NOT ON REFUSAL
-- ═══════════════════════════════════════════════════════════════════════════
-- The flag moves off the aborting path and onto the last one that COMMITS: the
-- attempt that takes the user TO the threshold. Reaching the cap is the signal
-- worth recording; being refused afterwards is just the same signal repeating.
-- Nothing can be refused without first having crossed that boundary, so no
-- refusal goes unflagged.
--
-- Two consequences, both deliberate:
--
--   1. A user who stops exactly ON the threshold is flagged without ever seeing
--      a refusal. That is correct — they hit the cap. The flag is a review
--      signal for an admin, not a punishment.
--   2. If an admin LOWERS the cap underneath someone already above it, that
--      user is refused without a flag, because they never cross the boundary
--      afterwards. Also correct: an operator moving the line is not evidence of
--      abuse by the person who was already past it.
--
-- The insert is wrapped so that a failure to record a flag can never be the
-- reason a legitimate application or message is rejected. It now sits on the
-- SUCCESS path, where an unhandled error WOULD kill the write — the exact
-- shape that has bitten this project before. The WARNING lands in the Postgres
-- log rather than vanishing.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Applications. Cap is `platform_settings.daily_application_cap`
--    (20260907230038); NULL/0/negative = unlimited, which is the default, and
--    an uncapped platform flags nothing.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_application_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  daily_count integer;
  v_cap       integer := public.application_cap('day');
BEGIN
  -- Uncapped is the default. Return before counting: the count is a scan of
  -- this helper's last 24h on every insert, and nothing can act on the answer.
  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO daily_count
  FROM public.applications
  WHERE helper_id = NEW.helper_id
    AND created_at > now() - interval '24 hours';

  IF daily_count >= v_cap THEN
    -- No flag write here. It cannot survive this RAISE — that is the whole
    -- point of this migration. The flag was already written by the insert that
    -- brought them to the cap, below.
    RAISE EXCEPTION 'You have reached the daily application limit (%). Please try again tomorrow.', v_cap;
  END IF;

  -- This insert is allowed, and the transaction is going to COMMIT. If it is
  -- the one that reaches the cap, the flag written now is a flag that lasts.
  IF daily_count + 1 >= v_cap THEN
    BEGIN
      INSERT INTO public.fraud_flags (user_id, flag_type, details)
      SELECT NEW.helper_id, 'application_spam',
             format('Helper reached the daily application cap of %s in 24h.', v_cap)
      -- One open flag per account at a time, same rule rpc_open_dispute uses
      -- for `high_dispute_rate`: every further attempt past the cap is more of
      -- the same signal, and an admin resolving the flag is what re-arms it.
      -- Without this, one determined account buries the review queue.
      WHERE NOT EXISTS (
        SELECT 1 FROM public.fraud_flags f
        WHERE f.user_id = NEW.helper_id
          AND f.flag_type = 'application_spam'
          AND f.resolved = false
      );
    EXCEPTION WHEN OTHERS THEN
      -- Recording a risk signal must never be the reason a legitimate
      -- application is refused.
      RAISE WARNING 'enforce_application_limit: fraud flag failed for %: %',
        NEW.helper_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Messages. The 30-per-hour threshold is unchanged and still compiled in —
--    the owner's decision was about application and signup caps, and widening
--    it to messaging is not this change's business. Only the flag moves.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_message_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  msg_count integer;
  v_cap     constant integer := 30;
BEGIN
  SELECT count(*) INTO msg_count
  FROM public.messages
  WHERE sender_id = NEW.sender_id
    AND created_at > now() - interval '1 hour';

  IF msg_count >= v_cap THEN
    RAISE EXCEPTION 'You are sending messages too quickly. Please slow down.';
  END IF;

  IF msg_count + 1 >= v_cap THEN
    BEGIN
      INSERT INTO public.fraud_flags (user_id, flag_type, details)
      SELECT NEW.sender_id, 'message_flooding',
             format('User sent %s messages in 1 hour, reaching the flood threshold.', v_cap)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.fraud_flags f
        WHERE f.user_id = NEW.sender_id
          AND f.flag_type = 'message_flooding'
          AND f.resolved = false
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enforce_message_rate: fraud flag failed for %: %',
        NEW.sender_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;
