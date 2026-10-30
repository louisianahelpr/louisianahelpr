-- Q2488 (Declutter audit DC-17 part 2, 2026-10-30): "New question" and "The seller answered" were written as
-- declutter_offers, so a member who muted Offers also lost questions on their listings and answers to their own questions.
--
-- FIX: a kind of their own, declutter_questions, with a push column and its email twin (the six-registry rule,
-- src/test/notificationTypeRegistries.test.ts). The switch mutes the push; the bell row is written either way, as for every kind.
--
-- A member's choice carries over: each new column starts from their own Offers switch, on the run that adds it, so
-- nobody who muted Offers starts getting question pushes. A replay never overwrites a later choice.
-- MEASURED on prod, 2026-10-30, read-only: 311 preference rows, 0 with declutter_offers off, 0 with email_declutter_offers
-- off, 0 notifications stored as declutter_offers with either title, so nothing stored needs moving.
-- Question notices still send no email: email_declutter_questions exists only because every kind has its twin
-- (Settings shows a dash, as it does for Offers).
--
-- RESTATED FROM (md5(prosrc) equal to prod, read 2026-10-30):
--   declutter_notice_type      20261029194046  3849b298719f397f1065349011409c91
--   declutter_question_notice  20261028162048  1775fe6f275a06b4e54c588b9cddc83a
-- CHANGED: only the kind. The titles' words, who is told, the block rule and the grants are unchanged.
-- notifications_type_check is prod's list, read 2026-10-30, plus the one new type.
-- MONEY: none. REPLAY-SAFE: the column block adds and copies only when the column is missing; DROP/ADD of the CHECK;
-- ON CONFLICT; CREATE OR REPLACE. Proof: src/test/pglite/declutterQuestionKind.pglite.mjs (3x).

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'notification_preferences'
                    AND column_name = 'declutter_questions') THEN
    ALTER TABLE public.notification_preferences ADD COLUMN declutter_questions boolean NOT NULL DEFAULT true;
    UPDATE public.notification_preferences SET declutter_questions = declutter_offers WHERE declutter_offers IS FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'notification_preferences'
                    AND column_name = 'email_declutter_questions') THEN
    ALTER TABLE public.notification_preferences ADD COLUMN email_declutter_questions boolean NOT NULL DEFAULT true;
    UPDATE public.notification_preferences SET email_declutter_questions = email_declutter_offers WHERE email_declutter_offers IS FALSE;
  END IF;
END
$mig$;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'info', 'success', 'warning', 'job_update', 'application', 'review', 'payment',
    'job_match', 'job_updates', 'work_status', 'transit_updates',
    'system_alert', 'new_offers', 'expired', 'financial_alerts', 'verified',
    'message',
    'admin_alert',
    'declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups',
    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted', 'declutter_questions'
  ));

INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('declutter_offers',    'declutter_offers',    'Declutter: offers made, countered, declined, withdrawn or expired.'),
  ('declutter_questions', 'declutter_questions', 'Declutter: a question on your listing, and the seller''s answer to yours.')
ON CONFLICT (type) DO UPDATE
  SET pref_column = EXCLUDED.pref_column,
      description = EXCLUDED.description;

CREATE OR REPLACE FUNCTION public.declutter_notice_type(p_type text, p_title text, p_link text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    -- The caller already chose a Declutter kind.
    WHEN p_type IN ('declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups',
                    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted', 'declutter_questions') THEN p_type
    -- Not a Declutter screen: Shops orders, setup jobs, admin alerts, earnings.
    WHEN p_link IS NULL OR p_link NOT LIKE '/declutter%' THEN p_type
    -- A Helpr's delivery work is work, not their own buying or selling.
    WHEN p_link LIKE '/declutter?view=deliver%' OR p_link LIKE '/declutter?tab=deliver%' THEN p_type
    -- Saved-search matches have their own per-search switches.
    WHEN p_type = 'job_match' THEN p_type
    WHEN p_title IN ('Listing sent for review', 'Your listing is live', 'Your listing needs a change',
                     'Your item is now free', 'Haul-away is open', 'Haul-away not booked',
                     'Haul-away refunded', 'Back on sale', 'Donation receipt',
                     -- Listing rounds (sell flow, 20261028164424, lands after this file)
                     'Your listing goes back up soon', 'Your listing comes down soon',
                     'Back up for another 30 days', 'Your listing came down')
      THEN 'declutter_listings'
    WHEN p_title IN ('New offer', 'New counteroffer', 'Offer declined', 'Offer withdrawn', 'Offer expired',
                     'Item no longer available', 'Item paused', 'Item taken down', 'Item off sale',
                     'Now free', 'Item came down',
                     -- Smart offers (20261029162620): an offer the seller's rules answered.
                     'Offer accepted automatically', 'Offer answered automatically')
      THEN 'declutter_offers'
    WHEN p_title IN ('It''s yours', 'Reserved for you: check out within 48 hours',
                     'It''s yours: pick a pickup within 48 hours', 'Free item claimed',
                     'Someone claimed your free item', 'Sold: waiting for the buyer to pay',
                     'Check out within 24 hours', '2 hours left to check out', 'Checkout closed',
                     'Buyer did not check out', 'The seller cancelled', 'This sale was cancelled',
                     'Sale cancelled', 'Free pickup cancelled', 'Payment received', 'Buyer paid',
                     'Card saved', 'Handover done', 'Enjoy your item', 'Amount owed', 'Amount owed added',
                     'An amount owed comes out of your next payout', 'Setup fee coming back',
                     'Delivery pay raised', 'Your raise is coming back')
      THEN 'declutter_sales'
    WHEN p_title IN ('Pickup booked', 'Pickup time changed', 'Pickup time cancelled', 'You missed your pickup',
                     'Your buyer is at the meeting spot', 'The seller is at the meeting spot',
                     'Your item is on the porch', 'Your item was picked up', 'Picked up', 'Delivered',
                     'Delivery booked', 'Delivery changed', 'Delivery coming up', 'Delivery time kept',
                     'Delivery time changed', 'New delivery time asked', 'Pick a new delivery time',
                     'Buyer is picking a delivery time', 'Your items were delivered', 'Your item is on its way',
                     'A Helpr took your delivery', 'A Helpr will pick it up', 'Helpr pickup booked',
                     'Finding another Helpr', 'The Helpr couldn''t pick up', 'Your delivery is on hold',
                     'Your delivery fell through', 'No Helpr took your delivery', 'The buyer will pick it up')
      THEN 'declutter_pickups'
    WHEN p_title IN ('Refund request', 'Refund request withdrawn', 'Refund on its way', 'Buyer refunded',
                     'Your refund did not go through', 'Your refund is being sent by hand',
                     'The seller agreed to a full refund', 'Full refund agreed',
                     'The seller offered a part refund', 'The seller said no',
                     'Louisiana Helpr will decide', 'Louisiana Helpr decided',
                     'A problem was reported on your sale', 'You got a Declutter strike',
                     'Your strike was removed')
      THEN 'declutter_refunds'
    WHEN p_title IN ('A seller has a match')
      THEN 'declutter_wanted'
    WHEN p_title IN ('New question', 'The seller answered')
      THEN 'declutter_questions'
    -- A title nobody listed yet still lands in the Declutter group, by its old type.
    WHEN p_type IN ('new_offers', 'expired') THEN 'declutter_offers'
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'transit_updates') THEN 'declutter_pickups'
    WHEN p_type IN ('warning', 'system_alert') THEN 'declutter_refunds'
    WHEN p_type IN ('payment', 'financial_alerts') THEN 'declutter_sales'
    WHEN p_type IN ('info', 'success') THEN 'declutter_listings'
    ELSE p_type
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_notice_type(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_notice_type(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_question_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item record;
  v_text text;
BEGIN
  IF NEW.removed_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT i.id, i.seller_id, COALESCE(NULLIF(btrim(i.title), ''), 'your item') AS title
      INTO v_item FROM public.declutter_items i WHERE i.id = NEW.item_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    -- A block between the two since the question was asked: nobody is told
    -- (lh-authz-rls review 2026-10-28, finding 1).
    IF public.are_users_blocked(NEW.asker_id, v_item.seller_id) THEN
      RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
      v_text := btrim(NEW.question);
      PERFORM public.declutter_notify(v_item.seller_id, 'declutter_questions', 'New question',
        'Someone asked about "' || v_item.title || '": "'
          || CASE WHEN char_length(v_text) > 120 THEN left(v_text, 117) || '...' ELSE v_text END || '"',
        '/declutter/item/' || v_item.id::text, NEW.asker_id);
    ELSIF OLD.answered_at IS NULL AND NEW.answered_at IS NOT NULL THEN
      v_text := btrim(COALESCE(NEW.answer, ''));
      PERFORM public.declutter_notify(NEW.asker_id, 'declutter_questions', 'The seller answered',
        'About "' || v_item.title || '": "'
          || CASE WHEN char_length(v_text) > 120 THEN left(v_text, 117) || '...' ELSE v_text END || '"',
        '/declutter/item/' || v_item.id::text, v_item.seller_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'declutter_question_notice: question %: %', NEW.id, SQLERRM;
    PERFORM public.log_cron_defect('declutter_question_notice', NEW.id::text, SQLERRM);
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_question_notice() FROM PUBLIC, anon, authenticated;
