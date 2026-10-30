-- D4-11 (gap sweep, 2026-10-29): Wanted notices never tried email. "A seller has a match" made a bell row and a push
-- and no email_send_log row, though email_declutter_wanted exists in Settings and send-notification-email maps the type.
--
-- FIX: a new helper queues the email, in its own block, so a failed email never undoes the bell or the offer:
--   * declutter_wanted_notify (the two match alerts) sends it only when the bell row landed; the seed boundary trigger
--     can drop that row, and then nothing was told and nothing is emailed;
--   * declutter_wanted_reply sends it after declutter_notify, unless a test seller is writing to a real member.
-- send-notification-email applies the member's email switches, as it does for pickup reminders and price drops.
-- Also Q2489's one ?view=offers sender: the reply notice opens ?tab=buying, because its recipient is the buyer.
--
-- RESTATED FROM (md5(prosrc) equal to prod, read 2026-10-30):
--   declutter_wanted_reply   20261030064727  0d7a9d87f1d1e48fde90b4902124abed
--   declutter_wanted_notify  20261028162048  a07cea32f4ad010082c3044f8a5e0552
-- Reply's refusals, limits, locks, the offer it writes and its grants are unchanged. Daily caps are unchanged, so email
-- volume is bounded by them: at most 5 reply alerts, 5 seller alerts and 10 poster alerts a day per member.
-- MONEY: none. REPLAY-SAFE: CREATE OR REPLACE only.
-- Proof: src/test/pglite/declutterWantedEmail.pglite.mjs (3x).

CREATE OR REPLACE FUNCTION public.declutter_wanted_email(p_user uuid, p_title text, p_message text, p_link text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_user IS NULL OR to_regnamespace('net') IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)),
    body := jsonb_build_object('user_id', p_user, 'title', p_title, 'message', public.declutter_price_words(p_message),
                               'type', 'declutter_wanted', 'link', p_link));
EXCEPTION WHEN OTHERS THEN
  -- The bell row and the offer already stand; a lost email is recorded where ops reads.
  RAISE WARNING 'declutter_wanted_email: to % not queued: %', p_user, SQLERRM;
  PERFORM public.log_cron_defect('declutter_wanted_email', COALESCE(p_user::text, '-') || ':' || COALESCE(p_title, ''), SQLERRM);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_email(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_email(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_wanted_notify(p_user uuid, p_title text, p_message text, p_link text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (p_user, 'declutter_wanted', p_title, p_message, p_link)
  RETURNING id INTO v_id;
  -- D4-11: no bell row (the seed boundary dropped it) means no email either.
  IF v_id IS NOT NULL THEN
    PERFORM public.declutter_wanted_email(p_user, p_title, p_message, p_link);
  END IF;
  RETURN CASE WHEN v_id IS NULL THEN 0 ELSE 1 END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_wanted_notify(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_notify(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_wanted_reply(p_wanted_id uuid, p_item_id uuid, p_amount_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  w public.declutter_wanted;
  i record;
  v_id uuid;
  v_message text;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF public.declutter_seller_out(v_uid) THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Item first, then the post (the offer paths lock item -> offer; nothing else locks a post then an item).
  SELECT it.id, it.seller_id, it.status, it.sale_mode, it.current_price_cents, it.title, it.is_seed,
         it.area_lat, it.area_lng INTO i
    FROM public.declutter_items it WHERE it.id = p_item_id AND it.seller_id = v_uid FOR UPDATE;
  IF i.id IS NULL OR i.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO w FROM public.declutter_wanted WHERE id = p_wanted_id FOR UPDATE;
  -- One answer for every post you may not reply to: no oracle for private, blocked or hidden posts.
  IF w.id IS NULL OR NOT w.public OR w.status <> 'open' OR w.expires_at <= now() OR w.user_id = v_uid
     OR public.are_users_blocked(v_uid, w.user_id)
     OR public.declutter_member_out(w.user_id)
     OR public.member_under_18(w.user_id)
     OR public.declutter_seller_hidden(w.user_id)
     OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())) THEN
    RAISE EXCEPTION 'wanted_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF i.status <> 'live' THEN
    RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000', HINT = 'Only a listing that is for sale now can answer.';
  END IF;
  IF i.is_seed IS TRUE AND public.seed_hidden_for(w.user_id) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- W6: inside the post's distance, measured listing to post (as the match alerts do). IS NOT TRUE: a NULL distance
  -- refuses, never skips the RAISE.
  IF (public.declutter_miles(w.area_lat, w.area_lng, i.area_lat, i.area_lng) <= w.radius_miles) IS NOT TRUE THEN
    RAISE EXCEPTION 'listing_too_far' USING ERRCODE = '22023',
      HINT = 'This listing is farther away than the buyer will travel.';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents > least(w.max_price_cents, i.current_price_cents) THEN
    RAISE EXCEPTION 'invalid_reply_amount' USING ERRCODE = '22023',
      HINT = 'Your price is at most their Wanted price and at most your listing''s price.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.wanted_id = w.id AND o.seller_id = v_uid) THEN
    RAISE EXCEPTION 'already_replied' USING ERRCODE = '23505', HINT = 'You already answered this Wanted post.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_reply:' || v_uid::text));
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.seller_id = v_uid AND o.wanted_id IS NOT NULL AND o.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'reply_rate_limited' USING ERRCODE = '54000', HINT = 'You can answer 10 Wanted posts a day.';
  END IF;
  -- Only a listing with no open offer can answer: the answer then depends on the seller's own listing only, never on
  -- WHO the poster is (an "already open between you two" refusal named the poster: review #2).
  IF EXISTS (SELECT 1 FROM public.declutter_offers o WHERE o.item_id = i.id AND o.status = 'open') THEN
    RAISE EXCEPTION 'listing_has_open_offer' USING ERRCODE = '55000', HINT = 'This listing has an open offer. Answer with another listing, or after it closes.';
  END IF;
  -- At most 5 answers a day per POST (lead ruling on review N1, 10-21): a per-poster refusal would tell a seller that
  -- two posts share one poster. With at most 10 open posts a poster, that still bounds every later notice the offer
  -- paths send (expiry, voided, closed); the per-poster bound is the silent alert cap below.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_wanted_post_answers:' || w.id::text));
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.wanted_id = w.id AND o.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'wanted_busy' USING ERRCODE = '54000', HINT = 'This post has enough answers for today. Try tomorrow.';
  END IF;
  -- The Wanted post is the poster's opening ask; the answer is the seller's counter to it (counter_count 1, a
  -- 'counter' event), so the existing offer wording ("You did not answer the counteroffer within 48 hours",
  -- "The buyer did not answer your counteroffer") is true for it.
  INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by, counter_count, wanted_id)
  VALUES (i.id, w.user_id, v_uid, p_amount_cents, 'buyer', now() + interval '48 hours', 1, w.id)
  RETURNING id INTO v_id;
  INSERT INTO public.declutter_offer_events (offer_id, actor_side, action, amount_cents)
  VALUES (v_id, 'seller', 'counter', p_amount_cents);
  -- At most 5 "match" alerts a day per poster (this one included), silently: later answers still arrive as offers,
  -- and nothing the seller sees depends on it.
  IF (SELECT count(*) FROM public.declutter_offers o
       WHERE o.buyer_id = w.user_id AND o.wanted_id IS NOT NULL AND o.created_at > now() - interval '24 hours') <= 5 THEN
    v_message := format('A seller near you has "%s" for $%s, at or under your Wanted price. Accept, counter or decline within 48 hours.',
             i.title, to_char(p_amount_cents / 100.0, 'FM999990.00'));
    -- Q2489: the poster is the buyer on this offer, so the notice opens Buying.
    PERFORM public.declutter_notify(w.user_id, 'new_offers', 'A seller has a match', v_message, '/declutter?tab=buying', v_uid);
    -- D4-11: the same words by email, under the Wanted email switch. Same rule as the writer: a test seller never
    -- reaches a real member.
    IF NOT (COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = v_uid), false)
            AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = w.user_id), false)) THEN
      PERFORM public.declutter_wanted_email(w.user_id, 'A seller has a match', v_message, '/declutter?tab=buying');
    END IF;
  END IF;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_wanted_reply(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_wanted_reply(uuid, uuid, integer) TO authenticated, service_role;
