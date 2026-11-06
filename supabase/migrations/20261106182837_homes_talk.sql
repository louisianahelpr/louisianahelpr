-- Homes A-H1 (audit ~/.lh-shots/audit-1105-homes.md, 2026-11-05; NOT-LAUNCHED Q2209, D8 "one Messages screen with a
-- Homes tab"): a member who finds a home to rent or buy messages its owner, and the owner answers. Homes stays behind
-- its switch (rentals, testers). Pattern: 20261105185006_shops_talk.sql (the same leak filter, block check, rate
-- limit and notice throttle), keyed by (listing, member): one thread per listing and member.
--
-- What this adds (server slice 1; the report type, Download My Data and purge sections, and the screens follow):
--   1. home_talks (one per listing + member) and home_talk_messages. RLS on, no member grant; the RPCs are the only
--      way in.
--   2. home_talk_listing_ok(listing): the thread stays open while the listing is live, paused or leased (a renter who
--      signed still talks to the landlord) and its owner is in good standing; removed (by the owner or an admin) or a
--      banned owner closes it.
--   3. rentals_open_talk(listing): the member's thread with a listing they can see (rentals_listing_visible: live, not
--      expired, ownership approved, owner not banned), made on first use; never their own listing.
--   4. rentals_talk_view(talk): the caller's side, the other side's first name only, the listing's headline and kind,
--      whether it is open, and the history, each message "mine" or not (no ids of people).
--   5. rentals_send_talk_message(talk, body): either side, while open and neither has blocked the other;
--      contact_leak_reason (owner Q49: phone numbers and emails stay out of Homes messages); 30 an hour; the other side
--      is told at most once per 15 minutes, never the words. The notice links to the listing with ?talk=<id>.
--   6. rentals_my_talks(): the caller's threads for Messages -> Homes, newest first, both sides.
--   7. rentals_mark_talk_read(talk): the caller's read mark, so the inbox can show unread.
-- Fair housing (42 U.S.C. 3604(c); La. R.S. 51:2606(A)(3)): the owner sees only the member's first name, never a photo,
-- age or any other profile field, so the first contact gives no protected trait beyond what a first name says.
-- Every RPC starts with require_feature('rentals'). MONEY: none.
-- REPLAY-SAFE: CREATE TABLE / INDEX IF NOT EXISTS, triggers dropped then created, CREATE OR REPLACE.
-- Proof: src/test/pglite/homesTalk.pglite.mjs (3x, Supabase's default anon grant emulated).

-- 1. The thread and its messages.
CREATE TABLE IF NOT EXISTS public.home_talks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.rental_listings(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  member_notified_at timestamptz,
  owner_notified_at timestamptz,
  member_read_at timestamptz,
  owner_read_at timestamptz,
  CONSTRAINT home_talks_one_per_pair UNIQUE (listing_id, member_id)
);
CREATE INDEX IF NOT EXISTS home_talks_member_idx ON public.home_talks (member_id);
ALTER TABLE public.home_talks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.home_talks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.home_talks TO service_role;

CREATE TABLE IF NOT EXISTS public.home_talk_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talk_id uuid NOT NULL REFERENCES public.home_talks(id) ON DELETE CASCADE,
  -- The side is kept, so a message still reads as the owner's or the member's after its sender deletes their account.
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_side text NOT NULL CHECK (sender_side IN ('member', 'owner')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS home_talk_messages_talk_idx ON public.home_talk_messages (talk_id, created_at);
CREATE INDEX IF NOT EXISTS home_talk_messages_sender_idx ON public.home_talk_messages (sender_id, created_at);
ALTER TABLE public.home_talk_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.home_talk_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.home_talk_messages TO service_role;

-- Q807: writes from an unconfirmed email are refused on every public table (the gate's own statement trigger).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The contact-leak filter, as on listings, questions, the Declutter chats and Shops (contact_leak_reason).
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_home_talk()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text := public.contact_leak_reason(NEW.body);
BEGIN
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in the message. Keep phone numbers, emails and payment out of the chat; Louisiana Helpr does not allow contact details in Homes messages.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_home_talk() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_home_talk ON public.home_talk_messages;
CREATE TRIGGER trg_reject_contact_leak_in_home_talk
  BEFORE INSERT OR UPDATE OF body ON public.home_talk_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_home_talk();

-- The caller's side of a thread: 'member', 'owner' (the listing's owner), or NULL.
CREATE OR REPLACE FUNCTION public.home_talk_side(p_talk_id uuid, p_uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_uid IS NULL THEN NULL
              WHEN t.member_id = p_uid THEN 'member'
              WHEN l.owner_id = p_uid THEN 'owner' END
    FROM public.home_talks t JOIN public.rental_listings l ON l.id = t.listing_id
   WHERE t.id = p_talk_id;
$fn$;
REVOKE ALL ON FUNCTION public.home_talk_side(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.home_talk_side(uuid, uuid) TO service_role;

-- 2. Whether a listing's threads are open: live, paused or leased, and its owner in good standing.
CREATE OR REPLACE FUNCTION public.home_talk_listing_ok(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.rental_listings l
     WHERE l.id = p_listing_id
       AND l.status IN ('live', 'paused', 'leased')
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr
                        WHERE pr.user_id = l.owner_id
                          AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                          AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL
                               OR pr.auto_suspended_until > now())));
$fn$;
REVOKE ALL ON FUNCTION public.home_talk_listing_ok(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.home_talk_listing_ok(uuid) TO service_role;

-- 3. Open (or find) the caller's thread with a listing they can see.
CREATE OR REPLACE FUNCTION public.rentals_open_talk(p_listing_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT owner_id INTO v_owner FROM public.rental_listings WHERE id = p_listing_id;
  IF v_owner IS NULL OR NOT public.rentals_listing_visible(p_listing_id) THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_listing' USING ERRCODE = '22023';
  END IF;
  IF public.are_users_blocked(v_uid, v_owner) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.home_talks (listing_id, member_id) VALUES (p_listing_id, v_uid)
  ON CONFLICT (listing_id, member_id) DO NOTHING;
  SELECT id INTO v_id FROM public.home_talks WHERE listing_id = p_listing_id AND member_id = v_uid;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_open_talk(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_open_talk(uuid) TO authenticated, service_role;

-- 4. The thread as the caller sees it.
CREATE OR REPLACE FUNCTION public.rentals_talk_view(p_talk_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.home_talks%ROWTYPE;
  l public.rental_listings%ROWTYPE;
  v_side text;
  v_messages jsonb;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_side := public.home_talk_side(p_talk_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'talk_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO t FROM public.home_talks WHERE id = p_talk_id;
  SELECT * INTO l FROM public.rental_listings WHERE id = t.listing_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_side = v_side, 'body', m.body, 'created_at', m.created_at)
                            ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO v_messages
    FROM public.home_talk_messages m WHERE m.talk_id = t.id;
  RETURN jsonb_build_object(
    'talk_id', t.id,
    'listing_id', l.id,
    'listing_headline', l.headline,
    'listing_kind', l.kind,
    'side', v_side,
    -- The other side's first name only (never a full name, photo or id).
    'other_label', CASE WHEN v_side = 'member'
                        THEN COALESCE(NULLIF(split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = l.owner_id)), ' ', 1), ''), 'The owner')
                        ELSE COALESCE(NULLIF(split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = t.member_id)), ' ', 1), ''), 'A member') END,
    'open', public.home_talk_listing_ok(l.id) AND NOT public.are_users_blocked(t.member_id, l.owner_id),
    'messages', v_messages);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_talk_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_talk_view(uuid) TO authenticated, service_role;

-- 5. A message.
CREATE OR REPLACE FUNCTION public.rentals_send_talk_message(p_talk_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.home_talks%ROWTYPE;
  l public.rental_listings%ROWTYPE;
  v_side text;
  v_body text := btrim(COALESCE(p_body, ''));
  v_id uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Membership before any lock: a stranger never locks someone else's thread.
  v_side := public.home_talk_side(p_talk_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'talk_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO t FROM public.home_talks WHERE id = p_talk_id FOR UPDATE;
  SELECT * INTO l FROM public.rental_listings WHERE id = t.listing_id;
  IF NOT public.home_talk_listing_ok(l.id) THEN
    RAISE EXCEPTION 'talk_closed' USING ERRCODE = '22023', HINT = 'This home is not on Helpr right now.';
  END IF;
  IF public.are_users_blocked(t.member_id, l.owner_id) THEN
    RAISE EXCEPTION 'talk_blocked' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023', HINT = 'Write a message of up to 1,000 characters.';
  END IF;
  IF (SELECT count(*) FROM public.home_talk_messages m
       WHERE m.talk_id = t.id AND m.sender_id = v_uid AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'message_rate_limited' USING ERRCODE = '42501', HINT = 'Slow down a little, then send again.';
  END IF;
  INSERT INTO public.home_talk_messages (talk_id, sender_id, sender_side, body)
  VALUES (t.id, v_uid, v_side, v_body)
  RETURNING id INTO v_id;
  -- The sender has read everything up to their own message.
  UPDATE public.home_talks
     SET member_read_at = CASE WHEN v_side = 'member' THEN now() ELSE member_read_at END,
         owner_read_at = CASE WHEN v_side = 'owner' THEN now() ELSE owner_read_at END
   WHERE id = t.id;
  -- Tell the other side, at most once per 15 minutes, never with the words themselves.
  IF v_side = 'member' AND (t.owner_notified_at IS NULL OR t.owner_notified_at < now() - interval '15 minutes') THEN
    PERFORM public.declutter_notify(l.owner_id, 'info', 'New message about your home',
      format('Someone sent a message about %s.', l.headline), '/rentals/listings/' || l.id::text || '?talk=' || t.id::text, v_uid);
    UPDATE public.home_talks SET owner_notified_at = now() WHERE id = t.id;
  ELSIF v_side = 'owner' AND (t.member_notified_at IS NULL OR t.member_notified_at < now() - interval '15 minutes') THEN
    PERFORM public.declutter_notify(t.member_id, 'info', 'New message about a home',
      format('The owner of %s answered you.', l.headline), '/rentals/listings/' || l.id::text || '?talk=' || t.id::text, v_uid);
    UPDATE public.home_talks SET member_notified_at = now() WHERE id = t.id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_send_talk_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_send_talk_message(uuid, text) TO authenticated, service_role;

-- 6. The caller's threads for Messages -> Homes: one row per thread that has a message, newest first, both sides.
CREATE OR REPLACE FUNCTION public.rentals_my_talks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.last_at DESC, x.talk_id)
      FROM (
        SELECT t.id AS talk_id,
               l.id AS listing_id,
               l.headline AS listing_headline,
               CASE WHEN t.member_id = v_uid THEN 'member' ELSE 'owner' END AS side,
               CASE WHEN t.member_id = v_uid
                    THEN COALESCE(NULLIF(split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = l.owner_id)), ' ', 1), ''), 'The owner')
                    ELSE COALESCE(NULLIF(split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = t.member_id)), ' ', 1), ''), 'A member') END AS other_label,
               last.created_at AS last_at,
               last.sender_side = CASE WHEN t.member_id = v_uid THEN 'member' ELSE 'owner' END AS last_mine,
               last.created_at > COALESCE(CASE WHEN t.member_id = v_uid THEN t.member_read_at ELSE t.owner_read_at END, '-infinity'::timestamptz)
                 AND last.sender_side <> CASE WHEN t.member_id = v_uid THEN 'member' ELSE 'owner' END AS unread
          FROM public.home_talks t
          JOIN public.rental_listings l ON l.id = t.listing_id
          CROSS JOIN LATERAL (
            SELECT m.created_at, m.sender_side FROM public.home_talk_messages m
             WHERE m.talk_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) last
         WHERE t.member_id = v_uid OR l.owner_id = v_uid
         ORDER BY last.created_at DESC
         LIMIT 50) x), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_my_talks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_my_talks() TO authenticated, service_role;

-- 7. The caller has read the thread.
CREATE OR REPLACE FUNCTION public.rentals_mark_talk_read(p_talk_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_side text;
BEGIN
  PERFORM public.require_feature('rentals');
  v_side := public.home_talk_side(p_talk_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'talk_not_found' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.home_talks
     SET member_read_at = CASE WHEN v_side = 'member' THEN now() ELSE member_read_at END,
         owner_read_at = CASE WHEN v_side = 'owner' THEN now() ELSE owner_read_at END
   WHERE id = p_talk_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_mark_talk_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_mark_talk_read(uuid) TO authenticated, service_role;
