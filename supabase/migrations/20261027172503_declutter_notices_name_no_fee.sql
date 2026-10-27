-- Owner 2026-10-25, re-confirmed for Declutter 2026-10-27 (issue #3672):
-- "Members never see any fee number, fee name or fee maths. That covers the
-- app, the website and every email and notice. They see only the amount they
-- get or pay." The one fee a member may see is the one-time $2 account setup
-- fee. Declutter launches 2026-10-28, and its notices still said "the card
-- fee is not refunded", "Card fee owed", "the buyer's fee was not", "Your
-- delivery fee comes back ... minus the card fee" and so on.
--
-- The notices below are written by SQL functions, so the copy lives here.
-- HOW: the mechanism of 20261025203540 (notices never name the Helpr fee) and
-- 20260925143327: take pg_get_functiondef() (what Postgres actually has),
-- substitute the named string literal, EXECUTE the result. Only these member
-- notice literals change; no function logic, argument, grant or money figure
-- moves, and every format() keeps its placeholders and its argument list.
-- Staff text (RAISE, admin alerts, ledger reasons) is left as it is.
--
-- Ordered after 20261026155251 (declutter refund requests), 20261027153244
-- (seller delivery) and 20261027171453 (withdraw refund fix), so
-- declutter_complete_handover, declutter_handover_sweep,
-- declutter_refund_after_handover and the seller-delivery notices
-- (declutter_report_not_delivered, declutter_seller_cancel_delivery) are
-- rewritten from the bodies those migrations leave.
--
-- Replay-safe by construction: a function that does not exist is skipped with
-- a WARNING; a pattern that no longer matches (the change is already in)
-- leaves regexp_replace's input unchanged and nothing is executed.
--
-- Guard: src/test/membersSeeNoFeeWords.test.ts (the SQL half reads the
-- effective definitions, rewrites included; its fee words now also catch
-- "buyer's fee", "seller's fee", "delivery fee" and "% + 70¢").

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
      (10, 'declutter_close_paid_order',
           $p$The delivery fee paid the Helpr who made the trip\.$p$,
           $q$What you paid for delivery went to the Helpr who made the trip.$q$, ''),
      (20, 'declutter_close_paid_order',
           $p$is coming back to your card\. Your buyer''s fee is not refunded\.$p$,
           $q$is coming back to your card.$q$, 'g'),
      (30, 'declutter_close_paid_order',
           $p$'Your refund is on its way\. The card fee is not refunded\.'$p$,
           $q$'Your refund is on its way.'$q$, ''),
      (40, 'declutter_refund_paid_order',
           $p$'Your refund is on its way\. The card fee is not refunded\.'$p$,
           $q$'Your refund is on its way.'$q$, ''),
      (50, 'declutter_refund_paid_order',
           $p$You backed out of a sale after the buyer paid\. The card fee for that payment comes out of your next Declutter payout\.$p$,
           $q$You backed out of a sale after the buyer paid. The cost of refunding that payment comes out of your next Declutter payout.$q$, ''),
      (60, 'declutter_report_no_show',
           $p$The buyer got everything back; the card fee comes out of your next Declutter payout\.$p$,
           $q$The buyer got everything back; the cost of that refund comes out of your next Declutter payout.$q$, ''),
      (70, 'declutter_report_no_show',
           $p$The item price was refunded; the buyer''s fee was not\.$p$,
           $q$The item price was refunded.$q$, ''),
      (80, 'declutter_handover_sweep',
           $p$The item price was refunded; the buyer''s fee was not\.$p$,
           $q$The item price was refunded.$q$, ''),
      (90, 'declutter_complete_handover',
           $p$This sale paid off the \$%s card fee you owed, so there is nothing to send\.$p$,
           $q$This sale paid off the $%s you owed, so there is nothing to send.$q$, ''),
      (100, 'declutter_delivery_on_task_event',
           $p$Your delivery fee comes back in full and the rest of your payment minus the card fee\.$p$,
           $q$What you paid for delivery comes back in full, and most of the rest of your payment.$q$, ''),
      (110, 'declutter_delivery_on_task_event',
           $p$Your \$%s delivery fee is coming back to your card\.$p$,
           $q$The $%s you paid for delivery is coming back to your card.$q$, ''),
      (120, 'declutter_delivery_raise_paid',
           $p$the raise comes back with your delivery fee\.$p$,
           $q$the raise comes back with what you paid for delivery.$q$, ''),
      (130, 'declutter_delivery_raises_on_task_close',
           $p$is coming back to your card \(its card fee is not refunded\)\.$p$,
           $q$is coming back to your card.$q$, ''),
      (140, 'declutter_delivery_raises_on_task_close',
           $p$'A card fee comes out of your next payout'$p$,
           $q$'An amount owed comes out of your next payout'$q$, ''),
      (150, 'declutter_delivery_raises_on_task_close',
           $p$so the \$%s card fee on that raise comes out of your next Declutter payout\.$p$,
           $q$so $%s for that raise comes out of your next Declutter payout.$q$, ''),
      (160, 'declutter_seller_out_fee_notice',
           $p$'Card fee owed'$p$,
           $q$'Amount owed'$q$, ''),
      (170, 'declutter_seller_out_fee_notice',
           $p$The \$%s card fee for that payment comes out of your future Declutter payouts\.$p$,
           $q$$%s for that payment comes out of your future Declutter payouts.$q$, ''),
      (180, 'declutter_setup_job_fee_debt',
           $p$'Card fee added'$p$,
           $q$'Amount owed added'$q$, ''),
      (190, 'declutter_setup_job_fee_debt',
           $p$Its \$%s card fee is added to what you owe; it comes out of your next Declutter payout\.$p$,
           $q$$%s is added to what you owe; it comes out of your next Declutter payout.$q$, ''),
      (200, 'declutter_apply_seller_fault',
           $p$It was not the poster''s choice, so no cancellation fee applies\.$p$,
           $q$It was not the poster''s choice, so there is no payment for it.$q$, ''),
      (210, 'declutter_apply_seller_fault',
           $p$There is no cancellation fee, and anything you paid for it comes back in full$p$,
           $q$Nothing is owed for it, and anything you paid for it comes back in full$q$, ''),
      (220, 'declutter_refund_after_handover',
           $p$The delivery fee paid the Helpr who made the trip\.$p$,
           $q$What you paid for delivery went to the Helpr who made the trip.$q$, 'g'),
      (230, 'declutter_refund_after_handover',
           $p$' Your buyer''s fee is not refunded\.'$p$,
           $q$''$q$, ''),
      (240, 'declutter_report_not_delivered',
           $p$delivery included; the card fee comes out of your next Declutter payout\.$p$,
           $q$delivery included; the cost of that refund comes out of your next Declutter payout.$q$, ''),
      (250, 'declutter_seller_cancel_delivery',
           $p$delivery included; the card fee comes out of your next Declutter payout\.$p$,
           $q$delivery included; the cost of that refund comes out of your next Declutter payout.$q$, '')
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
      RAISE WARNING 'Declutter fee-free notice copy %: public.% does not exist — skipped', r.ord, r.fn;
    ELSIF NOT v_hit THEN
      RAISE WARNING 'Declutter fee-free notice copy %: pattern did not match in public.% — nothing changed', r.ord, r.fn;
    END IF;
  END LOOP;
END
$migrate$;
