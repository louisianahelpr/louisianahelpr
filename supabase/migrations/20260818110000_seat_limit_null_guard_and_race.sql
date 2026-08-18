-- Follow-up to 20260817120000. Two holes in the seat cap, both on the sibling
-- trigger that migration's own closing comment named as load-bearing.
--
-- 1. SILENT PASS ON A NULL LIMIT. `enforce_business_seat_limit()` does:
--
--        SELECT public.get_business_seat_limit(NEW.business_id) INTO v_limit;
--        ...
--        IF v_used >= v_limit THEN RAISE ...
--
--    `get_business_seat_limit` is a plain SQL SELECT over `businesses`, so it
--    returns NULL when no row matches. `v_used >= NULL` evaluates to NULL, the
--    IF does not fire, and the trigger returns NEW — a silent allow on the one
--    path 20260817120000 declared to be "the only thing bounding a
--    self-inserted owner row" (that trigger is the one WITHOUT the
--    `role='owner'` exemption). 20260817120000 added exactly this guard to
--    `enforce_business_member_limit` via COALESCE and left the sibling open.
--
--    Reachable today? BEFORE ROW triggers fire before FK validation, so the
--    NULL branch IS entered for a bogus business_id — then
--    `business_members_business_id_fkey` kills the row, so it is latent rather
--    than exploitable. It is one NOT VALID / deferred / dropped FK away from
--    being real, with nothing marking the dependency. Fail closed instead.
--
-- 2. COUNT-THEN-INSERT RACE. Both triggers count existing rows and rely on the
--    new row landing afterwards. Under READ COMMITTED, two concurrent invites
--    for the last seat both read `limit - 1` and both commit, putting the
--    business over cap with no error. That shape predates 20260817120000, but
--    that migration cut the caps from 2/5/10/25 down to 1/2/3/4, so a single
--    race is now a 25-100% overshoot on the boundary rather than a rounding
--    error. Taking FOR UPDATE on the parent `businesses` row serialises the
--    check per business; it is the row every invite already reads for its tier,
--    and invites are far too rare for the lock to matter.
--
-- Replay-safe: both functions exist by 20260426042619 / 20260425233224, well
-- before this file, and both are CREATE OR REPLACE with unchanged signatures.

-- The trigger WITHOUT an owner exemption — the backstop on owner-role rows.
CREATE OR REPLACE FUNCTION public.enforce_business_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_used  integer;
BEGIN
  -- Serialise concurrent invites for the same business (see note 2). Also
  -- resolves whether the parent row exists at all.
  PERFORM 1 FROM public.businesses WHERE id = NEW.business_id FOR UPDATE;

  SELECT public.get_business_seat_limit(NEW.business_id) INTO v_limit;

  -- Fail CLOSED. A missing businesses row yields NULL here, and `v_used >= NULL`
  -- is NULL, which would let the insert through silently.
  v_limit := COALESCE(v_limit, public.business_seat_limit_for_tier('starter'));

  SELECT count(*) INTO v_used
  FROM public.business_members
  WHERE business_id = NEW.business_id
    AND status IN ('pending', 'active');

  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'Seat limit reached (%). Upgrade your team plan to add more members.', v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Same lock on the tier-reading trigger, so the two agree under concurrency as
-- well as in the single-writer case. The COALESCE fail-closed from
-- 20260817120000 is preserved verbatim.
CREATE OR REPLACE FUNCTION public.enforce_business_member_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_count integer;
  seat_limit   integer;
BEGIN
  IF NEW.role = 'owner' THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.businesses WHERE id = NEW.business_id FOR UPDATE;

  SELECT public.business_seat_limit_for_tier(b.seat_tier)
    INTO seat_limit
  FROM public.businesses b
  WHERE b.id = NEW.business_id;

  seat_limit := COALESCE(seat_limit, public.business_seat_limit_for_tier('starter'));

  SELECT count(*) INTO member_count
  FROM public.business_members
  WHERE business_id = NEW.business_id
    AND status IN ('active', 'pending');

  IF member_count >= seat_limit THEN
    RAISE EXCEPTION 'This business has reached its %-seat limit. Upgrade to add more members.', seat_limit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
