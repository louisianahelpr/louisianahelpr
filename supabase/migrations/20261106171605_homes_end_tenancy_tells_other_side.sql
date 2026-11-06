-- Q2068 (docs/NOT-LAUNCHED.md, Homes): ending a tenancy told nobody. rentals_end_tenancy changed the row and notified
-- neither side, so a tenant whose landlord ended it found out only when /rentals stopped listing the home, and a
-- landlord whose tenant left was not told. Now the OTHER party gets one in-app notice; the caller gets none. An
-- unused invite (invited -> revoked) tells nobody: its invitee never joined. Homes stays behind its switch (testers).
-- The landlord's notice names the deposit clock: a lessor must return the deposit, or send an itemized statement of
-- what was kept, within one month after the lease ends (La. R.S. 9:3251(A)); the deposit tracker (Q2224) runs it.
-- RESTATED FROM THE NEWEST CREATE on origin/main, checked by name:
--   rentals_end_tenancy  from 20261103071432 (newest), verbatim except the RETURNING row and the notice after it
-- rentals_notify (20261017205605) is unchanged: it carries the actor in the link, so the seed-boundary trigger keeps a
-- test account from notifying a real person (Q137).
-- REPLAY-SAFE: CREATE OR REPLACE. Grants as before: authenticated + service_role, never PUBLIC or anon.
-- MONEY: none. AUTHZ: none new (same caller rule: the landlord or the tenant of the row).
-- Proof: src/test/pglite/rentalsMaintenance.pglite.mjs "end tenancy tells the other side" (Q2068=skip red).

CREATE OR REPLACE FUNCTION public.rentals_end_tenancy(p_tenancy_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.rental_tenancies%ROWTYPE;
  v_label text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rental_tenancies
     SET status = CASE WHEN status = 'invited' THEN 'revoked' ELSE 'ended' END, ended_at = now()
   WHERE id = p_tenancy_id AND status IN ('invited', 'active')
     AND (landlord_id = v_uid OR tenant_id = v_uid)
  RETURNING * INTO v_t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenancy_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- CHANGED (Q2068): an active tenancy that just ended tells the other party, in the app. Never the caller, never
  -- the invitee of an unused invite (revoked), never a deleted account (tenant_id / landlord_id null).
  IF v_t.status = 'ended' THEN
    SELECT p.label INTO v_label FROM public.rental_properties p WHERE p.id = v_t.property_id;
    v_label := COALESCE(NULLIF(btrim(v_label), ''), 'your rental');
    IF v_uid = v_t.landlord_id AND v_t.tenant_id IS NOT NULL THEN
      PERFORM public.rentals_notify(v_t.tenant_id, 'Tenancy ended',
        'Your landlord ended your tenancy at ' || v_label || '. Your rent, deposit and lease records stay under Homes.',
        '/rentals', false);
    ELSIF v_uid = v_t.tenant_id AND v_t.landlord_id IS NOT NULL THEN
      PERFORM public.rentals_notify(v_t.landlord_id, 'Tenancy ended',
        'Your tenant ended their tenancy at ' || v_label || '. If you hold a deposit, Louisiana gives you one month to return it or send an itemized statement (La. R.S. 9:3251).',
        '/rentals', false);
    END IF;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_end_tenancy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_end_tenancy(uuid) TO authenticated, service_role;
