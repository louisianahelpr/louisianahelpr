-- Admin bell: a notice for every real member activity (owner via the lead, 11-12 ~12:35 AM; Builder 1 lane b1-bell).
--
-- Before: the admin bell heard of new members only (notify_admins_new_member, now a daily summary) and of problems
-- (operator alerts). The owner wants to see the marketplace move: listings, offers, sales, jobs, Shops orders.
--
-- TYPE: a new notification type, admin_activity, NOT admin_alert. admin_alert is the operator type the admin
-- push->Slack mirror pages #ops-alerts on (supabase/functions/_shared/alertPolicy.ts OPERATOR_NOTIFICATION_TYPES), so
-- copying the new-member pattern verbatim would page ops for every listing. admin_activity is BELL ONLY:
--   * notification_preferences.admin_activity (push) and email_admin_activity (email), both DEFAULT false, and the
--     notification_type_pref_map row points push at admin_activity, so fan_out_push_on_notification sends no push and
--     send-notification-email (TYPE_MAP prefCol email_admin_activity) sends no email unless an admin turns one on;
--   * not an operator type, so the Slack mirror never relays it; sms_kind_for has no admin_activity branch (no text).
--
-- WHO IS SKIPPED (admin_activity_notice, the one helper): a NULL actor, a test subject (is_test_subject: is_seed,
-- test_accounts, fixture/reserved email), an admin (the owner does not need a notice for her own listing), and a row
-- the caller marks is_seed. Callers pass the OTHER party too where there is one (an order's seller), and a test other
-- party skips it as well, so a test order never reaches the bell.
--
-- FLOODS: one notice per actor per kind per 10 minutes. A second activity of the same kind inside the window rewrites
-- the admins' unread notice in place ("Sarah S. listed 5 items") instead of adding a row
-- (admin_activity_last holds the window). The words are fixed templates plus the member's display name
-- (member_display_name: first name + last initial) and the item/job title and price.
--
-- WHAT RINGS (each an AFTER trigger whose function catches its own errors: a notice can never fail a checkout):
--   Declutter  item published (draft/pending_review -> live, or inserted live; Free when its price is 0), Wanted post,
--              money offer, trade offer, checkout started (order created), order paid, Free item asked for and picked,
--              order handed over, a paid order cancelled/refunded, a refund request.
--   Jobs       posted (not auto-created repeat visits), applied to, hired (-> accepted), done (-> completed),
--              cancelled (-> cancelled).
--   Shops      an order placed (the card hold lands: held_at set).
--   Reports    every new report.
-- NOT added (already ring the bell): support tickets (notify_admins_support_ticket, 20261030212558) and Declutter
-- problems ("Declutter problem reported", admin_alert).
--
-- SECURITY: admin_activity_notice and the trigger functions are SECURITY DEFINER with search_path pinned, EXECUTE
-- revoked from PUBLIC, anon and authenticated (service_role only; triggers run them as the table owner). Listed in
-- scripts/ci/definer-exec-allowlist.json.
-- MONEY: none (reads amounts to print them; writes notifications only).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DROP/ADD of the type CHECK, ON CONFLICT,
-- CREATE OR REPLACE, DROP TRIGGER IF EXISTS. Proof: src/test/pglite/adminActivityBell.pglite.mjs (3x).

-- 1. The type and its (off by default) push and email switches.
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS admin_activity boolean NOT NULL DEFAULT false;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS email_admin_activity boolean NOT NULL DEFAULT false;

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
    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted', 'declutter_questions',
    'shops_orders', 'shops_messages', 'shops_updates',
    -- Admin bell activity (20261112061000): bell only.
    'admin_activity'
  ));

INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('admin_activity', 'admin_activity', 'Admin: member activity in the bell (listings, offers, sales, jobs, Shops orders). Push and email off by default.')
ON CONFLICT (type) DO UPDATE
  SET pref_column = EXCLUDED.pref_column,
      description = EXCLUDED.description;

-- 2. The flood window: the last notice per actor and kind.
CREATE TABLE IF NOT EXISTS public.admin_activity_last (
  actor_id uuid NOT NULL,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL,
  n integer NOT NULL DEFAULT 1,
  PRIMARY KEY (actor_id, kind)
);
ALTER TABLE public.admin_activity_last ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_activity_last FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admin_activity_last TO service_role;

-- 3. The one helper. p_other: the other party (or NULL); p_bulk: the words for N of this kind ('listed %s items'),
--    NULL to keep the first message with "and N more".
CREATE OR REPLACE FUNCTION public.admin_activity_notice(
  p_actor uuid, p_other uuid, p_kind text, p_title text, p_message text, p_link text, p_bulk text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_last public.admin_activity_last%ROWTYPE;
  v_name text;
  v_msg text;
BEGIN
  IF p_actor IS NULL OR p_kind IS NULL OR p_title IS NULL OR p_message IS NULL THEN
    RETURN 'skipped';
  END IF;
  -- Test data never reaches the owner: the actor or the other party a test subject.
  IF public.is_test_subject(p_actor) OR (p_other IS NOT NULL AND public.is_test_subject(p_other)) THEN
    RETURN 'test';
  END IF;
  -- An admin's own action rings nobody.
  IF public.has_role(p_actor, 'admin') THEN
    RETURN 'admin';
  END IF;
  SELECT * INTO v_last FROM public.admin_activity_last WHERE actor_id = p_actor AND kind = p_kind FOR UPDATE;
  IF FOUND AND v_last.sent_at > now() - interval '10 minutes' THEN
    -- Collapse: rewrite the admins' notice from the window in place (unread again), never a second row.
    UPDATE public.admin_activity_last SET n = n + 1 WHERE actor_id = p_actor AND kind = p_kind
      RETURNING * INTO v_last;
    SELECT public.member_display_name(p.full_name) INTO v_name FROM public.profiles p WHERE p.user_id = p_actor;
    v_msg := CASE WHEN p_bulk IS NOT NULL THEN coalesce(v_name, 'A member') || ' ' || format(p_bulk, v_last.n)
                  ELSE p_message || format(' (and %s more)', v_last.n - 1) END;
    UPDATE public.notifications x
       SET message = v_msg, read = false
     WHERE x.type = 'admin_activity' AND x.title = p_title AND x.created_at = v_last.sent_at
       AND x.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin');
    RETURN 'collapsed';
  END IF;
  INSERT INTO public.notifications (user_id, title, message, type, link, actor_id)
  SELECT ur.user_id, p_title, p_message, 'admin_activity', p_link, p_actor
    FROM (SELECT DISTINCT r.user_id FROM public.user_roles r WHERE r.role = 'admin') ur;
  INSERT INTO public.admin_activity_last (actor_id, kind, sent_at, n) VALUES (p_actor, p_kind, now(), 1)
  ON CONFLICT (actor_id, kind) DO UPDATE SET sent_at = EXCLUDED.sent_at, n = 1;
  RETURN 'sent';
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_activity_notice(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_notice(uuid, uuid, text, text, text, text, text) TO service_role;

-- "Sarah S." for a member id ('A member' when none).
CREATE OR REPLACE FUNCTION public.admin_activity_name(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT coalesce((SELECT public.member_display_name(p.full_name, 'A member') FROM public.profiles p WHERE p.user_id = p_user), 'A member');
$fn$;
REVOKE ALL ON FUNCTION public.admin_activity_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_name(uuid) TO service_role;

-- "$40" / "$3.85" / "Free".
CREATE OR REPLACE FUNCTION public.admin_activity_money(p_cents integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_cents IS NULL THEN NULL
              WHEN p_cents = 0 THEN 'Free'
              WHEN p_cents % 100 = 0 THEN '$' || (p_cents / 100)::text
              ELSE '$' || to_char(p_cents / 100.0, 'FM999999990.00') END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_activity_money(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_money(integer) TO service_role;

-- The first item's title on a Declutter order.
CREATE OR REPLACE FUNCTION public.admin_activity_order_title(p_order uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT coalesce((SELECT coalesce(i.title, c.item_title) FROM public.declutter_cart_items c
                     LEFT JOIN public.declutter_items i ON i.id = c.item_id
                    WHERE c.order_id = p_order ORDER BY c.created_at, c.id LIMIT 1), 'a Declutter order');
$fn$;
REVOKE ALL ON FUNCTION public.admin_activity_order_title(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_order_title(uuid) TO service_role;

-- 4. The triggers. Each catches its own errors (a notice never fails the member's action).

-- Declutter: an item published (Free when its price is 0).
CREATE OR REPLACE FUNCTION public.admin_activity_on_declutter_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_free boolean;
BEGIN
  IF NEW.status = 'live' AND NOT coalesce(NEW.is_seed, false)
     AND (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'pending_review')) THEN
    v_free := coalesce(NEW.current_price_cents, NEW.price_cents) = 0;
    PERFORM public.admin_activity_notice(NEW.seller_id, NULL,
      CASE WHEN v_free THEN 'declutter_free' ELSE 'declutter_listed' END,
      CASE WHEN v_free THEN 'New Free item' ELSE 'New listing' END,
      public.admin_activity_name(NEW.seller_id) || ' listed ' || coalesce(NEW.title, 'an item') || ' · '
        || coalesce(public.admin_activity_money(coalesce(NEW.current_price_cents, NEW.price_cents)), 'no price'),
      '/declutter/item/' || NEW.id::text,
      CASE WHEN v_free THEN 'listed %s Free items' ELSE 'listed %s items' END);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_declutter_item: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_declutter_item ON public.declutter_items;
CREATE TRIGGER trg_admin_activity_declutter_item
  AFTER INSERT OR UPDATE OF status ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_declutter_item();

-- Declutter: a Wanted post.
CREATE OR REPLACE FUNCTION public.admin_activity_on_declutter_wanted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT coalesce(NEW.is_seed, false) THEN
    PERFORM public.admin_activity_notice(NEW.user_id, NULL, 'declutter_wanted', 'New Wanted post',
      public.admin_activity_name(NEW.user_id) || ' is looking for ' || coalesce(NEW.what, 'something')
        || coalesce(' · up to ' || public.admin_activity_money(NEW.max_price_cents), ''),
      '/admin?view=people&user=' || NEW.user_id::text, 'posted %s Wanted posts');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_declutter_wanted: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_declutter_wanted ON public.declutter_wanted;
CREATE TRIGGER trg_admin_activity_declutter_wanted
  AFTER INSERT ON public.declutter_wanted
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_declutter_wanted();

-- Declutter: a money offer, or a seller's answer to a Wanted post (an offer row with wanted_id: the SELLER acts).
CREATE OR REPLACE FUNCTION public.admin_activity_on_declutter_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT coalesce(NEW.is_seed, false) AND NEW.wanted_id IS NOT NULL THEN
    PERFORM public.admin_activity_notice(NEW.seller_id, NEW.buyer_id, 'declutter_wanted_reply', 'Wanted post answered',
      public.admin_activity_name(NEW.seller_id) || ' offered '
        || coalesce((SELECT i.title FROM public.declutter_items i WHERE i.id = NEW.item_id), 'an item')
        || coalesce(' · ' || public.admin_activity_money(NEW.amount_cents), '') || ' to a Wanted post',
      '/declutter/item/' || NEW.item_id::text, 'answered %s Wanted posts');
  ELSIF NOT coalesce(NEW.is_seed, false) THEN
    PERFORM public.admin_activity_notice(NEW.buyer_id, NEW.seller_id, 'declutter_offer', 'New offer',
      public.admin_activity_name(NEW.buyer_id) || ' offered ' || coalesce(public.admin_activity_money(NEW.amount_cents), 'an amount')
        || ' for ' || coalesce((SELECT i.title FROM public.declutter_items i WHERE i.id = NEW.item_id), 'an item'),
      '/declutter/item/' || NEW.item_id::text, 'made %s offers');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_declutter_offer: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_declutter_offer ON public.declutter_offers;
CREATE TRIGGER trg_admin_activity_declutter_offer
  AFTER INSERT ON public.declutter_offers
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_declutter_offer();

-- Declutter: a trade offer.
CREATE OR REPLACE FUNCTION public.admin_activity_on_declutter_swap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT coalesce(NEW.is_seed, false) THEN
    PERFORM public.admin_activity_notice(NEW.buyer_id, NEW.seller_id, 'declutter_trade', 'New trade offer',
      public.admin_activity_name(NEW.buyer_id) || ' offered a trade for '
        || coalesce((SELECT i.title FROM public.declutter_items i WHERE i.id = NEW.item_id), 'an item'),
      '/declutter/item/' || NEW.item_id::text, 'offered %s trades');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_declutter_swap: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_declutter_swap ON public.declutter_swap_offers;
CREATE TRIGGER trg_admin_activity_declutter_swap
  AFTER INSERT ON public.declutter_swap_offers
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_declutter_swap();

-- Declutter: an order's checkout started, paid, handed over, or a paid order cancelled/refunded.
CREATE OR REPLACE FUNCTION public.admin_activity_on_declutter_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_link text := '/admin?view=people&user=' || NEW.buyer_id::text;
BEGIN
  IF coalesce(NEW.is_seed, false) OR NEW.buyer_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.admin_activity_notice(NEW.buyer_id, NEW.seller_id, 'declutter_checkout', 'Checkout started',
      public.admin_activity_name(NEW.buyer_id) || ' started checkout for ' || public.admin_activity_order_title(NEW.id)
        || coalesce(' · ' || public.admin_activity_money(NEW.total_cents), ''),
      v_link, 'started %s checkouts');
  ELSIF NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL THEN
    PERFORM public.admin_activity_notice(NEW.buyer_id, NEW.seller_id, 'declutter_paid', 'Order paid',
      public.admin_activity_name(NEW.buyer_id) || ' paid ' || coalesce(public.admin_activity_money(NEW.total_cents), '')
        || ' for ' || public.admin_activity_order_title(NEW.id),
      v_link, 'paid for %s orders');
  ELSIF NEW.status = 'handed_over' AND OLD.status IS DISTINCT FROM 'handed_over' THEN
    PERFORM public.admin_activity_notice(NEW.seller_id, NEW.buyer_id, 'declutter_handed_over', 'Order handed over',
      public.admin_activity_name(NEW.seller_id) || ' handed over ' || public.admin_activity_order_title(NEW.id)
        || ' to ' || public.admin_activity_name(NEW.buyer_id),
      v_link, 'handed over %s orders');
  -- A paid order cancelled, or refunded before or after the handover (shipping refund, lost parcel).
  ELSIF (OLD.status = 'paid' AND NEW.status IN ('refunded', 'expired', 'superseded'))
     OR (OLD.status = 'handed_over' AND NEW.status = 'refunded') THEN
    PERFORM public.admin_activity_notice(NEW.buyer_id, NEW.seller_id, 'declutter_cancelled', 'Order cancelled',
      'The order for ' || public.admin_activity_order_title(NEW.id) || ' (' || public.admin_activity_name(NEW.buyer_id)
        || ' from ' || public.admin_activity_name(NEW.seller_id) || ') was cancelled',
      v_link, 'had %s orders cancelled');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_declutter_order: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_declutter_order ON public.declutter_orders;
CREATE TRIGGER trg_admin_activity_declutter_order
  AFTER INSERT OR UPDATE OF paid_at, status ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_declutter_order();

-- Declutter: a Free item asked for, and picked.
CREATE OR REPLACE FUNCTION public.admin_activity_on_declutter_free_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_title text := coalesce((SELECT i.title FROM public.declutter_items i WHERE i.id = NEW.item_id), 'a Free item');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.admin_activity_notice(NEW.requester_id, NEW.seller_id, 'declutter_free_asked', 'Free item asked for',
      public.admin_activity_name(NEW.requester_id) || ' asked for ' || v_title,
      '/declutter/item/' || NEW.item_id::text, 'asked for %s Free items');
  ELSIF NEW.status = 'picked' AND OLD.status IS DISTINCT FROM 'picked' THEN
    PERFORM public.admin_activity_notice(NEW.seller_id, NEW.requester_id, 'declutter_free_picked', 'Free item given',
      public.admin_activity_name(NEW.seller_id) || ' picked ' || public.admin_activity_name(NEW.requester_id) || ' for ' || v_title,
      '/declutter/item/' || NEW.item_id::text, 'gave away %s Free items');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_declutter_free_request: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_declutter_free_request ON public.declutter_free_requests;
CREATE TRIGGER trg_admin_activity_declutter_free_request
  AFTER INSERT OR UPDATE OF status ON public.declutter_free_requests
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_declutter_free_request();

-- Declutter: a refund request.
CREATE OR REPLACE FUNCTION public.admin_activity_on_declutter_refund_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = NEW.order_id;
  IF NOT coalesce(NEW.is_seed, false) AND NOT coalesce(o.is_seed, false) THEN
    PERFORM public.admin_activity_notice(o.buyer_id, o.seller_id, 'declutter_refund', 'Refund requested',
      public.admin_activity_name(o.buyer_id) || ' asked for a refund on ' || public.admin_activity_order_title(o.id),
      '/admin?view=people&user=' || o.buyer_id::text, 'asked for %s refunds');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_declutter_refund_request: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_declutter_refund_request ON public.declutter_refund_requests;
CREATE TRIGGER trg_admin_activity_declutter_refund_request
  AFTER INSERT ON public.declutter_refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_declutter_refund_request();

-- Jobs: posted, hired, done, cancelled.
CREATE OR REPLACE FUNCTION public.admin_activity_on_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_link text := '/admin?view=jobs&job=' || NEW.id::text;
  v_title text := coalesce(NEW.title, 'a job');
BEGIN
  IF coalesce(NEW.is_seed, false) OR coalesce(NEW.is_auto_created, false) OR NEW.customer_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.admin_activity_notice(NEW.customer_id, NULL, 'job_posted', 'New job',
      public.admin_activity_name(NEW.customer_id) || ' posted ' || v_title
        || coalesce(' · ' || public.admin_activity_money((NEW.budget * 100)::integer), ''),
      v_link, 'posted %s jobs');
  ELSIF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' AND OLD.status IN ('open', 'pending', 'pending_payment') THEN
    PERFORM public.admin_activity_notice(NEW.customer_id, NEW.helper_id, 'job_hired', 'Helpr hired',
      public.admin_activity_name(NEW.customer_id) || ' hired ' || public.admin_activity_name(NEW.helper_id) || ' for ' || v_title,
      v_link, 'hired for %s jobs');
  ELSIF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM public.admin_activity_notice(NEW.customer_id, NEW.helper_id, 'job_done', 'Job done',
      v_title || ' is done (' || public.admin_activity_name(NEW.helper_id) || ' for ' || public.admin_activity_name(NEW.customer_id) || ')',
      v_link, 'had %s jobs done');
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    PERFORM public.admin_activity_notice(NEW.customer_id, NEW.helper_id, 'job_cancelled', 'Job cancelled',
      v_title || ' (' || public.admin_activity_name(NEW.customer_id) || ') was cancelled',
      v_link, 'had %s jobs cancelled');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_job: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_job ON public.jobs;
CREATE TRIGGER trg_admin_activity_job
  AFTER INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_job();

-- Jobs: an application.
CREATE OR REPLACE FUNCTION public.admin_activity_on_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  j public.jobs;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = NEW.job_id;
  IF NOT coalesce(j.is_seed, false) THEN
    PERFORM public.admin_activity_notice(NEW.helper_id, j.customer_id, 'job_applied', 'New application',
      public.admin_activity_name(NEW.helper_id) || ' applied to ' || coalesce(j.title, 'a job'),
      '/admin?view=jobs&job=' || NEW.job_id::text, 'applied to %s jobs');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_application: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_application ON public.applications;
CREATE TRIGGER trg_admin_activity_application
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_application();

-- Shops: an order placed (the card hold lands).
CREATE OR REPLACE FUNCTION public.admin_activity_on_shop_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.held_at IS NOT NULL AND OLD.held_at IS NULL AND NOT coalesce(NEW.is_seed, false) THEN
    PERFORM public.admin_activity_notice(NEW.buyer_id, NEW.seller_id, 'shop_order', 'New Shops order',
      public.admin_activity_name(NEW.buyer_id) || ' ordered from '
        || coalesce((SELECT s.name FROM public.shops s WHERE s.id = NEW.shop_id), 'a shop')
        || coalesce(' · ' || public.admin_activity_money(NEW.total_cents), ''),
      '/admin?view=shops', 'placed %s Shops orders');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_shop_order: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_shop_order ON public.shop_orders;
CREATE TRIGGER trg_admin_activity_shop_order
  AFTER UPDATE OF held_at ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_shop_order();

-- Reports: every new report.
CREATE OR REPLACE FUNCTION public.admin_activity_on_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.admin_activity_notice(NEW.reporter_id, NULL, 'report', 'New report',
    public.admin_activity_name(NEW.reporter_id) || ' reported a ' || replace(coalesce(NEW.reported_type, 'listing'), '_', ' ')
      || coalesce(' · ' || left(NEW.reason, 60), ''),
    '/admin?view=reports', 'filed %s reports');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_activity_on_report: %', SQLERRM;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_admin_activity_report ON public.reports;
CREATE TRIGGER trg_admin_activity_report
  AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.admin_activity_on_report();

-- Trigger functions: nobody calls them directly.
DO $do$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_activity_on_declutter_item', 'admin_activity_on_declutter_wanted',
    'admin_activity_on_declutter_offer', 'admin_activity_on_declutter_swap', 'admin_activity_on_declutter_order',
    'admin_activity_on_declutter_free_request', 'admin_activity_on_declutter_refund_request', 'admin_activity_on_job',
    'admin_activity_on_application', 'admin_activity_on_shop_order', 'admin_activity_on_report']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I() TO service_role', f);
  END LOOP;
END
$do$;
