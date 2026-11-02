-- Declutter manager mode, phase 1: data and access (owner 11-01 9:54 AM pop-up, "Manage my Declutter for me";
-- additions 9:56 AM per-part permissions and 10:00 AM percent-or-flat share, through the lead).
--
-- The owner's case: her sister Kaci (the SELLER) asks the owner (the MANAGER) to run her Declutter for her. The
-- manager lists Kaci's items, answers her buyers' messages and offers and handles her pickups, all AS KACI'S listings
-- (listings keep showing the seller's name), and each sale's item money is split between them (phase 2, money).
--
-- How it starts (lead decision 11-01, not a $0 job: a direct offer on jobs needs a funded escrow job): the seller
-- sends ONE private direct offer, a declutter_manager_grants row with status 'offered', naming the person, the
-- manager's share (a % of each sale's item price, or a flat amount per sold item, capped at the item price at
-- checkout), and which parts the manager handles, each its own on/off:
--   can_list      create, edit and add photos to drafts and send them to the seller for her OK (owner 11-01: the
--                 manager never posts; the seller approves and attests, or sends it back), and edit live listings
--   can_prices    price changes and automatic price drops
--   can_offers    answer offers (accept, counter, decline) and set offer rules
--   can_messages  answer buyers' questions and write in the seller's order conversations
--   can_pickups   pickup times and the handover steps of the seller's orders
-- The person accepts or declines; the seller (or the manager) ends it at any time, and the seller can change the
-- parts later. One open (offered or active) grant per seller.
--
-- How the manager acts: one RPC, declutter_manage(p_seller, p_action, p_args). It checks that the caller is the
-- ACTIVE manager of p_seller, that the action's own permission is on, that the target (item, offer, order, question)
-- is the SELLER'S SELLING side (never her buying side), and that the manager is not restricted. Then it runs the
-- seller's own RPC for that action AS THE SELLER (request.jwt.claim.sub and request.jwt.claims.sub set to the
-- seller for this call only, restored after, and rolled back with any error), so every rule the seller's own button
-- obeys (prices, status, notices, races) is obeyed unchanged, with no restated bodies to drift. The action list is a
-- fixed CASE of static calls: nothing else of the seller's (money and payout settings, address book, other sections,
-- her purchases) is reachable. Photos are the exception: the manager uploads to their OWN storage folder, so
-- add_item_photo is checked here against the manager's folder (drafts only in phase 1, like the list-for-seller flow).
--
-- Every action is logged in declutter_manager_actions (private). A message the manager writes (an answer or an
-- order-talk message) is recorded in declutter_manager_messages, so readers can label it
-- "<Manager first name> (helping <Seller first name>)": declutter_manager_message_labels returns those labels to the
-- people who can see the messages.
--
-- Hidden switch 'declutter_manager' (testers). REPLAY-SAFE: IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO
-- NOTHING. Every RPC REVOKEd from PUBLIC, anon. PGlite proof: src/test/pglite/declutterManagerMode.pglite.mjs.

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('declutter_manager', 'testers',
        'Declutter manager mode: a seller asks one person to manage her Declutter (list, prices, offers, messages, pickups) for a share of each sale')
ON CONFLICT (key) DO NOTHING;

-- 1. The grant.
CREATE TABLE IF NOT EXISTS public.declutter_manager_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'active', 'declined', 'withdrawn', 'ended')),
  share_type text NOT NULL CHECK (share_type IN ('percent', 'flat')),
  share_pct integer CHECK (share_pct BETWEEN 0 AND 100),
  share_cents integer CHECK (share_cents BETWEEN 0 AND 1000000),
  can_list boolean NOT NULL DEFAULT false,
  can_prices boolean NOT NULL DEFAULT false,
  can_offers boolean NOT NULL DEFAULT false,
  can_messages boolean NOT NULL DEFAULT false,
  can_pickups boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  ended_at timestamptz,
  ended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_manager_grants_not_self CHECK (seller_id <> manager_id),
  CONSTRAINT declutter_manager_grants_share CHECK (
    (share_type = 'percent' AND share_pct IS NOT NULL AND share_cents IS NULL)
    OR (share_type = 'flat' AND share_cents IS NOT NULL AND share_pct IS NULL)),
  CONSTRAINT declutter_manager_grants_some_part CHECK (can_list OR can_prices OR can_offers OR can_messages OR can_pickups)
);
CREATE UNIQUE INDEX IF NOT EXISTS declutter_manager_grants_one_open
  ON public.declutter_manager_grants (seller_id) WHERE status IN ('offered', 'active');
CREATE INDEX IF NOT EXISTS declutter_manager_grants_manager_idx ON public.declutter_manager_grants (manager_id);
ALTER TABLE public.declutter_manager_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_manager_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_manager_grants TO authenticated;
GRANT ALL ON TABLE public.declutter_manager_grants TO service_role;
DROP POLICY IF EXISTS "declutter manager grants: the two people read" ON public.declutter_manager_grants;
CREATE POLICY "declutter manager grants: the two people read" ON public.declutter_manager_grants
  FOR SELECT TO authenticated
  USING (seller_id = (SELECT auth.uid()) OR manager_id = (SELECT auth.uid()));

-- 2. What the manager did (private: service role only).
CREATE TABLE IF NOT EXISTS public.declutter_manager_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES public.declutter_manager_grants(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_manager_actions_grant_idx ON public.declutter_manager_actions (grant_id, created_at);
ALTER TABLE public.declutter_manager_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_manager_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_manager_actions TO service_role;

-- 3. Messages the manager wrote, for the "<Manager> (helping <Seller>)" label. kind 'answer' = a question's answer
--    (message_id = the question), 'order_talk' = a declutter_order_talk_messages row.
CREATE TABLE IF NOT EXISTS public.declutter_manager_messages (
  kind text NOT NULL CHECK (kind IN ('answer', 'order_talk')),
  message_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES public.declutter_manager_grants(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, message_id)
);
ALTER TABLE public.declutter_manager_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_manager_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_manager_messages TO service_role;

-- 3b. Owner 11-01: "the manager should draft up everything, then send to the seller for approval before posting."
--     A manager never posts. They send a draft here; the seller approves it (she attests and it posts, as herself) or
--     sends it back with a note. One row per item; a sent-back draft can be sent again.
CREATE TABLE IF NOT EXISTS public.declutter_manager_submissions (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  grant_id uuid NOT NULL REFERENCES public.declutter_manager_grants(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'approved', 'sent_back')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS declutter_manager_submissions_seller_idx
  ON public.declutter_manager_submissions (seller_id, status, submitted_at);
ALTER TABLE public.declutter_manager_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_manager_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_manager_submissions TO authenticated;
GRANT ALL ON TABLE public.declutter_manager_submissions TO service_role;
DROP POLICY IF EXISTS declutter_manager_submissions_read ON public.declutter_manager_submissions;
CREATE POLICY declutter_manager_submissions_read ON public.declutter_manager_submissions FOR SELECT TO authenticated
  USING (seller_id = (SELECT auth.uid()) OR manager_id = (SELECT auth.uid()));

DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- 4. First name, for notices and labels.
CREATE OR REPLACE FUNCTION public.declutter_manager_first_name(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(NULLIF(split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = p_user)), ' ', 1), ''),
                  'Someone');
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_first_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_manager_first_name(uuid) TO service_role;

-- 5. The seller asks one person to manage her Declutter.
CREATE OR REPLACE FUNCTION public.declutter_manager_offer(
  p_manager uuid,
  p_share_type text,
  p_share_value integer,
  p_can_list boolean,
  p_can_prices boolean,
  p_can_offers boolean,
  p_can_messages boolean,
  p_can_pickups boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_id uuid;
  v_seller text;
  v_share text;
  v_parts text;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_manager IS NULL OR p_manager = v_uid OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_manager) THEN
    RAISE EXCEPTION 'manager_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.are_users_blocked(v_uid, p_manager) THEN
    RAISE EXCEPTION 'manager_blocked' USING ERRCODE = '42501';
  END IF;
  IF p_share_type NOT IN ('percent', 'flat') OR p_share_value IS NULL OR p_share_value < 0
     OR (p_share_type = 'percent' AND p_share_value > 100)
     OR (p_share_type = 'flat' AND p_share_value > 1000000) THEN
    RAISE EXCEPTION 'invalid_share' USING ERRCODE = '22023',
      HINT = 'Pick a percent from 0 to 100, or a dollar amount per sold item.';
  END IF;
  IF NOT (COALESCE(p_can_list, false) OR COALESCE(p_can_prices, false) OR COALESCE(p_can_offers, false)
          OR COALESCE(p_can_messages, false) OR COALESCE(p_can_pickups, false)) THEN
    RAISE EXCEPTION 'no_parts_chosen' USING ERRCODE = '22023', HINT = 'Choose at least one thing for them to handle.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_manager_grants WHERE seller_id = v_uid AND status IN ('offered', 'active')) THEN
    RAISE EXCEPTION 'already_has_manager' USING ERRCODE = '23505',
      HINT = 'End your current manager (or take back your offer) first.';
  END IF;

  INSERT INTO public.declutter_manager_grants (seller_id, manager_id, share_type, share_pct, share_cents,
    can_list, can_prices, can_offers, can_messages, can_pickups)
  VALUES (v_uid, p_manager, p_share_type,
    CASE WHEN p_share_type = 'percent' THEN p_share_value END,
    CASE WHEN p_share_type = 'flat' THEN p_share_value END,
    COALESCE(p_can_list, false), COALESCE(p_can_prices, false), COALESCE(p_can_offers, false),
    COALESCE(p_can_messages, false), COALESCE(p_can_pickups, false))
  RETURNING id INTO v_id;

  v_seller := public.declutter_manager_first_name(v_uid);
  v_share := CASE WHEN p_share_type = 'percent' THEN p_share_value::text || '% of each sale'
                  ELSE '$' || to_char(p_share_value / 100.0, 'FM999990.00') || ' per item sold' END;
  v_parts := array_to_string(ARRAY_REMOVE(ARRAY[
    CASE WHEN p_can_list THEN 'listing' END, CASE WHEN p_can_prices THEN 'prices' END,
    CASE WHEN p_can_offers THEN 'offers' END, CASE WHEN p_can_messages THEN 'messages' END,
    CASE WHEN p_can_pickups THEN 'pickups' END], NULL), ', ');
  PERFORM public.declutter_notify(p_manager, 'declutter_listings',
    v_seller || ' asked you to manage their Declutter',
    format('%s asked you to handle %s for %s. Open it to accept or decline.', v_seller, v_parts, v_share),
    '/declutter?tab=managing', v_uid);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_offer(uuid, text, integer, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manager_offer(uuid, text, integer, boolean, boolean, boolean, boolean, boolean) TO authenticated, service_role;

-- 6. The person accepts or declines.
CREATE OR REPLACE FUNCTION public.declutter_manager_respond(p_grant_id uuid, p_accept boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_g public.declutter_manager_grants%ROWTYPE;
  v_name text;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  SELECT * INTO v_g FROM public.declutter_manager_grants WHERE id = p_grant_id FOR UPDATE;
  IF v_g.id IS NULL OR v_g.manager_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_offer' USING ERRCODE = '42501';
  END IF;
  IF v_g.status <> 'offered' THEN
    RAISE EXCEPTION 'offer_not_pending' USING ERRCODE = '22023';
  END IF;
  v_name := public.declutter_manager_first_name(v_uid);
  IF COALESCE(p_accept, false) THEN
    IF public.is_caller_banned() THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    END IF;
    IF public.are_users_blocked(v_uid, v_g.seller_id) THEN
      RAISE EXCEPTION 'manager_blocked' USING ERRCODE = '42501';
    END IF;
    UPDATE public.declutter_manager_grants SET status = 'active', responded_at = now(), updated_at = now()
     WHERE id = p_grant_id;
    PERFORM public.declutter_notify(v_g.seller_id, 'declutter_listings', v_name || ' is managing your Declutter',
      format('%s accepted. You can see what they handle, or end it, in Declutter.', v_name),
      '/declutter?tab=selling', v_uid);
    RETURN 'active';
  END IF;
  UPDATE public.declutter_manager_grants SET status = 'declined', responded_at = now(), updated_at = now()
   WHERE id = p_grant_id;
  PERFORM public.declutter_notify(v_g.seller_id, 'declutter_listings', v_name || ' declined',
    format('%s won''t manage your Declutter.', v_name), '/declutter?tab=selling', v_uid);
  RETURN 'declined';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_respond(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manager_respond(uuid, boolean) TO authenticated, service_role;

-- 7. End it: the seller at any time (an offer not yet answered is 'withdrawn'), or the manager stepping down. No
--    feature check: access must always be removable, even with the switch off.
CREATE OR REPLACE FUNCTION public.declutter_manager_end(p_grant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_g public.declutter_manager_grants%ROWTYPE;
  v_to text;
  v_other uuid;
BEGIN
  SELECT * INTO v_g FROM public.declutter_manager_grants WHERE id = p_grant_id FOR UPDATE;
  IF v_g.id IS NULL OR v_uid IS NULL OR (v_g.seller_id <> v_uid AND v_g.manager_id <> v_uid) THEN
    RAISE EXCEPTION 'not_your_grant' USING ERRCODE = '42501';
  END IF;
  IF v_g.status NOT IN ('offered', 'active') THEN
    RETURN v_g.status;
  END IF;
  v_to := CASE WHEN v_g.status = 'offered' AND v_uid = v_g.seller_id THEN 'withdrawn'
               WHEN v_g.status = 'offered' THEN 'declined'
               ELSE 'ended' END;
  UPDATE public.declutter_manager_grants
     SET status = v_to, ended_at = now(), ended_by = v_uid, updated_at = now(),
         responded_at = COALESCE(responded_at, CASE WHEN v_to = 'declined' THEN now() END)
   WHERE id = p_grant_id;
  v_other := CASE WHEN v_uid = v_g.seller_id THEN v_g.manager_id ELSE v_g.seller_id END;
  IF v_to = 'ended' THEN
    PERFORM public.declutter_notify(v_other, 'declutter_listings', 'Declutter managing ended',
      CASE WHEN v_uid = v_g.seller_id
        THEN format('%s ended your access to their Declutter. Shares already locked on sales still pay.',
                    public.declutter_manager_first_name(v_uid))
        ELSE format('%s stopped managing your Declutter.', public.declutter_manager_first_name(v_uid)) END,
      '/declutter?tab=selling', v_uid);
  END IF;
  RETURN v_to;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_end(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manager_end(uuid) TO authenticated, service_role;

-- 8. The seller changes which parts the manager handles. The share stays as agreed (to change it, end and ask again).
CREATE OR REPLACE FUNCTION public.declutter_manager_set_permissions(
  p_grant_id uuid,
  p_can_list boolean,
  p_can_prices boolean,
  p_can_offers boolean,
  p_can_messages boolean,
  p_can_pickups boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_g public.declutter_manager_grants%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  -- A banned or restricted seller can't change what the manager handles (ending access stays open: _end).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_g FROM public.declutter_manager_grants WHERE id = p_grant_id FOR UPDATE;
  IF v_g.id IS NULL OR v_g.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_grant' USING ERRCODE = '42501';
  END IF;
  IF v_g.status NOT IN ('offered', 'active') THEN
    RAISE EXCEPTION 'grant_ended' USING ERRCODE = '22023';
  END IF;
  IF NOT (COALESCE(p_can_list, false) OR COALESCE(p_can_prices, false) OR COALESCE(p_can_offers, false)
          OR COALESCE(p_can_messages, false) OR COALESCE(p_can_pickups, false)) THEN
    RAISE EXCEPTION 'no_parts_chosen' USING ERRCODE = '22023',
      HINT = 'Choose at least one thing for them to handle, or end their access.';
  END IF;
  UPDATE public.declutter_manager_grants
     SET can_list = COALESCE(p_can_list, false), can_prices = COALESCE(p_can_prices, false),
         can_offers = COALESCE(p_can_offers, false), can_messages = COALESCE(p_can_messages, false),
         can_pickups = COALESCE(p_can_pickups, false), updated_at = now()
   WHERE id = p_grant_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_set_permissions(uuid, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manager_set_permissions(uuid, boolean, boolean, boolean, boolean, boolean) TO authenticated, service_role;

-- 9. My grants, both sides, with first names (the offer card, the seller's "managed by" card, the manager's switcher).
CREATE OR REPLACE FUNCTION public.declutter_my_manager_grants()
RETURNS TABLE (
  id uuid, role text, seller_id uuid, manager_id uuid, seller_first_name text, manager_first_name text,
  status text, share_type text, share_pct integer, share_cents integer,
  can_list boolean, can_prices boolean, can_offers boolean, can_messages boolean, can_pickups boolean,
  created_at timestamptz, responded_at timestamptz, ended_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter_manager');
  RETURN QUERY
  SELECT g.id, CASE WHEN g.seller_id = v_uid THEN 'seller' ELSE 'manager' END,
         g.seller_id, g.manager_id,
         public.declutter_manager_first_name(g.seller_id), public.declutter_manager_first_name(g.manager_id),
         g.status, g.share_type, g.share_pct, g.share_cents,
         g.can_list, g.can_prices, g.can_offers, g.can_messages, g.can_pickups,
         g.created_at, g.responded_at, g.ended_at
    FROM public.declutter_manager_grants g
   WHERE v_uid IS NOT NULL AND (g.seller_id = v_uid OR g.manager_id = v_uid)
   ORDER BY (g.status IN ('offered', 'active')) DESC, g.created_at DESC
   LIMIT 50;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_manager_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_manager_grants() TO authenticated, service_role;

-- 10. The gate every manager action asks: the caller is the ACTIVE manager of p_seller and p_perm is on. Returns the
--     grant. Not client-callable.
CREATE OR REPLACE FUNCTION public.declutter_manager_grant_for(p_seller uuid, p_perm text)
RETURNS public.declutter_manager_grants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_g public.declutter_manager_grants%ROWTYPE;
  v_on boolean;
BEGIN
  SELECT * INTO v_g FROM public.declutter_manager_grants
   WHERE seller_id = p_seller AND manager_id = (SELECT auth.uid()) AND status = 'active'
   FOR SHARE;
  IF v_g.id IS NULL THEN
    RAISE EXCEPTION 'not_your_seller' USING ERRCODE = '42501';
  END IF;
  v_on := CASE p_perm
            WHEN 'list' THEN v_g.can_list
            WHEN 'prices' THEN v_g.can_prices
            WHEN 'offers' THEN v_g.can_offers
            WHEN 'messages' THEN v_g.can_messages
            WHEN 'pickups' THEN v_g.can_pickups
            ELSE false END;
  IF NOT COALESCE(v_on, false) THEN
    RAISE EXCEPTION 'permission_off' USING ERRCODE = '42501',
      HINT = 'The seller has not turned this part on for you.';
  END IF;
  RETURN v_g;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_grant_for(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_manager_grant_for(uuid, text) TO service_role;

-- 11. The manager's actions, as the seller.
CREATE OR REPLACE FUNCTION public.declutter_manage(p_seller uuid, p_action text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_mgr uuid := (SELECT auth.uid());
  v_a jsonb := COALESCE(p_args, '{}'::jsonb);
  v_perm text;
  v_g public.declutter_manager_grants%ROWTYPE;
  v_target uuid;
  v_ok boolean;
  v_prev_sub text;
  v_prev_claims text;
  v_result jsonb;
  v_item public.declutter_items%ROWTYPE;
  v_path text;
  v_pos smallint;
  v_attested_at timestamptz;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  IF v_mgr IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  v_perm := CASE p_action
    WHEN 'create_item' THEN 'list'
    WHEN 'update_draft' THEN 'list'
    WHEN 'add_item_photo' THEN 'list'
    WHEN 'remove_item_photo' THEN 'list'
    WHEN 'submit_for_approval' THEN 'list'
    WHEN 'edit_listing' THEN 'list'
    WHEN 'set_handovers' THEN 'list'
    WHEN 'pause_listing' THEN 'list'
    WHEN 'withdraw_item' THEN 'list'
    WHEN 'set_listing_price' THEN 'prices'
    WHEN 'set_listing_drops' THEN 'prices'
    WHEN 'respond_offer' THEN 'offers'
    WHEN 'set_offer_rules' THEN 'offers'
    WHEN 'answer_question' THEN 'messages'
    WHEN 'send_order_message' THEN 'messages'
    WHEN 'order_talk_view' THEN 'messages'
    WHEN 'set_pickup_windows' THEN 'pickups'
    WHEN 'confirm_handover' THEN 'pickups'
    ELSE NULL END;
  IF v_perm IS NULL THEN
    RAISE EXCEPTION 'unknown_action' USING ERRCODE = '22023';
  END IF;
  v_g := public.declutter_manager_grant_for(p_seller, v_perm);

  -- The target is the seller's SELLING side: her item, an offer on her item, her sale, a question on her item.
  IF p_action IN ('update_draft', 'add_item_photo', 'submit_for_approval', 'edit_listing', 'set_handovers',
                  'pause_listing', 'withdraw_item', 'set_listing_price', 'set_listing_drops', 'set_offer_rules') THEN
    v_target := (v_a ->> 'item_id')::uuid;
    v_ok := EXISTS (SELECT 1 FROM public.declutter_items WHERE id = v_target AND seller_id = p_seller);
  ELSIF p_action = 'remove_item_photo' THEN
    v_target := (v_a ->> 'photo_id')::uuid;
    v_ok := EXISTS (SELECT 1 FROM public.declutter_item_photos ph JOIN public.declutter_items i ON i.id = ph.item_id
                     WHERE ph.id = v_target AND i.seller_id = p_seller AND i.status = 'draft');
  ELSIF p_action = 'respond_offer' THEN
    v_target := (v_a ->> 'offer_id')::uuid;
    v_ok := EXISTS (SELECT 1 FROM public.declutter_offers WHERE id = v_target AND seller_id = p_seller);
  ELSIF p_action = 'answer_question' THEN
    v_target := (v_a ->> 'question_id')::uuid;
    v_ok := EXISTS (SELECT 1 FROM public.declutter_questions q JOIN public.declutter_items i ON i.id = q.item_id
                     WHERE q.id = v_target AND i.seller_id = p_seller);
  ELSIF p_action IN ('send_order_message', 'order_talk_view', 'confirm_handover') THEN
    v_target := (v_a ->> 'order_id')::uuid;
    v_ok := EXISTS (SELECT 1 FROM public.declutter_orders WHERE id = v_target AND seller_id = p_seller);
  ELSE
    -- create_item (a new id the seller does not own yet) and set_pickup_windows (the seller's own windows).
    v_target := NULLIF(v_a ->> 'item_id', '')::uuid;
    v_ok := p_action = 'set_pickup_windows'
      OR (v_target IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.declutter_items WHERE id = v_target));
  END IF;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  -- A draft waiting for the seller's OK is hers to decide: the manager changes it only after she sends it back.
  IF p_action IN ('update_draft', 'add_item_photo', 'remove_item_photo', 'set_handovers', 'submit_for_approval')
     AND EXISTS (SELECT 1 FROM public.declutter_manager_submissions sub
                  WHERE sub.status = 'waiting'
                    AND sub.item_id = CASE WHEN p_action = 'remove_item_photo'
                                           THEN (SELECT ph.item_id FROM public.declutter_item_photos ph WHERE ph.id = v_target)
                                           ELSE v_target END) THEN
    RAISE EXCEPTION 'waiting_for_seller' USING ERRCODE = '22023',
      HINT = 'The seller is reviewing this draft. You can change it if they send it back.';
  END IF;

  -- Owner 11-01: the manager sends a finished draft to the seller; it is never posted by the manager.
  IF p_action = 'submit_for_approval' THEN
    SELECT * INTO v_item FROM public.declutter_items WHERE id = v_target FOR UPDATE;
    IF v_item.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023', HINT = 'Only a draft can be sent for approval.';
    END IF;
    INSERT INTO public.declutter_manager_submissions (item_id, grant_id, seller_id, manager_id, status, note, submitted_at, decided_at)
    VALUES (v_target, v_g.id, p_seller, v_mgr, 'waiting', NULL, now(), NULL)
    ON CONFLICT (item_id) DO UPDATE SET grant_id = EXCLUDED.grant_id, manager_id = EXCLUDED.manager_id, status = 'waiting',
      note = NULL, submitted_at = now(), decided_at = NULL;
    INSERT INTO public.declutter_manager_actions (grant_id, seller_id, manager_id, action, target_id)
    VALUES (v_g.id, p_seller, v_mgr, p_action, v_target);
    SELECT count(*) INTO v_pos FROM public.declutter_manager_submissions sub
     WHERE sub.seller_id = p_seller AND sub.manager_id = v_mgr AND sub.status = 'waiting';
    PERFORM public.declutter_notify(p_seller, 'declutter_listings', 'Waiting for your OK',
      format('%s listed %s for you. Review and post %s.', public.declutter_manager_first_name(v_mgr),
             CASE WHEN v_pos = 1 THEN '1 item' ELSE v_pos::text || ' items' END,
             CASE WHEN v_pos = 1 THEN 'it' ELSE 'them' END),
      '/declutter?tab=selling', v_mgr);
    RETURN jsonb_build_object('result', 'waiting');
  END IF;

  -- Photos: the manager's OWN upload in their own folder for this item, on the seller's draft.
  IF p_action = 'add_item_photo' THEN
    v_path := v_a ->> 'storage_path';
    SELECT * INTO v_item FROM public.declutter_items WHERE id = v_target FOR UPDATE;
    IF v_item.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023', HINT = 'Photos can be added to drafts.';
    END IF;
    IF v_path IS NULL
       OR split_part(v_path, '/', 1) IS DISTINCT FROM v_mgr::text
       OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(v_path, '/', 3) IS DISTINCT FROM v_target::text
       OR NOT EXISTS (
         SELECT 1 FROM storage.objects o
          WHERE o.bucket_id = 'job-photos'
            AND o.name = v_path
            AND (o.owner_id = v_mgr::text OR o.owner = v_mgr)
            AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
            AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    SELECT g.p INTO v_pos FROM generate_series(0, 11) AS g(p)
     WHERE NOT EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.item_id = v_target AND ph.position = g.p)
     ORDER BY g.p LIMIT 1;
    IF v_pos IS NULL THEN
      RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'A listing has at most 12 photos.';
    END IF;
    INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
    VALUES (v_target, p_seller, v_path, v_pos)
    RETURNING jsonb_build_object('result', id) INTO v_result;
    UPDATE public.declutter_items SET updated_at = now() WHERE id = v_target;
    INSERT INTO public.declutter_manager_actions (grant_id, seller_id, manager_id, action, target_id)
    VALUES (v_g.id, p_seller, v_mgr, p_action, v_target);
    RETURN v_result;
  END IF;

  -- Lead 11-01 (supersedes 10:31): the seller attests only herself, at approval or on her own edits. A manager's edit
  -- of a live listing never touches her attestation: declutter_edit_listing requires the four answers and re-stamps
  -- the row, so the manager's own answers are ignored, hers are passed through, and her row is put back as it was.
  IF p_action = 'edit_listing' THEN
    SELECT a.attested_at INTO v_attested_at FROM public.declutter_tax_attestations a WHERE a.item_id = v_target;
    IF v_attested_at IS NULL THEN
      RAISE EXCEPTION 'attestation_required' USING ERRCODE = '22023',
        HINT = 'The seller has to confirm this listing herself first.';
    END IF;
    v_a := v_a || jsonb_build_object('bought_for_personal_use', true, 'not_in_the_business', true,
                                     'not_a_frequent_seller', true, 'keeps_item_until_handover', true);
  END IF;

  -- Act as the seller for this one call.
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  v_prev_claims := current_setting('request.jwt.claims', true);
  PERFORM set_config('request.jwt.claim.sub', p_seller::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_set(COALESCE(NULLIF(v_prev_claims, '')::jsonb, '{}'::jsonb), '{sub}', to_jsonb(p_seller::text))::text, true);
  BEGIN
    IF (SELECT auth.uid()) IS DISTINCT FROM p_seller THEN
      RAISE EXCEPTION 'act_as_seller_failed' USING ERRCODE = '42501';
    END IF;
    v_result := CASE p_action
      WHEN 'create_item' THEN to_jsonb(public.declutter_create_item_with_id(
        v_target, v_a ->> 'title', v_a ->> 'description', v_a ->> 'category', (v_a ->> 'condition_stars')::integer,
        v_a ->> 'delivery_size', (v_a ->> 'price_cents')::integer, (v_a ->> 'floor_price_cents')::integer,
        v_a ->> 'area_label', v_a ->> 'pickup_address', (v_a ->> 'pickup_lat')::numeric, (v_a ->> 'pickup_lng')::numeric))
      WHEN 'update_draft' THEN to_jsonb(public.declutter_update_draft(
        v_target, v_a ->> 'title', v_a ->> 'description', v_a ->> 'category', (v_a ->> 'condition_stars')::integer,
        v_a ->> 'delivery_size', (v_a ->> 'price_cents')::integer, (v_a ->> 'floor_price_cents')::integer,
        v_a ->> 'area_label', v_a ->> 'pickup_address', (v_a ->> 'pickup_lat')::numeric, (v_a ->> 'pickup_lng')::numeric))
      WHEN 'remove_item_photo' THEN to_jsonb(public.declutter_remove_item_photo(v_target))
      WHEN 'edit_listing' THEN to_jsonb(public.declutter_edit_listing(v_target, v_a ->> 'title', v_a ->> 'description',
        v_a ->> 'category', (v_a ->> 'condition_stars')::integer, v_a ->> 'delivery_size',
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_a -> 'handovers', '[]'::jsonb))),
        (v_a ->> 'bought_for_personal_use')::boolean, (v_a ->> 'not_in_the_business')::boolean,
        (v_a ->> 'not_a_frequent_seller')::boolean, (v_a ->> 'keeps_item_until_handover')::boolean))
      WHEN 'set_handovers' THEN to_jsonb(public.declutter_set_handovers(v_target,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_a -> 'handovers', '[]'::jsonb)))))
      WHEN 'pause_listing' THEN to_jsonb(public.declutter_pause_listing(v_target))
      WHEN 'withdraw_item' THEN to_jsonb(public.declutter_withdraw_item(v_target))
      WHEN 'set_listing_price' THEN to_jsonb(public.declutter_set_listing_price(v_target,
        (v_a ->> 'price_cents')::integer, (v_a ->> 'floor_price_cents')::integer))
      WHEN 'set_listing_drops' THEN to_jsonb(public.declutter_set_listing_drops(v_target, (v_a ->> 'on')::boolean))
      WHEN 'respond_offer' THEN to_jsonb(public.declutter_respond_offer(v_target, v_a ->> 'action',
        (v_a ->> 'amount_cents')::integer))
      WHEN 'set_offer_rules' THEN to_jsonb(public.declutter_set_offer_rules(v_target,
        (v_a ->> 'accepts_offers')::boolean, (v_a ->> 'auto_offers')::boolean)::text)
      WHEN 'answer_question' THEN to_jsonb(public.declutter_answer_question(v_target, v_a ->> 'answer'))
      WHEN 'send_order_message' THEN to_jsonb(public.declutter_send_order_message(v_target, v_a ->> 'body'))
      WHEN 'order_talk_view' THEN public.declutter_order_talk_view(v_target)
      WHEN 'set_pickup_windows' THEN to_jsonb(public.declutter_set_pickup_windows(COALESCE(v_a -> 'windows', '[]'::jsonb)))
      WHEN 'confirm_handover' THEN public.declutter_confirm_handover(v_target, v_a ->> 'method', v_a ->> 'code')
    END;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
    PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), true);
  IF (SELECT auth.uid()) IS DISTINCT FROM v_mgr THEN
    RAISE EXCEPTION 'act_as_seller_not_restored' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'edit_listing' THEN
    UPDATE public.declutter_tax_attestations SET seller_id = p_seller, attested_at = v_attested_at WHERE item_id = v_target;
  END IF;
  INSERT INTO public.declutter_manager_actions (grant_id, seller_id, manager_id, action, target_id)
  VALUES (v_g.id, p_seller, v_mgr, p_action, v_target);
  IF p_action = 'answer_question' THEN
    INSERT INTO public.declutter_manager_messages (kind, message_id, grant_id, seller_id, manager_id)
    VALUES ('answer', v_target, v_g.id, p_seller, v_mgr)
    ON CONFLICT (kind, message_id) DO UPDATE SET grant_id = EXCLUDED.grant_id, manager_id = EXCLUDED.manager_id,
      created_at = now();
  ELSIF p_action = 'send_order_message' THEN
    INSERT INTO public.declutter_manager_messages (kind, message_id, grant_id, seller_id, manager_id)
    VALUES ('order_talk', (v_result #>> '{}')::uuid, v_g.id, p_seller, v_mgr);
  END IF;
  RETURN jsonb_build_object('result', v_result);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manage(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manage(uuid, text, jsonb) TO authenticated, service_role;

-- 11b. The seller decides on a draft her manager sent (owner 11-01). She attests and it posts AS HER: auth.uid() is the
--      seller here, so declutter_attest_item and declutter_publish_item run with her own rights and checks.
CREATE OR REPLACE FUNCTION public.declutter_manager_approve(p_item_id uuid, p_bought_for_personal_use boolean,
  p_not_in_the_business boolean, p_not_a_frequent_seller boolean, p_keeps_item_until_handover boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_sub public.declutter_manager_submissions%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- A banned or restricted seller can't approve a draft (lead 11-01 ban gate).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sub FROM public.declutter_manager_submissions WHERE item_id = p_item_id FOR UPDATE;
  IF v_sub.item_id IS NULL OR v_sub.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sub.status <> 'waiting' THEN
    RAISE EXCEPTION 'not_waiting' USING ERRCODE = '22023';
  END IF;
  PERFORM public.declutter_attest_item(p_item_id, p_bought_for_personal_use, p_not_in_the_business,
    p_not_a_frequent_seller, p_keeps_item_until_handover);
  v_result := to_jsonb(public.declutter_publish_item(p_item_id));
  UPDATE public.declutter_manager_submissions SET status = 'approved', decided_at = now() WHERE item_id = p_item_id;
  INSERT INTO public.declutter_manager_actions (grant_id, seller_id, manager_id, action, target_id)
  VALUES (v_sub.grant_id, v_uid, v_sub.manager_id, 'seller_approved', p_item_id);
  PERFORM public.declutter_notify(v_sub.manager_id, 'declutter_listings', 'Posted',
    format('%s posted %s. It is live now.', public.declutter_manager_first_name(v_uid),
           COALESCE((SELECT i.title FROM public.declutter_items i WHERE i.id = p_item_id), 'the item')),
    '/declutter?tab=selling', v_uid);
  RETURN jsonb_build_object('result', v_result);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_approve(uuid, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manager_approve(uuid, boolean, boolean, boolean, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_manager_send_back(p_item_id uuid, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_sub public.declutter_manager_submissions%ROWTYPE;
  v_note text := left(NULLIF(btrim(COALESCE(p_note, '')), ''), 500);
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- A banned or restricted seller can't send a draft back (lead 11-01 ban gate).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sub FROM public.declutter_manager_submissions WHERE item_id = p_item_id FOR UPDATE;
  IF v_sub.item_id IS NULL OR v_sub.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sub.status <> 'waiting' THEN
    RAISE EXCEPTION 'not_waiting' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_manager_submissions SET status = 'sent_back', note = v_note, decided_at = now()
   WHERE item_id = p_item_id;
  INSERT INTO public.declutter_manager_actions (grant_id, seller_id, manager_id, action, target_id)
  VALUES (v_sub.grant_id, v_uid, v_sub.manager_id, 'seller_sent_back', p_item_id);
  PERFORM public.declutter_notify(v_sub.manager_id, 'declutter_listings', 'Sent back to you',
    format('%s sent %s back%s. Change it, then send it for approval again.', public.declutter_manager_first_name(v_uid),
           COALESCE((SELECT i.title FROM public.declutter_items i WHERE i.id = p_item_id), 'the draft'),
           CASE WHEN v_note IS NULL THEN '' ELSE ': "' || v_note || '"' END),
    '/declutter?tab=selling', v_uid);
  RETURN 'sent_back';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_send_back(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manager_send_back(uuid, text) TO authenticated, service_role;

-- 12. Labels for messages a manager wrote: "<Manager> (helping <Seller>)". Returned only for messages the caller can
--     already see: answers on any item (answers are public on the listing), order-talk messages of the caller's own
--     orders (buyer or seller) or of a seller the caller actively manages with messages on.
CREATE OR REPLACE FUNCTION public.declutter_manager_message_labels(p_kind text, p_ids uuid[])
RETURNS TABLE (message_id uuid, label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  RETURN QUERY
  SELECT m.message_id,
         public.declutter_manager_first_name(m.manager_id) || ' (helping '
           || public.declutter_manager_first_name(m.seller_id) || ')'
    FROM public.declutter_manager_messages m
   WHERE m.kind = p_kind AND m.message_id = ANY (COALESCE(p_ids, '{}'::uuid[]))
     AND (
       p_kind = 'answer'
       OR (p_kind = 'order_talk' AND v_uid IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.declutter_order_talk_messages tm
               JOIN public.declutter_order_talks t ON t.id = tm.talk_id
               JOIN public.declutter_orders o ON o.id = t.order_id
              WHERE tm.id = m.message_id
                AND (o.buyer_id = v_uid OR o.seller_id = v_uid
                     OR EXISTS (SELECT 1 FROM public.declutter_manager_grants g
                                 WHERE g.seller_id = o.seller_id AND g.manager_id = v_uid
                                   AND g.status = 'active' AND g.can_messages))))
     );
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_message_labels(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_manager_message_labels(text, uuid[]) TO anon, authenticated, service_role;

-- 13. What the manager sees of the seller: her listings (any part on), open offers on them (Offers), questions on them
--     (Messages), and her sales as the SELLER (Messages or Pickups). Never her purchases, money or address book.
CREATE OR REPLACE FUNCTION public.declutter_managed_overview(p_seller uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_g public.declutter_manager_grants%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_manager');
  SELECT * INTO v_g FROM public.declutter_manager_grants
   WHERE seller_id = p_seller AND manager_id = (SELECT auth.uid()) AND status = 'active';
  IF v_g.id IS NULL THEN
    RAISE EXCEPTION 'not_your_seller' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'grant_id', v_g.id,
    'seller_first_name', public.declutter_manager_first_name(p_seller),
    'parts', jsonb_build_object('list', v_g.can_list, 'prices', v_g.can_prices, 'offers', v_g.can_offers,
                                'messages', v_g.can_messages, 'pickups', v_g.can_pickups),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'status', i.status,
               'price_cents', i.current_price_cents, 'updated_at', i.updated_at,
               'photo_path', (SELECT ph.storage_path FROM public.declutter_item_photos ph
                               WHERE ph.item_id = i.id ORDER BY ph.position LIMIT 1))
               ORDER BY i.updated_at DESC)
        FROM public.declutter_items i
       WHERE i.seller_id = p_seller AND i.status NOT IN ('withdrawn', 'removed')), '[]'::jsonb),
    'offers', CASE WHEN v_g.can_offers THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', o.id, 'item_id', o.item_id, 'amount_cents', o.amount_cents,
               'awaiting', o.awaiting, 'respond_by', o.respond_by,
               'buyer_first_name', public.declutter_manager_first_name(o.buyer_id)) ORDER BY o.respond_by)
        FROM public.declutter_offers o
       WHERE o.seller_id = p_seller AND o.status = 'open'), '[]'::jsonb) ELSE '[]'::jsonb END,
    'questions', CASE WHEN v_g.can_messages THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', q.id, 'item_id', q.item_id, 'question', q.question,
               'answer', q.answer, 'answered_at', q.answered_at, 'created_at', q.created_at) ORDER BY q.created_at DESC)
        FROM public.declutter_questions q JOIN public.declutter_items i ON i.id = q.item_id
       WHERE i.seller_id = p_seller AND q.removed_at IS NULL), '[]'::jsonb) ELSE '[]'::jsonb END,
    'orders', CASE WHEN v_g.can_messages OR v_g.can_pickups THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'status', d.status, 'handover', d.handover,
               'items_cents', d.items_cents, 'paid_at', d.paid_at, 'closed_at', d.closed_at,
               'buyer_first_name', public.declutter_manager_first_name(d.buyer_id)) ORDER BY d.paid_at DESC)
        FROM public.declutter_orders d
       WHERE d.seller_id = p_seller AND d.status = 'paid'), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_managed_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_managed_overview(uuid) TO authenticated, service_role;
