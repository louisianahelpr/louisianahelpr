-- Owner 2026-10-25: members never see a fee name, a fee number or fee maths
-- in the app, on the website, or in any email or notice. They see only what
-- they get or pay. The one fee a member may see is the one-time $2 account
-- setup fee. (Helpr fee: 10% + 70c on new jobs; the poster never pays a fee.)
--
-- The notices below are written by SQL functions, so the copy lives here.
-- HOW: the mechanism of 20260925143327 (notification copy): take
-- pg_get_functiondef() (what Postgres actually has), substitute the named
-- string literal, EXECUTE the result. Only these literals can change; no
-- function logic, argument, grant or money figure moves. A format() call whose
-- placeholder is removed (a percent, or an amount the Helpr does not receive
-- whole) keeps its argument list: the dropped placeholder is always the last
-- one, and format() ignores an extra trailing argument, so no call is retyped.
--
-- Not changed here, by design: Declutter and Shops notices (paused, testers
-- only), admin alerts and RAISE text an admin reads.
--
-- Replay-safe by construction: a function that does not exist is skipped with
-- a WARNING; a pattern that no longer matches (the change is already in)
-- leaves regexp_replace's input unchanged and nothing is executed.
--
-- Guard: src/test/membersSeeNoFeeWords.test.ts (the SQL half reads the
-- effective definitions, rewrites included).

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
      (10, 'poster_cancel_job',
           $p$Your share of the cancellation fee is about \$%s \(%s%% of your part of the budget, minus the platform fee\), processed within the hour\.$p$,
           $q$You''ll receive about $%s for the time you set aside, on its way within the hour.$q$, ''),
      (20, 'poster_cancel_job',
           $p$before you confirmed your spot, so no cancellation fee applies\.$p$,
           $q$before you confirmed your spot, so there is no payment for it.$q$, ''),
      (30, 'poster_cancel_job',
           $p$It was more than 24 hours out, so no cancellation fee applies\.$p$,
           $q$It was more than 24 hours out, so there is no payment for it.$q$, 'g'),
      (40, 'poster_cancel_job',
           $p$You''ll receive approximately \$%s as a cancellation fee \(%s%% of the budget minus platform fee\), processed within the hour\.$p$,
           $q$You''ll receive about $%s for the time you set aside, on its way within the hour.$q$, ''),
      (50, 'poster_cancel_job',
           $p$before you accepted it, so no cancellation fee applies\.$p$,
           $q$before you accepted it, so there is no payment for it.$q$, ''),
      (60, 'poster_cancel_job',
           $p$'The cancellation fee is now \$%s\.'$p$,
           $q$'The amount for your Helpr''s time is now $%s.'$q$, ''),
      (70, 'block_user_and_settle',
           $p$Because it was cancelled late, a \$%s cancellation fee applies and your share is on its way — it settles within the hour\.$p$,
           $q$Because it was cancelled late, you''ll be paid for your time; it settles within the hour, and the amount shows in your Earnings.$q$, ''),
      (80, 'block_user_and_settle',
           $p$was cancelled late, so a \$%s cancellation fee applies\.$p$,
           $q$was cancelled late, so $%s of it is for the Helpr''s time.$q$, ''),
      (90, 'block_user_and_settle',
           $p$was cancelled\. No cancellation fee applies\.$p$,
           $q$was cancelled. Nothing is owed for it.$q$, ''),
      (100, 'block_user_and_settle',
           $p$Their \$%s cancellation fee comes out of that spot''s \$%s share,$p$,
           $q$$%s of that spot''s $%s share is for their time,$q$, ''),
      (110, 'block_user_and_settle',
           $p$you''re owed a \$%s cancellation fee, paid to you from the job''s payment when the job settles\.$p$,
           $q$you''ll be paid for your time from the job''s payment when the job settles; the amount shows in your Earnings.$q$, ''),
      (120, 'block_user_and_settle',
           $p$you''re owed a \$%s cancellation fee; our team will send it to you\.$p$,
           $q$you''ll be paid for your time; our team will send it to you.$q$, ''),
      (130, 'settle_one_off_jobs_for_banned_account',
           $p$so you''ll receive about \$%s as a cancellation fee, processed within the hour\.$p$,
           $q$so you''ll receive about $%s for your time, on its way within the hour.$q$, ''),
      (140, 'series_release_dates',
           $p$or is refunded less the card processing fee if you already paid for it\.$p$,
           $q$or most of it comes back to your card if you already paid for it.$q$, ''),
      (150, 'end_series_for_banned_account',
           $p$or is refunded less the card processing fee if you already paid for it\.$p$,
           $q$or most of it comes back to your card if you have already paid for it.$q$, ''),
      (160, 'end_series_for_banned_account',
           $p$Any you already paid for are refunded, less the card processing fee\.$p$,
           $q$Most of what you paid for any of them comes back to your card.$q$, 'g'),
      (170, 'end_recurring_series_by_platform',
           $p$Any visit you already paid for that nobody is booked on is refunded, less the card processing fee\.$p$,
           $q$Most of what you paid for any visit nobody is booked on comes back to your card.$q$, 'g'),
      (180, 'helper_cancel_booking',
           $p$If nobody takes it, you''re refunded less the card processing fee\.$p$,
           $q$If nobody takes it, most of what you paid comes back to your card.$q$, ''),
      (190, 'sweep_unfilled_series_visit_reminders',
           $p$it is cancelled when the day passes and refunded to you, less the card processing fee\.$p$,
           $q$it is cancelled when the day passes and most of what you paid comes back to you.$q$, ''),
      (200, 'bill_helpr_fault_card_fee',
           $p$'Card fee added'$p$,
           $q$'Amount owed added'$q$, ''),
      (210, 'bill_helpr_fault_card_fee',
           $p$Its \$%s card fee is added to what you owe; it comes out of your next payout\.$p$,
           $q$$%s is added to what you owe; it comes out of your next payout.$q$, ''),
      (220, 'rpc_answer_refund_request',
           $p$What you paid is on its way back to how you paid, less the card processing fee\.$p$,
           $q$Most of what you paid is on its way back to how you paid.$q$, ''),
      (230, 'cancel_job_after_failed_bank_payment',
           $p$You haven''t been charged and there''s no cancellation fee\.$p$,
           $q$You haven''t been charged anything.$q$, '')
    ) AS t(ord, fn, pat, rep, flags)
    ORDER BY ord
  LOOP
    v_any := false;
    v_hit := false;

    FOR v_oid IN
      SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = r.fn
         AND p.prokind IN ('f', 'p')
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
      RAISE WARNING 'fee-free notice copy %: public.% does not exist — skipped', r.ord, r.fn;
    ELSIF NOT v_hit THEN
      RAISE WARNING 'fee-free notice copy %: pattern did not match in public.% — nothing changed', r.ord, r.fn;
    END IF;
  END LOOP;
END
$migrate$;
