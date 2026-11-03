-- Q2390 packet 31 (REGULAR packet: lead review): "not found" answers HTTP 404,
-- not 500, for six functions that still raised P0002:
--   declutter_refund_item_returned (seller; both raises come before the
--        request lock, the refund and the UPDATE. refundRequests.ts maps by
--        message.)
--   declutter_withdraw_refund (buyer; both raises come before the request lock
--        and the UPDATE/notify. refundRequests.ts maps by message.)
--   declutter_admin_waive_fee_debt (admin; raises at the debt read, before the
--        locked read, the UPDATE, the audit row and the notice.
--        adminRpcErrorCopy.ts maps by message.)
--   rentals_propose_visit (the job's Helpr; both raises come before the
--        UPDATE/notify. src/lib/rentals/api.ts maps by message.)
--   rentals_confirm_visit (tenant; three not-found raises, all before the
--        UPDATE/notify. Its 'no_visit_proposed' also used P0002 but is a state
--        refusal, not a missing row: it becomes '22023' (400), lead 11-03.
--        api.ts maps by message, so members see no change.)
--   rentals_lease_save (landlord; raises at the locked tenancy read, before
--        the lease INSERT/UPDATE. src/lib/rentals/lease.ts maps by message.)
-- No edge map changes, no deploy.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-03, md5 equal
-- to the newest migration copy; return type, volatility, SECURITY DEFINER and
-- search_path as on prod). Name, newest copy, prod md5:
--   declutter_refund_item_returned         20261030071818 0ec3415ad7c3fb6efb34a824cf47a9d3
--   declutter_admin_waive_fee_debt         20261102065446 169540b54cddb75ff523a3d84935da95
--   declutter_withdraw_refund              20261031181404 38259221296ab45e4393024bb3d05695
--   rentals_propose_visit                  20261017221621 4f84fead4c8a30bd17dca2c55effcf70
--   rentals_confirm_visit                  20261017221621 182e6a3af5589ac17f347c3e0c75024d
--   rentals_lease_save                     20261019110137 a17f929c2d1928f6cdddc65ad4d69fa2
--
-- The ONLY change in each body: ERRCODE = 'P0002' -> 'PT404' (11 lines), and
-- rentals_confirm_visit's 'no_visit_proposed' (a state refusal, not a missing
-- row) P0002 -> '22023' (lead 11-03). With PT404 and that one '22023' swapped
-- back, every body's md5 equals its prod md5 above. Grants are
-- restated as on prod.

CREATE OR REPLACE FUNCTION public.declutter_refund_item_returned(p_request_id uuid, p_photo_path text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_out jsonb;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'returning' THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  -- The optional photo: the seller's own, in the order's return folder, from the camera now.
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF p_photo_path IS NOT NULL THEN
    IF NOT public.declutter_return_photo_ok(o.id, v_uid, p_photo_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
      RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
        HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
    END IF;
  END IF;
  -- No deadline on the seller's own confirmation: until the sweep hands it to an admin (status changes), the
  -- seller may still say the item is back, and the buyer is refunded.
  v_out := public.declutter_refund_after_handover(o.id, 'refund_request_full', NULL);
  UPDATE public.declutter_refund_requests
     SET status = 'agreed', returned_at = now(), refund_id = (v_out->>'refund_id')::uuid, settled_at = now(),
         returned_photo_path = p_photo_path
   WHERE id = r.id;
  RETURN v_out || jsonb_build_object('result', 'refunded');
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_refund_item_returned(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_refund_item_returned(uuid, text) TO authenticated, service_role;

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
    RAISE EXCEPTION 'debt_not_found' USING ERRCODE = 'PT404';
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

CREATE OR REPLACE FUNCTION public.declutter_withdraw_refund(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  -- Money review 2026-10-27 (lh-money-escrow + lh-authz-rls, SHOULD-FIX): once the
  -- seller agreed to a full refund ('returning') the buyer may already have
  -- handed the item back; a withdraw then would leave the seller with the item
  -- AND the payout. From 'returning' only the seller's "I got it back" or the
  -- return_by deadline (Louisiana Helpr decides) moves it on.
  IF r.status NOT IN ('open', 'offered') THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  -- A write like any other: a banned or suspended buyer cannot change the request (Q281 ban gate).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'withdrawn' WHERE id = r.id;
  -- CHANGED (20261031181404, AUD31-33): the old line promised "paid when the sale is final, 24 hours after the
  -- handover", a rule the owner replaced on 10-30 (both sides confirm; no pay on one side's word). The payout simply
  -- goes on as before the request. The item is named by the lock above (declutter_notice_names_item); the link is
  -- the Selling tab (?view=selling is retired).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Refund request withdrawn',
    'The buyer took back their refund request. Your payout goes ahead as usual.',
    '/declutter?tab=selling', v_uid);
  RETURN jsonb_build_object('result', 'withdrawn');
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_withdraw_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_refund(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_propose_visit(p_job_id uuid, p_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_req uuid;
  v_tenant uuid;
  v_last timestamptz;
  v_was_ok boolean;
  v_other_job boolean;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_at IS NULL OR p_at <= now() OR p_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'visit_time_invalid' USING ERRCODE = '22023';
  END IF;
  -- Hired AND confirmed: a Helpr who was only offered the job (helper_id set,
  -- helper_confirmed_at NULL: accept_application's offer) has not agreed to
  -- come, so may not offer a time to enter the tenant's home (lh-authz-rls #1).
  PERFORM 1 FROM public.jobs j
   WHERE j.id = p_job_id AND j.helper_id = v_uid AND j.helper_confirmed_at IS NOT NULL
     AND j.status::text IN ('accepted', 'in_progress', 'revision_requested')
     AND j.payment_status = 'escrow'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT r.id, r.tenant_id, r.visit_proposed_at, r.visit_confirmed_at IS NOT NULL, r.visit_job_id IS DISTINCT FROM p_job_id
    INTO v_req, v_tenant, v_last, v_was_ok, v_other_job FROM public.maintenance_requests r
   WHERE r.job_id = p_job_id AND r.status = 'approved'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.maintenance_requests
     SET visit_job_id = p_job_id, visit_proposed_for = p_at, visit_proposed_at = now(),
         visit_confirmed_at = NULL, updated_at = now()
   WHERE id = v_req;
  -- One notice per 10 minutes for un-OK'd re-offers on the same job: a Helpr
  -- changing the time again and again does not flood the tenant, who is not a
  -- party to the job (lh-authz-rls #4). A new offer that voids the tenant's OK,
  -- or follows an offer made for another job, is always told (re-review A2).
  IF v_last IS NULL OR v_was_ok OR v_other_job OR v_last < now() - interval '10 minutes' THEN
    PERFORM public.rentals_notify(v_tenant, 'A Helpr offered a visit time',
      'Open your repair request to OK the time.', '/rentals/requests/' || v_req::text, false);
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_propose_visit(uuid, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_propose_visit(uuid, timestamp with time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_confirm_visit(p_request_id uuid, p_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_job uuid;
  v_helper uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.rentals_assert_member();
  SELECT r.job_id INTO v_job FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.tenant_id = v_uid AND r.status = 'approved';
  IF NOT FOUND OR v_job IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT j.helper_id INTO v_helper FROM public.jobs j
   WHERE j.id = v_job AND j.helper_confirmed_at IS NOT NULL
     AND j.status::text IN ('accepted', 'in_progress', 'revision_requested')
     AND j.payment_status = 'escrow'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'PT404';
  END IF;
  PERFORM 1 FROM public.maintenance_requests r
   WHERE r.id = p_request_id AND r.tenant_id = v_uid AND r.status = 'approved' AND r.job_id = v_job
     AND r.visit_job_id = v_job AND r.visit_proposed_for IS NOT NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_visit_proposed' USING ERRCODE = '22023';
  END IF;
  -- Only someone who still lives there OKs someone coming in (lh-authz-rls #2):
  -- the request's own tenancy must still be active.
  IF NOT EXISTS (SELECT 1 FROM public.maintenance_requests r
                   JOIN public.rental_tenancies t ON t.id = r.tenancy_id
                  WHERE r.id = p_request_id AND t.tenant_id = v_uid AND t.status = 'active') THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Stale guard: the time on the tenant's screen must be the one on file.
  IF p_at IS NULL OR NOT EXISTS (SELECT 1 FROM public.maintenance_requests r
                                  WHERE r.id = p_request_id AND r.visit_proposed_for = p_at) THEN
    RAISE EXCEPTION 'visit_time_changed' USING ERRCODE = '22023';
  END IF;
  IF p_at <= now() THEN
    RAISE EXCEPTION 'visit_time_passed' USING ERRCODE = '22023';
  END IF;
  UPDATE public.maintenance_requests SET visit_confirmed_at = now(), updated_at = now() WHERE id = p_request_id;
  PERFORM public.rentals_notify(v_helper, 'The tenant OK''d your visit time',
    'The visit time you offered is confirmed.', '/posts?job=' || v_job::text, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_confirm_visit(uuid, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_confirm_visit(uuid, timestamp with time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rentals_lease_save(p_tenancy_id uuid, p_template_version text, p_fields jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_t public.rental_tenancies%ROWTYPE;
  v_open public.rental_leases%ROWTYPE;
  v_bad integer;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT * INTO v_t FROM public.rental_tenancies WHERE id = p_tenancy_id FOR UPDATE;
  IF NOT FOUND OR v_t.landlord_id IS DISTINCT FROM v_uid OR v_t.status <> 'active' THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Blanks: an object of at most 300 keys (lower-case words), each a boolean or printable-ASCII text up to
  -- 4000 characters (the app normalises curly quotes, dashes and accents first; lead review #4).
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' OR octet_length(p_fields::text) > 65536
     OR p_template_version IS NULL OR p_template_version !~ '^la-[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'bad_lease_fields' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) FILTER (WHERE e.key !~ '^[a-z][a-z0-9_]{0,39}$'
                             OR jsonb_typeof(e.value) NOT IN ('string', 'boolean')
                             OR (jsonb_typeof(e.value) = 'string' AND (char_length(e.value #>> '{}') > 4000
                                                                       OR (e.value #>> '{}') ~ '[^\x20-\x7E\n]'))) + greatest(count(*) - 300, 0)
    INTO v_bad FROM jsonb_each(p_fields) e;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'bad_lease_fields' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_open FROM public.rental_leases WHERE tenancy_id = p_tenancy_id AND status IN ('draft', 'sent') FOR UPDATE;
  IF v_open.status = 'sent' THEN
    RAISE EXCEPTION 'lease_awaiting_signature' USING ERRCODE = '22023';
  END IF;
  IF v_open.id IS NULL THEN
    INSERT INTO public.rental_leases (tenancy_id, landlord_id, tenant_id, template_version, fields)
    VALUES (p_tenancy_id, v_t.landlord_id, v_t.tenant_id, p_template_version, p_fields) RETURNING id INTO v_id;
  ELSE
    UPDATE public.rental_leases SET template_version = p_template_version, fields = p_fields, updated_at = now()
     WHERE id = v_open.id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rentals_lease_save(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_lease_save(uuid, text, jsonb) TO authenticated, service_role;

