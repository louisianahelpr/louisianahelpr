-- Declutter "Add a Helpr" (owner 2026-10-16; spec docs/specs/declutter-add-a-helpr.md,
-- approved earlier as row 72 "Sold it? Get help" of docs/specs/declutter-auctions.md).
--
-- A buyer who paid for a Declutter item can, in one tap, book a Helpr to put it
-- together, hang it on the wall or set it up at their place. NO new money path:
-- the tap opens Post a Job pre-filled (category assembly or handyman), the buyer
-- confirms and pays through the normal job checkout, and the job is an ordinary
-- Helpr job (escrow, fees, payouts, disputes all unchanged). The only new thing
-- is the LINK between the Declutter order and that job, written right after the
-- post is created (before payment, like link_str_turnover_job, 20261007145950).
--
--   declutter_order_jobs          the link: one row per job, many jobs per order.
--                                 `purpose` says why the job exists ('setup'
--                                 here; Helpr delivery can add its own value).
--                                 No client privilege: read and written only
--                                 through the two functions below.
--   declutter_setup_helpr(order)  the buyer's pre-fill: item titles, booked
--                                 pickup time, and the jobs already linked.
--   declutter_link_setup_job(order, job)
--                                 the buyer links their own open job to their
--                                 own paid order.
--
-- Both are behind the hidden switch 'declutter_add_helpr' (created 'testers').
-- The offer stands while the order is paid and for 30 days after the handover.
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT; grants restated.

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('declutter_add_helpr', 'testers',
        'Declutter "Add a Helpr": after buying, one tap books a Helpr to assemble, wall-mount or set up the item (a normal Helpr job linked to the order)')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.declutter_order_jobs (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('setup')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS declutter_order_jobs_order ON public.declutter_order_jobs (order_id);

ALTER TABLE public.declutter_order_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_order_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_order_jobs TO service_role;

COMMENT ON TABLE public.declutter_order_jobs IS
  'A Helpr job booked for a Declutter order (purpose setup = assemble / wall-mount / set up at the buyer''s place). '
  'The job is a normal job paid through the job checkout; this row only links it. Written by declutter_link_setup_job.';

DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The buyer's pre-fill for Post a Job, and what is already booked.
CREATE OR REPLACE FUNCTION public.declutter_setup_helpr(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
BEGIN
  PERFORM public.require_feature('declutter_add_helpr');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders
   WHERE id = p_order_id AND buyer_id = v_uid;
  IF NOT FOUND OR o.status NOT IN ('paid', 'handed_over')
     OR (o.status = 'handed_over' AND COALESCE(o.handed_over_at, o.paid_at, '-infinity'::timestamptz) < now() - interval '30 days') THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'status', o.status,
    'handover', o.handover,
    'items', COALESCE((
      SELECT jsonb_agg(i.title ORDER BY c.created_at, i.id)
        FROM public.declutter_cart_items c
        JOIN public.declutter_items i ON i.id = c.item_id
       WHERE c.order_id = o.id AND c.buyer_id = v_uid), '[]'::jsonb),
    'pickup_at', (SELECT b.slot_start FROM public.declutter_bookings b WHERE b.order_id = o.id),
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'job_id', j.id, 'title', j.title, 'category', j.category::text,
               'status', j.status, 'payment_status', j.payment_status)
             ORDER BY l.created_at, j.id)
        FROM public.declutter_order_jobs l
        JOIN public.jobs j ON j.id = l.job_id
       WHERE l.order_id = o.id AND j.customer_id = v_uid), '[]'::jsonb));
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_setup_helpr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_setup_helpr(uuid) TO authenticated, service_role;

-- Link the buyer's own just-posted job to their own paid order. True = linked
-- (or already linked to this order); false = not the caller's paid order, or
-- the job is already linked to another order. A job that is not the caller's
-- own open job RAISES 'not your open job' (42501). Any category links: the
-- pre-fill picks assembly or handyman, but a buyer who re-picks the category on
-- Post a Job still gets the link (lh-silent-failure review #1: a category gate
-- lost the link silently and hid the "already booked" warning).
CREATE OR REPLACE FUNCTION public.declutter_link_setup_job(p_order_id uuid, p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_cur uuid;
BEGIN
  PERFORM public.require_feature('declutter_add_helpr');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- FOR SHARE: the ownership reads decide the write (race-class rule).
  IF NOT EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open'
                  FOR SHARE) THEN
    RAISE EXCEPTION 'not your open job' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = p_order_id AND o.buyer_id = v_uid
                    AND (o.status = 'paid'
                         OR (o.status = 'handed_over' AND COALESCE(o.handed_over_at, o.paid_at, '-infinity'::timestamptz) >= now() - interval '30 days'))
                  FOR SHARE) THEN
    RETURN false;
  END IF;
  INSERT INTO public.declutter_order_jobs (job_id, order_id, purpose)
  VALUES (p_job_id, p_order_id, 'setup')
  ON CONFLICT (job_id) DO NOTHING;
  SELECT l.order_id INTO v_cur FROM public.declutter_order_jobs l WHERE l.job_id = p_job_id;
  RETURN v_cur = p_order_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_link_setup_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_link_setup_job(uuid, uuid) TO authenticated, service_role;
