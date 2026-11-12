-- Shops audit 2 (11-12): S2-001 the server checks a shop item the app never checked; S2-018 a chat about a custom
-- request.
--
-- S2-001 WHY
--   A shop item's AI photo check runs only when the owner's editor asks for it (Publish, and since S009 a photo
--   change on a live item). If the check never answers (network drop, busy model, the app closed) or a client skips
--   it, the item stays live with no check, and nothing on the server ever looks again. Declutter has a server sweep
--   for exactly this (20261101031241, LEAD-CHECK-SWEEP); Shops had none.
-- S2-001 WHAT
--   1. shop_item_private.ai_check_attempts / ai_check_last_try_at, reset whenever ai_checked_at changes (a verdict,
--      or the S009 photo trigger clearing it), exactly as Declutter's.
--   2. shops_check_sweep_claim(p_limit) (service role only): FIRST holds every live item whose check failed 3 server
--      tries (pending_review for an admin, off the shop, owner told, marked "didn't finish" so it happens once), THEN
--      claims up to p_limit live items due a check (live 5+ minutes, no verdict, under 3 tries, last try 4.5+ minutes
--      ago, no admin approval since it went live, never test data), counting the try first, and returns each item's
--      owner FROM THE ROW. shops_check_sweep_give_back(p_item_id) gives a try back (our fault / busy / stale), as
--      Declutter's does.
--   3. No new cron: the existing declutter-check-sweep run (every 5 minutes, declutter-ai-draft mode check_sweep)
--      claims shop items too and records each verdict through shops_record_item_ai_check, as the app does.
--   Owner rule kept (10-31): an item is never held just because a check has not run yet; only after 3 failed tries.
--
-- S2-018 WHY
--   Neither side could ask a question about a custom request: the shop could only send a price or decline, and the
--   server refuses a chat opened by a shop owner on their own shop (shops_open_talk: own_shop).
-- S2-018 WHAT
--   shops_open_request_talk(p_request_id): either side of a custom request opens the same ONE thread per shop and
--   member (shop_talks), like shops_open_order_talk (20261105225245). Same refusals: switch, sign-in, restricted
--   account, not a side (request_not_found), own shop, a shop the shop-state rule hides (talk_closed), a block.
--
-- S2-026 (Suggestion): a closed shop chat said only "This chat is closed." shops_talk_view (restated from its
--   NEWEST CREATE, 20261112052501) adds shop_off = the shop-state rule closed it, so the sheet can say "This shop
--   isn't on Helpr right now"; a block is never named (it stays the plain closed line).
--
-- Grants by role name. Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

-- ---------------------------------------------------------------------------
-- S2-001 1. Tries.
ALTER TABLE public.shop_item_private ADD COLUMN IF NOT EXISTS ai_check_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.shop_item_private ADD COLUMN IF NOT EXISTS ai_check_last_try_at timestamptz;

CREATE OR REPLACE FUNCTION public.shop_item_private_check_tries_reset()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- A verdict recorded, or a photo change cleared it: the item as it is now gets 3 fresh tries, and the clock
  -- restarts so the editor's own check gets its 5 minutes first.
  IF NEW.ai_checked_at IS DISTINCT FROM OLD.ai_checked_at THEN
    NEW.ai_check_attempts := 0;
    NEW.ai_check_last_try_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.shop_item_private_check_tries_reset() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS shop_item_private_check_tries_reset ON public.shop_item_private;
CREATE TRIGGER shop_item_private_check_tries_reset
  BEFORE UPDATE OF ai_checked_at ON public.shop_item_private
  FOR EACH ROW EXECUTE FUNCTION public.shop_item_private_check_tries_reset();

-- ---------------------------------------------------------------------------
-- S2-001 2. The hold after 3 failed tries, then the claim.
CREATE OR REPLACE FUNCTION public.shops_check_sweep_claim(p_limit integer DEFAULT 5)
 RETURNS TABLE (sweep_item_id uuid, sweep_owner_id uuid, sweep_attempt integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_at timestamptz := now();
BEGIN
  -- Review (authz should-fix 2): tries made before the item last went live say nothing about it now (taken down and
  -- published again: publish leaves an empty verdict empty, so the reset trigger does not fire). They start over.
  UPDATE public.shop_item_private pv
     SET ai_check_attempts = 0
    FROM public.shop_items i
   WHERE i.id = pv.item_id
     AND pv.ai_checked_at IS NULL
     AND pv.ai_check_attempts > 0
     AND i.live_at IS NOT NULL
     AND (pv.ai_check_last_try_at IS NULL OR pv.ai_check_last_try_at < i.live_at);

  -- The fail-safe: 3 server tries failed and the last one had its run. Off the shop for an admin (as a flagged live
  -- item, shops_record_item_ai_check), marked judged "didn't finish" so it is held once, and the owner is told.
  -- Orders already placed stand. An admin's approval clears it the usual way.
  FOR r IN
    SELECT i.id, i.owner_id, i.title
      FROM public.shop_items i
      JOIN public.shop_item_private pv ON pv.item_id = i.id
     WHERE i.status = 'live'
       AND pv.ai_checked_at IS NULL
       AND pv.ai_check_attempts >= 3
       AND pv.ai_check_last_try_at < v_at - interval '270 seconds'
       AND i.admin_approved_at IS NULL
       -- The same items the claim tries (review should-fix 2), and never a shop the shop-state rule hides: its photos
       -- sit in the private held bucket (Q1957), so a check there fails for our reason, not the item's (must-fix 1).
       AND NOT i.is_seed
       AND NOT public.is_test_subject(i.owner_id)
       AND public.shop_state_ok(i.shop_id)
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    UPDATE public.shop_items
       SET status = 'pending_review', submitted_at = v_at, live_at = NULL, updated_at = v_at
     WHERE id = r.id AND status = 'live';
    UPDATE public.shop_item_private
       SET ai_checked_at = v_at, ai_flag_reason = 'The automatic check didn''t finish.', updated_at = v_at
     WHERE item_id = r.id AND ai_checked_at IS NULL;
    PERFORM public.declutter_notify(r.owner_id, 'info', 'Your item is waiting for a check',
      left(format('Our automatic check of "%s" didn''t finish, so our team will look at it. Buyers can''t see it until then.',
                  r.title), 1000), '/shops/mine');
  END LOOP;

  FOR r IN
    SELECT pv.item_id, i.owner_id
      FROM public.shop_item_private pv
      JOIN public.shop_items i ON i.id = pv.item_id
     WHERE pv.ai_checked_at IS NULL
       AND pv.ai_check_attempts < 3
       -- 4.5, not 5: the cron runs every 5 minutes and a strict 5 would skip every other run on timing jitter.
       AND (pv.ai_check_last_try_at IS NULL OR pv.ai_check_last_try_at < v_at - interval '270 seconds')
       -- The editor's own check right after Publish (or a photo change) gets 5 minutes first.
       AND i.status = 'live'
       AND i.live_at IS NOT NULL
       AND i.live_at < v_at - interval '5 minutes'
       -- What shops_record_item_ai_check will judge: live, never approved by an admin since (it needs
       -- admin_approved_at NULL for a live item).
       AND i.admin_approved_at IS NULL
       -- Never test data (owner 10-30: test data never reaches the owner; no model cost on it).
       AND NOT i.is_seed
       AND NOT public.is_test_subject(i.owner_id)
       -- Review must-fix 1: never a hidden / held shop (its photos are not readable; it is not on sale anyway).
       AND public.shop_state_ok(i.shop_id)
     ORDER BY i.live_at
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)
     FOR UPDATE OF pv SKIP LOCKED
  LOOP
    UPDATE public.shop_item_private
       SET ai_check_attempts = ai_check_attempts + 1, ai_check_last_try_at = v_at, updated_at = v_at
     WHERE item_id = r.item_id
    RETURNING ai_check_attempts INTO sweep_attempt;
    sweep_item_id := r.item_id;
    sweep_owner_id := r.owner_id;
    RETURN NEXT;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.shops_check_sweep_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_check_sweep_claim(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.shops_check_sweep_give_back(p_item_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_left integer;
BEGIN
  UPDATE public.shop_item_private
     SET ai_check_attempts = GREATEST(ai_check_attempts - 1, 0)
   WHERE item_id = p_item_id AND ai_checked_at IS NULL
  RETURNING ai_check_attempts INTO v_left;
  RETURN v_left;
END;
$function$;
REVOKE ALL ON FUNCTION public.shops_check_sweep_give_back(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_check_sweep_give_back(uuid) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    UPDATE public.cron_work_expectations
       SET note = 'Photo check sweep, every 5 minutes: declutter-ai-draft, mode check_sweep, checks live Declutter listings and live shop items (S2-001) whose check from the app never landed; after 3 failed tries the fail-safe holds it. LEAD-CHECK-SWEEP.'
     WHERE jobname = 'declutter-check-sweep';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- S2-018. A chat about a custom request, for either side.
CREATE OR REPLACE FUNCTION public.shops_open_request_talk(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  q public.shop_custom_requests%ROWTYPE;
  v_owner uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO q FROM public.shop_custom_requests WHERE id = p_request_id;
  IF FOUND THEN
    SELECT owner_id INTO v_owner FROM public.shops WHERE id = q.shop_id;
  END IF;
  -- Only the request's buyer or the shop's owner; a stranger or a gone shop reads as not found.
  IF q.id IS NULL OR v_owner IS NULL OR q.buyer_id IS NULL
     OR (v_uid IS DISTINCT FROM q.buyer_id AND v_uid IS DISTINCT FROM v_owner) THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF q.buyer_id = v_owner THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  IF NOT public.shop_state_ok(q.shop_id) THEN
    RAISE EXCEPTION 'talk_closed' USING ERRCODE = '22023', HINT = 'This shop is not on Helpr right now.';
  END IF;
  IF public.are_users_blocked(q.buyer_id, v_owner) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.shop_talks (shop_id, buyer_id) VALUES (q.shop_id, q.buyer_id)
  ON CONFLICT (shop_id, buyer_id) DO NOTHING;
  SELECT id INTO v_id FROM public.shop_talks WHERE shop_id = q.shop_id AND buyer_id = q.buyer_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_open_request_talk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_open_request_talk(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- S2-026. Why a closed chat is closed (the shop's state only; never a block).
CREATE OR REPLACE FUNCTION public.shops_talk_view(p_talk_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.shop_talks%ROWTYPE;
  s public.shops%ROWTYPE;
  v_side text;
  v_messages jsonb;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_side := public.shop_talk_side(p_talk_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'talk_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO t FROM public.shop_talks WHERE id = p_talk_id;
  SELECT * INTO s FROM public.shops WHERE id = t.shop_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_side = v_side, 'body', m.body, 'created_at', m.created_at)
                            ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO v_messages
    FROM public.shop_talk_messages m WHERE m.talk_id = t.id;
  RETURN jsonb_build_object(
    'talk_id', t.id,
    'shop_id', s.id,
    'side', v_side,
    -- The shop's name for the member; the member's first name for the shop (never a full name or an id).
    'other_label', CASE WHEN v_side = 'buyer' THEN s.name
                        -- CHANGED 20261112052501: no first name across a block or a ban (either side).
                        WHEN public.declutter_names_hidden(s.owner_id, t.buyer_id) THEN 'A shopper'
                        ELSE COALESCE(NULLIF(split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = t.buyer_id)), ' ', 1), ''), 'A shopper') END,
    -- CHANGED (Q1947): the shop-state rule every viewer shares, as the send refuses by it.
    'open', public.shop_state_ok(s.id) AND NOT public.are_users_blocked(t.buyer_id, s.owner_id),
    -- NEW (S2-026, 20261112223654): why a closed chat is closed, when the reason is the shop's own state (hidden,
    -- paused off Helpr, the owner's standing). A block is never named: it stays the plain "closed".
    'shop_off', NOT public.shop_state_ok(s.id),
    'messages', v_messages);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_talk_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_talk_view(uuid) TO authenticated, service_role;
