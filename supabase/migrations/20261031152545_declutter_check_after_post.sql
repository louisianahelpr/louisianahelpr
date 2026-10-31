-- LEAD-POST-SLOW (owner 2026-10-31: "Post it does nothing, or posts only after a very long delay"; owner rules
-- "nothing slow for users, under 2 s" and "content goes live at once; admin only on reports or failed auto-checks").
--
-- WHY
--   Measured on prod (owner's Post of c87b7de4, 10-31 14:38:41Z): 5.8 s from the draft to live, 3.9 s of it the
--   automatic photo check (declutter-ai-draft, mode check), which the app had to finish BEFORE
--   declutter_publish_item, because publish held any listing whose check had not come back.
--
-- WHAT THIS DOES (each function restated from its EFFECTIVE prod definition, pg_get_functiondef read 2026-10-31,
-- identical to the repo's newest copy 20261030071816_declutter_live_on_post.sql):
--   1. declutter_publish_item: a listing not checked yet goes LIVE; only a check that already flagged it holds it.
--   2. declutter_record_ai_check: also judges a LIVE listing not checked yet (the check the app now runs right
--      after Post). A flag takes it down at once (pending_review, held for an admin), closes its open offers
--      (buyers told, nothing charged) and tells the seller why. A clean result just records it.
--      Review of 41771724f3 (2): a buyer can reserve or pay in the seconds before the check lands, so the check
--      also judges a RESERVED or SOLD listing that went live with none. On a flag: not paid yet, the cart line
--      closes with no strike (as the buyer's own "remove", 20261028221904), its unpaid order is superseded with
--      close_reason 'not_payable' (a late payment on it is refunded in full by declutter_mark_order_paid), the buyer is told and the item is held
--      for an admin; paid, the seller's payouts are held (payout_holds, the existing hold every payout path
--      checks) and every admin is alerted: lift the hold to release, or refund the buyer through the existing
--      refund path. An admin-approved listing is never re-judged by a late check.
--   3. declutter_hold_unchecked_listings(): the fail-safe (B19) for a check that never comes back (app closed,
--      tool down): a listing live 15 minutes with no check is held for an admin and the seller told. Every 10 min
--      by cron ('declutter-unchecked-hold'). A late clean check puts it back live (record_ai_check's own
--      pending_review branch: live_at is set). Review of 41771724f3 (1): a listing an admin approved since it
--      went live (declutter_admin_review_item sets admin_approved_at, not ai_checked_at) is never held again.
--      Review of 62f90f3368 (3): one a buyer reserved or paid for before any check came back is not taken down
--      (the sale stands): the seller's payouts are held, every admin is alerted (not for a test account), the
--      seller told, and the item marked judged so it runs once.
--      Re-review of e23f131d97: a flagged (or "didn't finish") listing that is live again because its sale fell
--      through is held like an unchecked one.
--
-- Not changed: the contact-leak trigger, the test-data marking, a listing an edit sends back for a check.
-- Grants by role name: REVOKE ... FROM PUBLIC, anon. Replay-safe: CREATE OR REPLACE, cron unschedule first.

-- ---------------------------------------------------------------------------
-- 1. Publish: live unless a check already flagged it.
CREATE OR REPLACE FUNCTION public.declutter_publish_item(p_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_floor integer;
  v_ai_checked timestamptz;
  v_ai_flag text;
  v_photos integer;
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_a_draft' USING ERRCODE = '22023';
  END IF;
  IF v_item.sale_mode <> 'offers' THEN
    -- Row 55: bidding waits for the auctioneer licence.
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;

  -- Row 23 (payout setup before the first listing) is dropped (owner
  -- 2026-10-27, "list first, set up at first sale"): a paid order makes the
  -- seller eligible to set up, and the payout waits until they have.

  SELECT count(*)::integer INTO v_photos FROM public.declutter_item_photos WHERE item_id = p_item_id;
  IF v_photos < 1 OR v_photos > 12 THEN
    RAISE EXCEPTION 'photos_required'
      USING ERRCODE = '22023', HINT = 'Add at least 1 photo (up to 12).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.declutter_tax_attestations a WHERE a.item_id = p_item_id AND a.seller_id = v_uid) THEN
    RAISE EXCEPTION 'attestation_required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = v_uid) THEN
    RAISE EXCEPTION 'pickup_windows_required' USING ERRCODE = '22023';
  END IF;

  SELECT floor_price_cents, ai_checked_at, ai_flag_reason INTO v_floor, v_ai_checked, v_ai_flag
    FROM public.declutter_item_private WHERE item_id = p_item_id FOR UPDATE;
  IF v_floor IS NULL OR v_floor > v_item.current_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price' USING ERRCODE = '22023';
  END IF;

  -- Owner 2026-10-29 (item B): a listing goes live when it is posted. Only a
  -- failed automatic check holds it for an admin: flagged, or never came back
  -- (fail-safe, B19). Row 33's "first 3 listings wait for an admin" is gone.
  -- LEAD-POST-SLOW (owner 2026-10-31, "nothing slow for users, under 2 s"): the automatic check now runs right
  -- AFTER Post (declutter_record_ai_check judges a live, unchecked listing). Only a check that already flagged
  -- it holds it here; one that never comes back is held by declutter_hold_unchecked_listings (fail-safe, B19).
  v_status := CASE
    WHEN v_ai_checked IS NOT NULL AND v_ai_flag IS NOT NULL THEN 'pending_review'
    ELSE 'live'
  END;

  UPDATE public.declutter_items
     SET status = v_status,
         submitted_at = now(),
         live_at = CASE WHEN v_status = 'live' THEN now() END,
         updated_at = now()
   WHERE id = p_item_id;
  RETURN v_status;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_publish_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_publish_item(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The check also judges a live listing not checked yet.
CREATE OR REPLACE FUNCTION public.declutter_record_ai_check(p_item_id uuid, p_seller_id uuid, p_judged_photo_ids uuid[], p_judged_title text, p_judged_description text, p_judged_category text, p_flag_reason text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.declutter_items%ROWTYPE;
  v_current uuid[];
  v_at timestamptz := now();
  v_flag text := NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), '');
  r record;
  v_line record;
BEGIN
  -- A draft (before publishing), or a listing an edit sent back for this check:
  -- it was live before (live_at set) and its result was cleared by the edit. A
  -- listing already judged (flagged, waiting for an admin) is never re-judged,
  -- so a flag cannot be washed off by asking again.
  SELECT i.* INTO v_item FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = p_seller_id
     AND (i.status = 'draft'
          -- LEAD-POST-SLOW: the check that runs right after Post, on a live listing not judged yet, or one a buyer
          -- reserved or paid for before it landed (review of 41771724f3). Never one an admin approved since it
          -- went live: the admin's decision stands.
          OR (i.status IN ('live', 'reserved', 'sold') AND i.live_at IS NOT NULL
              AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
              AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                           WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL))
          OR (i.status = 'pending_review' AND i.live_at IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                           WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL)))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_current
    FROM public.declutter_item_photos WHERE item_id = p_item_id;
  IF v_current IS DISTINCT FROM (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(p_judged_photo_ids) AS x)
     OR v_item.title IS DISTINCT FROM p_judged_title
     OR v_item.description IS DISTINCT FROM p_judged_description
     OR v_item.category IS DISTINCT FROM p_judged_category THEN
    RAISE EXCEPTION 'ai_check_stale' USING ERRCODE = '40001';
  END IF;
  UPDATE public.declutter_item_private
     SET ai_checked_at = v_at,
         ai_flag_reason = v_flag,
         updated_at = v_at
   WHERE item_id = p_item_id;

  -- LEAD-POST-SLOW: a listing that went live at Post and is flagged now comes down at once: held for an admin, its
  -- open offers closed (buyers told, nothing charged), and the seller told why.
  IF v_item.status = 'live' AND v_flag IS NOT NULL THEN
    UPDATE public.declutter_items
       SET status = 'pending_review', updated_at = v_at
     WHERE id = p_item_id AND status = 'live';
    FOR r IN
      UPDATE public.declutter_offers
         SET status = 'voided', closed_at = v_at, updated_at = v_at
       WHERE item_id = p_item_id AND status = 'open'
      RETURNING id, buyer_id
    LOOP
      INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
      PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing changed',
        format('"%s" was taken down for a check, so your offer is closed. Nothing was charged.', v_item.title),
        '/declutter?tab=buying', v_item.seller_id);
    END LOOP;
    PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
      format('Our automatic check flagged "%s" (%s). Someone from Louisiana Helpr will look at it. Buyers can''t see it until then.', v_item.title, v_flag),
      '/declutter?tab=selling', NULL);
  END IF;

  -- Review of 41771724f3 (2): flagged after a buyer reserved or paid for it.
  IF v_item.status IN ('reserved', 'sold') AND v_flag IS NOT NULL THEN
    -- Lock order as everywhere in Declutter: items (above) -> orders -> lines.
    SELECT c.id, c.status, c.buyer_id, c.order_id, o.status AS order_status INTO v_line
      FROM public.declutter_cart_items c LEFT JOIN public.declutter_orders o ON o.id = c.order_id
     WHERE c.item_id = p_item_id AND c.status IN ('in_cart', 'paid')
     ORDER BY c.created_at DESC LIMIT 1;
    IF v_line.order_id IS NOT NULL THEN
      PERFORM 1 FROM public.declutter_orders o WHERE o.id = v_line.order_id FOR UPDATE;
    END IF;
    IF v_line.id IS NOT NULL AND v_line.status = 'in_cart' AND COALESCE(v_line.order_status, 'awaiting_payment') = 'awaiting_payment' THEN
      -- Not paid: let the line go with no strike, held for an admin.
      UPDATE public.declutter_cart_items SET status = 'removed', closed_at = v_at
       WHERE id = v_line.id AND status = 'in_cart';
      IF v_line.order_id IS NOT NULL THEN
        -- 'not_payable', never 'superseded' (= the buyer restarted checkout, card fee kept): a payment that still
        -- lands on this checkout is refunded in full, the card fee ours, as the buyer's notice below promises.
        UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'not_payable', closed_at = v_at
         WHERE id = v_line.order_id AND status = 'awaiting_payment';
        UPDATE public.declutter_cart_items SET order_id = NULL
         WHERE order_id = v_line.order_id AND status = 'in_cart';
      END IF;
      UPDATE public.declutter_items SET status = 'pending_review', updated_at = v_at
       WHERE id = p_item_id AND status = 'reserved';
      PERFORM public.declutter_notify(v_line.buyer_id, 'declutter_offers', 'Listing changed',
        format('"%s" was taken down for a check, so it left your cart. Nothing was charged.', v_item.title),
        '/declutter?tab=buying', v_item.seller_id);
      PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
        format('Our automatic check flagged "%s" (%s). Someone from Louisiana Helpr will look at it. Buyers can''t see it until then.', v_item.title, v_flag),
        '/declutter?tab=selling', NULL);
    ELSE
      -- Paid (or the order is past paying): the sale stands until an admin decides; the seller's payouts wait.
      INSERT INTO public.payout_holds (helper_id, reason, held_by, held_at)
      VALUES (v_item.seller_id,
              left(format('Declutter: the automatic check flagged "%s" (%s) after it sold (order %s). Lift this hold to pay the seller, or refund the buyer.',
                          v_item.title, v_flag, COALESCE(v_line.order_id::text, 'none')), 1000),
              NULL, v_at)
      ON CONFLICT (helper_id) DO NOTHING;
      -- Every admin, never for a test account (owner 2026-10-30).
      IF NOT public.is_test_subject(v_item.seller_id) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        SELECT ur.user_id,
               'A sold Declutter listing failed its check',
               left(format('"%s" was flagged (%s) after a buyer paid. The seller''s payouts are on hold: lift the hold to pay them, or refund the buyer.', v_item.title, v_flag), 1000),
               'admin_alert',
               '/admin?view=payouts'
          FROM public.user_roles ur
         WHERE ur.role = 'admin';
      END IF;
      PERFORM public.declutter_notify(v_item.seller_id, 'declutter_listings', 'Your sale is waiting for a check',
        format('Our automatic check flagged "%s" (%s). Someone from Louisiana Helpr will look at it before you''re paid.', v_item.title, v_flag),
        '/declutter?tab=selling', NULL);
    END IF;
  END IF;

  IF v_item.status = 'pending_review' THEN
    IF v_flag IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr
                        WHERE pr.user_id = v_item.seller_id
                          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
       AND public.declutter_active_strike_count(v_item.seller_id) < 3
       AND NOT public.member_under_18(v_item.seller_id) THEN
      -- Clean: back in front of buyers, its open offers still open.
      UPDATE public.declutter_items
         SET status = 'live', updated_at = v_at
       WHERE id = p_item_id AND status = 'pending_review';
    ELSIF v_flag IS NOT NULL THEN
      -- Flagged: held for an admin, and its open offers close (buyers told, nothing charged).
      FOR r IN
        UPDATE public.declutter_offers
           SET status = 'voided', closed_at = v_at, updated_at = v_at
         WHERE item_id = p_item_id AND status = 'open'
        RETURNING id, buyer_id
      LOOP
        INSERT INTO public.declutter_offer_events (offer_id, actor_side, action) VALUES (r.id, 'system', 'void');
        PERFORM public.declutter_notify(r.buyer_id, 'declutter_offers', 'Listing changed',
          format('The seller changed "%s", so your offer is closed. Nothing was charged.', v_item.title),
          '/declutter?tab=buying', v_item.seller_id);
      END LOOP;
    END IF;
  END IF;
  RETURN v_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_ai_check(uuid, uuid, uuid[], text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Fail-safe: a listing live 15 minutes whose check never came back is held for an admin.
CREATE OR REPLACE FUNCTION public.declutter_hold_unchecked_listings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n integer := 0;
  r record;
  v_order uuid;
BEGIN
  FOR r IN
    UPDATE public.declutter_items i
       SET status = 'pending_review', updated_at = now()
     WHERE i.status = 'live'
       AND i.live_at < now() - interval '15 minutes'
       -- Review of 41771724f3 (1): an admin's approval since it went live stands (approval sets no ai_checked_at).
       AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
       -- Never checked; or flagged and back on sale (re-review of e23f131d97): a flag (or the "didn't finish" mark
       -- below) on a reserved or sold listing leaves it up while the sale stands, and if that sale falls through (the
       -- buyer removes it, 20261028221904; a missed checkout, 20261030152217) it is live again. It is held here.
       AND EXISTS (SELECT 1 FROM public.declutter_item_private pv
                    WHERE pv.item_id = i.id AND (pv.ai_checked_at IS NULL OR pv.ai_flag_reason IS NOT NULL))
    RETURNING i.id, i.seller_id, i.title,
              (SELECT pv.ai_flag_reason FROM public.declutter_item_private pv WHERE pv.item_id = i.id) AS flag
  LOOP
    v_n := v_n + 1;
    IF r.flag IS NULL OR r.flag = 'The automatic check didn''t finish.' THEN
      PERFORM public.declutter_notify(r.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
        format('Our automatic check of "%s" didn''t finish, so someone from Louisiana Helpr will look at it. Buyers can''t see it until then.', r.title),
        '/declutter?tab=selling', NULL);
    ELSE
      PERFORM public.declutter_notify(r.seller_id, 'declutter_listings', 'Your listing is waiting for a check',
        format('Our automatic check flagged "%s" (%s). Someone from Louisiana Helpr will look at it. Buyers can''t see it until then.', r.title, r.flag),
        '/declutter?tab=selling', NULL);
    END IF;
  END LOOP;

  -- Review of 62f90f3368 (3): a buyer reserved or paid for it before any check came back, and none has 15 minutes
  -- after it went live. The sale stands; the seller's payouts wait for an admin (payout_holds, which every payout
  -- path checks) and every admin is alerted, as a late flag on a sold listing does (record_ai_check). The item is
  -- marked judged ("didn't finish") so this runs once per item, and an admin's lift of the hold stays lifted; an
  -- admin approval since it went live stands. Lock order as everywhere in Declutter: items first.
  FOR r IN
    SELECT i.id, i.seller_id, i.title
      FROM public.declutter_items i
     WHERE i.status IN ('reserved', 'sold')
       AND i.live_at < now() - interval '15 minutes'
       AND (i.admin_approved_at IS NULL OR i.admin_approved_at < i.live_at)
       AND EXISTS (SELECT 1 FROM public.declutter_item_private pv WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL)
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    UPDATE public.declutter_item_private
       SET ai_checked_at = now(), ai_flag_reason = 'The automatic check didn''t finish.', updated_at = now()
     WHERE item_id = r.id AND ai_checked_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    v_n := v_n + 1;
    SELECT c.order_id INTO v_order
      FROM public.declutter_cart_items c
     WHERE c.item_id = r.id AND c.status IN ('in_cart', 'paid')
     ORDER BY c.created_at DESC LIMIT 1;
    INSERT INTO public.payout_holds (helper_id, reason, held_by, held_at)
    VALUES (r.seller_id,
            left(format('Declutter: the automatic check of "%s" didn''t finish before a buyer reserved or bought it (order %s). Lift this hold to pay the seller, or refund the buyer.',
                        r.title, COALESCE(v_order::text, 'none')), 1000),
            NULL, now())
    ON CONFLICT (helper_id) DO NOTHING;
    -- Every admin, never for a test account (owner 2026-10-30).
    IF NOT public.is_test_subject(r.seller_id) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id,
             'A sold Declutter listing was never checked',
             left(format('The automatic check of "%s" didn''t finish before a buyer reserved or bought it. The seller''s payouts are on hold: look at the listing, then lift the hold to pay them, or refund the buyer.', r.title), 1000),
             'admin_alert',
             '/admin?view=payouts'
        FROM public.user_roles ur
       WHERE ur.role = 'admin';
    END IF;
    PERFORM public.declutter_notify(r.seller_id, 'declutter_listings', 'Your sale is waiting for a check',
      format('Our automatic check of "%s" didn''t finish, so someone from Louisiana Helpr will look at it before you''re paid.', r.title),
      '/declutter?tab=selling', NULL);
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_hold_unchecked_listings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_hold_unchecked_listings() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-unchecked-hold', interval '30 minutes',
            'Declutter fail-safe, every 10 minutes: a listing live 15 minutes whose automatic photo check never came back is held for an admin and the seller told (LEAD-POST-SLOW, the check runs right after Post).',
            'exempt',
            'While every check comes back, a run that holds nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'declutter-unchecked-hold') THEN
      PERFORM cron.unschedule('declutter-unchecked-hold');
    END IF;
    PERFORM cron.schedule('declutter-unchecked-hold', '1-59/10 * * * *',
      $c$SELECT public.cron_record_work('declutter-unchecked-hold', to_jsonb(public.declutter_hold_unchecked_listings()));$c$);
  END IF;
END
$do$;
