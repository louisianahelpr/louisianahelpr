-- Payout setup only when money is owed (owner 2026-10-27, firm: "no one
-- should have this option [setting up payouts early]. This is how Stripe got
-- paused, because so many rejected users. So only do it when necessary.";
-- decided the same day: Declutter "list first, set up at first sale", Shops the
-- same, Rentals out).
--
-- Before (prod, measured 2026-10-27): payout_setup_hire_allowed let anyone with
-- the declutter, shops or rentals switch on open a Connect account before
-- anything sold; and Declutter listing (row 23), relisting, opening a shop and
-- taking a Declutter delivery all REQUIRED a ready payout account. Narrowing
-- the first without the second would have locked every new seller out: no
-- listing without setup, no setup without a sale.
--
-- After:
--   - payout_setup_hire_allowed: hires as before (a job or crew seat holding
--     money, an accept waiting on setup, fees and transfers owed); a seller
--     only with a Declutter order paid or handed over (or a Declutter payout
--     recorded), a Shops order captured and not fully refunded (or a Shops
--     payout recorded), or a Declutter delivery they took (or its pay).
--     The declutter / shops / rentals switch lines are gone.
--   - declutter_publish_item, declutter_relist_listing: no payout gate.
--   - shops_assert_owner_eligible, shop_owner_sell_block_reason: no payout gate.
--   - declutter_admin_review_item: approving a listing no longer refuses a
--     seller without payouts (seller_not_eligible keeps restricted, strikes,
--     age).
--   - helpr_task_assert_helpr (seeing, viewing and taking a Declutter
--     delivery): no payout gate (owner 2026-10-27: anyone takes a delivery
--     without payout setup and sets up after). Independent money review
--     2026-10-27: without this, narrowing payout_setup_hire_allowed locked every
--     new delivery Helpr out (no delivery without a ready account, no account
--     without a delivery taken), because this gate reads helper_award_block_reason,
--     which ignores the payout_after_hire switch. A taken delivery then makes
--     them eligible (helpr_tasks accepted onward, or helpr_task_payouts), and
--     declutter-money defers their pay (no_account) until they set up.
--     ready/declutter-delivery-open-1027 (20261027165232, newer) restates it
--     on the payout_after_hire switch instead; whichever lands, the newest
--     body has no hard payout gate (src/test/payoutSetupOnlyWhenOwed.test.ts).
--   The proceeds wait: declutter-money already defers a payout whose payee has
--   no account ("the payee has not set up payouts") and reminds the payee
--   through payout_payee_wait_seen.
--
-- Every body is restated from prod (pg_get_functiondef, 2026-10-27; prosrc md5:
--   declutter_publish_item a6b574c14f0e76d2e99e81af79682d3a
--   declutter_relist_listing cfb4514af704129319793eaab73582b8
--   shop_owner_sell_block_reason 1ad334d8a320bf8a40862359ef8f3666
--   shops_assert_owner_eligible 87077f4521bf36c7c48a6fbb2287456e
--   payout_setup_hire_allowed 756f33f69f14b2500af0484fd8a7d0b4
--   declutter_admin_review_item cff9d6922618e7b718d0d8aef03ca388
--   helpr_task_assert_helpr 9ca10758ce71d18481ccbdab653e023b)
-- with only those changes. CREATE OR REPLACE keeps each function's grants.
-- Replay-safe. Proof: src/test/pglite/payoutSetupOnlyWhenOwed.pglite.mjs.
-- Guard: src/test/payoutSetupOnlyWhenOwed.test.ts.

CREATE OR REPLACE FUNCTION public.payout_setup_hire_allowed(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_user_id IS NOT NULL AND (
       -- the Helpr on a job that holds money
       EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.helper_id = p_user_id
                  AND public.job_payment_is_funded(j.payment_status::text))
       -- a crew seat on a job that holds money
    OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                 JOIN public.jobs j ON j.id = g.job_id
                WHERE g.helper_id = p_user_id
                  AND public.job_payment_is_funded(j.payment_status::text))
       -- an accept that waits on their setup (switch off), on a job that still holds money
    OR EXISTS (SELECT 1 FROM public.job_accept_pending a
                 JOIN public.jobs j ON j.id = a.job_id
                WHERE a.helper_id = p_user_id
                  AND public.job_payment_is_funded(j.payment_status::text))
       -- a cancellation fee owed or paid to them (single or crew), a crew
       -- block fee: server-written money rows, so a poster cannot fake one
       -- (lh-authz-rls #4, lh-money-escrow #2)
    OR EXISTS (SELECT 1 FROM public.cancellation_fee_transfers c WHERE c.helper_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.crew_cancellation_fee_shares c WHERE c.helper_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.crew_block_fees c WHERE c.helper_id = p_user_id)
       -- money already recorded to them
    OR EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.helper_id = p_user_id)
       -- Owner 2026-10-27: a seller only when money is owed to them, never for
       -- a listing or a shop alone. Rentals moves no money through us, so it
       -- gives no access.
       -- a Declutter sale paid (or handed over) and holding money for them
    OR EXISTS (SELECT 1 FROM public.declutter_orders o
                WHERE o.seller_id = p_user_id AND o.status IN ('paid', 'handed_over'))
    OR EXISTS (SELECT 1 FROM public.declutter_payouts dp WHERE dp.seller_id = p_user_id)
       -- a Shops order whose card was captured and not refunded in full
    OR EXISTS (SELECT 1 FROM public.shop_orders so
                WHERE so.seller_id = p_user_id AND so.captured_at IS NOT NULL
                  AND so.status IN ('accepted', 'handed_over', 'partially_refunded'))
    OR EXISTS (SELECT 1 FROM public.shop_payouts sp JOIN public.shop_orders so ON so.id = sp.order_id
                WHERE so.seller_id = p_user_id)
       -- a Declutter delivery they took (the order behind it is paid), or its pay
    OR EXISTS (SELECT 1 FROM public.helpr_tasks ht
                WHERE ht.helpr_id = p_user_id AND ht.status IN ('accepted', 'picked_up', 'delivered', 'confirmed'))
    OR EXISTS (SELECT 1 FROM public.helpr_task_payouts hp WHERE hp.helpr_id = p_user_id)
  );
$function$;

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
  v_approved integer;
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

  -- Row 33: until 3 of the seller's listings have an admin's OK, each waits.
  -- Row 34 / B19: so does any listing the AI flagged or never checked.
  SELECT count(*)::integer INTO v_approved
    FROM public.declutter_items
   WHERE seller_id = v_uid AND admin_approved_at IS NOT NULL;
  v_status := CASE
    WHEN v_approved < 3 THEN 'pending_review'
    WHEN v_ai_checked IS NULL OR v_ai_flag IS NOT NULL THEN 'pending_review'
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

CREATE OR REPLACE FUNCTION public.declutter_relist_listing(p_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status <> 'paused' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- Publish's own checks (authz review 7): a pickup time on file. (No payout
  -- setup: owner 2026-10-27, list first, set up at first sale.)
  IF NOT EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = v_uid) THEN
    RAISE EXCEPTION 'pickup_windows_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.declutter_items SET status = 'live', updated_at = now() WHERE id = p_item_id;
  RETURN 'live';
END;
$function$;

CREATE OR REPLACE FUNCTION public.shop_owner_sell_block_reason(p_owner_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_owner_id IS NULL THEN 'no_owner'
    WHEN EXISTS (SELECT 1 FROM public.profiles pr
                  WHERE pr.user_id = p_owner_id
                    AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                    AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
      THEN 'account_restricted'
    WHEN public.shop_active_strike_count(p_owner_id) >= 3 THEN 'shop_strikes_blocked'
    WHEN public.member_under_18(p_owner_id) THEN 'under_18'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.shops_assert_owner_eligible()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted'
      USING ERRCODE = '42501', HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to have a shop.';
  END IF;
  -- Per section (owner 2026-10-18, overrides L45): Shops strikes only.
  IF public.shop_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'shop_strikes_blocked'
      USING ERRCODE = '42501', HINT = 'You have 3 Shops strikes. Shops open again when one expires.';
  END IF;
  -- L3 (payout setup before opening) is dropped: owner 2026-10-27, the same
  -- rule as Declutter. A captured order makes the owner eligible to set up.
  RETURN v_uid;
END;
$function$;


CREATE OR REPLACE FUNCTION public.declutter_admin_review_item(p_item_id uuid, p_approve boolean, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seller uuid;
  v_status text;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required'
      USING ERRCODE = '22023', HINT = 'Say why the listing is not approved.';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT seller_id INTO v_seller FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = 'P0002';
  END IF;
  -- lh-authz-rls review must-fix 1: an admin never reviews their own listing.
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_listing' USING ERRCODE = '42501', HINT = 'Another admin must review your own listing.';
  END IF;
  -- Must-fix 2: approval puts the listing in front of buyers NOW, so the
  -- seller must still be allowed to sell now: not banned, fewer than 3
  -- active Declutter strikes, not under 18, payout setup done.
  IF p_approve AND (
       EXISTS (SELECT 1 FROM public.profiles pr
                WHERE pr.user_id = v_seller
                  AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                  AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
       OR public.declutter_active_strike_count(v_seller) >= 3
       OR public.member_under_18(v_seller)) THEN
    -- No payout check (owner 2026-10-27, list first, set up at first sale).
    RAISE EXCEPTION 'seller_not_eligible'
      USING ERRCODE = '22023', HINT = 'The seller cannot sell right now (restricted, strikes or age). Reject it instead.';
  END IF;

  v_status := CASE WHEN p_approve THEN 'live' ELSE 'rejected' END;
  UPDATE public.declutter_items
     SET status = v_status,
         admin_approved_at = CASE WHEN p_approve THEN now() ELSE admin_approved_at END,
         live_at = CASE WHEN p_approve THEN now() ELSE live_at END,
         updated_at = now()
   WHERE id = p_item_id AND status = 'pending_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.declutter_item_private SET review_note = v_note, updated_at = now() WHERE item_id = p_item_id;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'declutter_listing_approved' ELSE 'declutter_listing_rejected' END,
          'declutter_item', p_item_id::text, jsonb_build_object('note', v_note));
  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.helpr_task_assert_helpr()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to deliver.';
  END IF;
  IF public.declutter_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'declutter_strikes_blocked' USING ERRCODE = '42501';
  END IF;
  -- No payout check (owner 2026-10-27): the delivery is taken first, payouts
  -- are set up after, and the pay waits for the account.
  RETURN v_uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_assert_helpr() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_assert_helpr() TO service_role;

-- Grants restated for the function whose callers are checked by role
-- (unchanged: service_role only; the _for_me twin answers for the caller).
REVOKE ALL ON FUNCTION public.payout_setup_hire_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_setup_hire_allowed(uuid) TO service_role;
COMMENT ON FUNCTION public.payout_setup_hire_allowed(uuid) IS
  'May this member open or finish a payout account (owner 2026-10-25, narrowed 2026-10-27: only when money is owed)? True for a job or crew seat that holds money, an accept waiting on setup, a cancellation or crew fee owed, a payout recorded, a Declutter order paid or handed over (or a Declutter payout), a Shops order captured and not fully refunded (or a Shops payout), or a Declutter delivery taken (or its pay). No section switch grants it. service_role only; the _for_me twin answers for the caller.';
