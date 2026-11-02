-- Q1928 gap 1 (builder 156): an admin can clear what a member still owes from a Declutter refund.
--
-- A seller who is out (banned, suspended, 3 strikes, flagged business-like) when a buyer pays owes that payment's card
-- cost (declutter_seller_fee_debts, owner answer 7, 2026-10-17); so does a seller at fault and a Helpr at fault. When
-- the ban or flag behind it is overturned, nothing could undo the debt: it kept coming out of the member's next
-- payouts. Now an admin lists a member's open amounts and clears one, with a reason:
--   declutter_admin_fee_debts(p_user)          -> the member's amounts still owed (admin only)
--   declutter_admin_waive_fee_debt(p_debt, p_note) -> remaining_cents to 0, who/when/why on the row, an
--                                                  admin_audit_log row, the member told once (admin only)
-- Only what is still owed is cleared; what a payout already took stays taken (declutter_fee_debt_deductions keeps it).
-- The same advisory lock as declutter_consume_fee_debt (20261014224914), so a payout running at the same moment either
-- takes before the clear (the clear then clears the rest) or after it (it then takes nothing from this row).
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, grants restated.

ALTER TABLE public.declutter_seller_fee_debts ADD COLUMN IF NOT EXISTS waived_at timestamptz;
ALTER TABLE public.declutter_seller_fee_debts ADD COLUMN IF NOT EXISTS waived_by uuid;
ALTER TABLE public.declutter_seller_fee_debts ADD COLUMN IF NOT EXISTS waived_cents integer;
ALTER TABLE public.declutter_seller_fee_debts ADD COLUMN IF NOT EXISTS waive_note text;
COMMENT ON COLUMN public.declutter_seller_fee_debts.waived_at IS
  'Q1928 gap 1: when an admin cleared what was still owed (declutter_admin_waive_fee_debt); null = not cleared.';

CREATE OR REPLACE FUNCTION public.declutter_admin_fee_debts(p_user uuid)
RETURNS TABLE (id uuid, amount_cents integer, remaining_cents integer, created_at timestamptz, reason text,
               items text, fee_estimated boolean, waived_at timestamptz, waived_cents integer, waive_note text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT d.id, d.amount_cents, d.remaining_cents, d.created_at,
         COALESCE(r.reason, CASE WHEN d.raise_id IS NOT NULL THEN 'delivery_raise'
                                 WHEN d.shop_refund_id IS NOT NULL THEN 'shop_refund' ELSE 'other' END),
         CASE WHEN r.order_id IS NOT NULL THEN public.declutter_order_items_named(r.order_id) END,
         d.fee_estimated, d.waived_at, d.waived_cents, d.waive_note
    FROM public.declutter_seller_fee_debts d
    LEFT JOIN public.declutter_refunds r ON r.id = d.refund_id
   WHERE d.seller_id = p_user
   ORDER BY d.created_at DESC, d.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_fee_debts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_fee_debts(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_waive_fee_debt(p_debt_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  v_seller uuid;
  d record;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  SELECT x.seller_id INTO v_seller FROM public.declutter_seller_fee_debts x WHERE x.id = p_debt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'debt_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- The payout path's lock (declutter_consume_fee_debt), then the row.
  PERFORM pg_advisory_xact_lock(hashtextextended('declutter_fee_debt:' || v_seller::text, 0));
  SELECT x.id, x.remaining_cents, x.waived_at, x.waived_cents INTO d
    FROM public.declutter_seller_fee_debts x WHERE x.id = p_debt_id FOR UPDATE;
  IF d.waived_at IS NOT NULL THEN
    -- Already cleared: the same answer, nothing written twice.
    RETURN jsonb_build_object('result', 'already_waived', 'waived_cents', d.waived_cents);
  END IF;
  IF d.remaining_cents <= 0 THEN
    RAISE EXCEPTION 'nothing_owed' USING ERRCODE = '55000', HINT = 'This amount was already paid back from a payout.';
  END IF;
  UPDATE public.declutter_seller_fee_debts
     SET remaining_cents = 0, waived_at = now(), waived_by = v_uid, waived_cents = d.remaining_cents, waive_note = v_note
   WHERE id = d.id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_admin_waive_fee_debt', 'declutter_seller_fee_debt', d.id::text,
          jsonb_build_object('seller_id', v_seller, 'waived_cents', d.remaining_cents, 'note', v_note));
  -- In words, never a fee name (owner: members see no fee words).
  PERFORM public.declutter_notify(v_seller, 'declutter_refunds', 'Amount owed cleared',
    format('Louisiana Helpr cleared the $%s you owed from a refund. It won''t come out of your payouts.',
           to_char(d.remaining_cents / 100.0, 'FM999990.00')),
    '/declutter?tab=selling', NULL);
  RETURN jsonb_build_object('result', 'waived', 'waived_cents', d.remaining_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_waive_fee_debt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_waive_fee_debt(uuid, text) TO authenticated, service_role;
