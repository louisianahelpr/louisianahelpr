-- Q2414: approving or rejecting a Declutter listing tells the seller (bell +
-- push through declutter_notify). Restated from the newest body
-- (20261027163240_payout_setup_only_when_owed.sql) with only the notice added.

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
  v_title text;
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
  -- Q2414 (owner walkthrough 2026-10-27): the seller hears the decision, as the
  -- Selling tab promises. Through declutter_notify (bell + push, respects prefs).
  SELECT title INTO v_title FROM public.declutter_items WHERE id = p_item_id;
  IF p_approve THEN
    PERFORM public.declutter_notify(v_seller, 'info', 'Your listing is live',
      '"' || COALESCE(v_title, 'Your item') || '" is approved. Buyers can see it now.',
      '/declutter?view=selling', v_uid);
  ELSE
    PERFORM public.declutter_notify(v_seller, 'info', 'Your listing needs a change',
      '"' || COALESCE(v_title, 'Your item') || '" wasn''t approved: ' || v_note,
      '/declutter?view=selling', v_uid);
  END IF;
  RETURN v_status;
END;
$function$;
