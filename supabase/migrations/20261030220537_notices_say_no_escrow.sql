-- Notice wording (list #19, audit E2 #5 and #11): members never read "escrow", and "not selected" says what to do next.
--
-- Measured on prod 2026-10-30 (pg_get_functiondef, 60 days of notifications): 165 "Payment secured in escrow" rows, and
-- the words in helper_cancel_booking, helper_abort_job, settle_one_off_jobs_for_banned_account and
-- notify_on_payment_escrowed. Three of those differ from their newest migration text (md5 on prod against the file), so
-- this takes the rewrite mechanism of 20261025203540: read pg_get_functiondef (what Postgres actually has), substitute
-- the named literal, EXECUTE. Only string literals change here, plus notify_on_application's not-selected branch: no
-- amount, status, lock or branch of the money functions moves. Admin text keeps the word (src/test/noticesSayNoEscrow).
--
-- Replay-safe by construction: a pattern that no longer matches leaves the definition unchanged and nothing runs; a
-- function that does not exist is skipped with a WARNING. Grants are untouched (CREATE OR REPLACE keeps them).
-- Proof: src/test/pglite/noticesSayNoEscrow.pglite.mjs. Guard: src/test/noticesSayNoEscrow.test.ts.

DO $migrate$
DECLARE
  r        record;
  v_oid    oid;
  v_def    text;
  v_new    text;
  v_any    boolean;
  v_hit    boolean;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (10, 'helper_cancel_booking',
           $p$Your payment stays protected in escrow for whoever you pick next\.$p$,
           $q$Your payment stays protected for whoever you pick next.$q$, 'g'),
      (20, 'helper_abort_job',
           $p$your payment stays in escrow until a decision is made$p$,
           $q$your payment stays on hold until a decision is made$q$, 'g'),
      (30, 'helper_abort_job',
           $p$your payment stays protected in escrow for whoever you pick next\.$p$,
           $q$your payment stays protected for whoever you pick next.$q$, 'g'),
      (40, 'settle_one_off_jobs_for_banned_account',
           $p$Your payment stays protected in escrow for whoever you pick next\.$p$,
           $q$Your payment stays protected for whoever you pick next.$q$, 'g'),
      (50, 'settle_one_off_jobs_for_banned_account',
           $p$The money stays in escrow until then$p$,
           $q$The money stays on hold until then$q$, 'g'),
      (60, 'notify_on_payment_escrowed',
           $p$'Payment secured in escrow'$p$,
           $q$'Payment secured'$q$, 'g'),
      (70, 'notify_on_payment_escrowed',
           $p$is safely held in escrow and will release after the job is completed\.$p$,
           $q$is safely held and will be released after the job is completed.$q$, 'g'),
      (80, 'notify_on_payment_escrowed',
           $p$is now in escrow\. Get to work!$p$,
           $q$is held safely. Get to work!$q$, 'g'),
      (90, 'notify_on_application',
           $p$v_message := 'Your application for "' \|\| job_title \|\| '" was not selected';$p$,
           $q$v_title := 'Not picked this time';
      v_message := 'They went with someone else for "' || COALESCE(job_title, 'this job') || '"';
      v_link := '/jobs?tab=browse' || CASE WHEN job_cat IS NOT NULL THEN '&cat=' || job_cat ELSE '' END;$q$, 'g'),
      (100, 'notify_on_application',
           $p$btrim\(NEW\.decline_reason\);\n      END IF;\n    END IF;$p$,
           $q$btrim(NEW.decline_reason);
      END IF;
      v_message := v_message || '. Tap to see similar open jobs.';
    END IF;$q$, 'g')
    ) AS t(ord, fn, pat, rep, flags)
    ORDER BY ord
  LOOP
    v_any := false;
    v_hit := false;
    FOR v_oid IN
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = r.fn AND p.prokind IN ('f', 'p')
    LOOP
      v_any := true;
      v_def := pg_get_functiondef(v_oid);
      v_new := regexp_replace(v_def, r.pat, r.rep, r.flags);
      IF v_new IS DISTINCT FROM v_def THEN
        EXECUTE v_new;
        v_hit := true;
      END IF;
    END LOOP;
    IF NOT v_any THEN
      RAISE WARNING 'notice wording %: public.% does not exist, skipped', r.ord, r.fn;
    ELSIF NOT v_hit THEN
      RAISE NOTICE 'notice wording %: public.% already has it', r.ord, r.fn;
    END IF;
  END LOOP;
END;
$migrate$;
