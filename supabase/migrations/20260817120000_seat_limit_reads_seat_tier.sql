-- ============================================================================
-- Seat limit: enforce the ladder the app actually SELLS, not a hardcoded 2.
-- ============================================================================
--
-- THE BUG (revenue-affecting). `enforce_business_member_limit()` hardcoded a
-- cap of 2 rows and never looked at `businesses.seat_tier`. The app sells four
-- tiers (supabase/functions/_shared/businessSeatTiers.ts -> the ONE source of
-- truth for the marketing page, the in-app seat plan and Stripe checkout):
--
--     Starter  Free  1 seat
--     Crew     $20   2 seats
--     Team     $30   3 seats
--     Enterprise $40 4+ seats
--
-- so Team and Enterprise customers paid for seats the database physically
-- refused to let them use. When they hit the wall the UI told them
-- ("You've reached your {seat_limit}-seat limit. Upgrade your plan below to
-- add more members." -- src/pages/businessTeam/MembersTab.tsx) to spend MORE
-- money, which would have changed nothing. Verified live before this change:
-- the seeded "Bayou Property Services" business is on `team` (3 seats per the
-- client) with 2 rows used -- its next invite was rejected by this trigger.
--
-- THE DATABASE HAD FOUR DIFFERENT LADDERS, all live at once:
--   enforce_business_member_limit()      hardcoded 2         (the binding one)
--   get_business_seat_limit(uuid)        2 / 5 / 10 / 25
--   business_seat_limit(uuid)            2 / 5 / 10 / 15
--   client SEAT_LIMITS (useMyBusiness)   1 / 2 / 3 / 4       (what we sell)
-- Fixing only the first would leave three contradictory numbers in the schema
-- for the next person to pick the wrong one from, so all three SQL ladders now
-- delegate to ONE canonical helper below. The product ladder wins.
--
-- DOES THE LIMIT COUNT THE OWNER?  YES -- deliberately.
--   Starter 1 = the owner alone (a free solo business, no teammates)
--   Crew    2 = owner + 1        Team 3 = owner + 2        Enterprise 4 = owner + 3
-- That is already what the client does and what the customer is shown: the
-- owner IS a row in `business_members` (inserted by add_owner_as_member()),
-- `useTeamMembers` selects EVERY non-removed row including the owner's, and
-- BusinessTeam.tsx computes `totalSlots = active + pending` over that list to
-- render "X of N seats used". Excluding the owner server-side would silently
-- hand every tier one extra seat over what the "3 seats" on the pricing page
-- promises, and the meter would read "3 of 3 used" while a 4th invite still
-- succeeded -- i.e. the bug would just move. So the count stays `count(*)`
-- over all active/pending rows (unchanged from before) and the owner is
-- included in it.
--
-- The `NEW.role = 'owner'` early return is KEPT: it is what lets
-- add_owner_as_member() seat the founding owner, and it must keep working if
-- a future ownership-transfer path ever inserts an owner row into a business
-- that is already at its cap. It exempts that row from the CHECK, not from
-- the COUNT.
--
-- Replay-safe: `businesses.seat_tier` ships in 20260426042619 and
-- `business_members` in 20260425233224, both strictly earlier than this file,
-- so a from-scratch rebuild always finds them. Every function here is
-- CREATE OR REPLACE with its original signature and argument name preserved.

-- 1. THE canonical ladder. Pure function of the tier string -- no table
--    access, so it needs no SECURITY DEFINER. Keep this in lock-step with
--    BUSINESS_SEAT_TIERS (`seats`) and SEAT_LIMITS in src/hooks/useMyBusiness.ts.
CREATE OR REPLACE FUNCTION public.business_seat_limit_for_tier(_seat_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE COALESCE(_seat_tier, 'starter')
    WHEN 'starter'    THEN 1
    WHEN 'crew'       THEN 2
    WHEN 'team'       THEN 3
    WHEN 'enterprise' THEN 4
    ELSE 1            -- unknown tier fails CLOSED, same as the client's
                      -- `biz.seat_tier ?? "starter"` default.
  END
$$;

COMMENT ON FUNCTION public.business_seat_limit_for_tier(text) IS
  'Seats included in a business seat tier, INCLUDING the owner. Canonical DB '
  'copy of BUSINESS_SEAT_TIERS / SEAT_LIMITS: starter 1, crew 2, team 3, '
  'enterprise 4. Unknown/NULL tier collapses to starter.';

-- Not part of the public RPC surface (matches the posture set by
-- 20260505190000). SECURITY DEFINER callers below run as the function owner,
-- which keeps EXECUTE regardless.
REVOKE ALL ON FUNCTION public.business_seat_limit_for_tier(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_seat_limit_for_tier(text) FROM anon;
REVOKE ALL ON FUNCTION public.business_seat_limit_for_tier(text) FROM authenticated;

-- 2. The trigger that actually binds. Now reads the tier instead of "2".
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
  -- The founding owner row (add_owner_as_member) is never rejected. It is
  -- still COUNTED against the limit for everyone else -- see the header.
  IF NEW.role = 'owner' THEN
    RETURN NEW;
  END IF;

  SELECT public.business_seat_limit_for_tier(b.seat_tier)
    INTO seat_limit
  FROM public.businesses b
  WHERE b.id = NEW.business_id;

  -- No businesses row (impossible under the FK) -> fail closed at starter.
  seat_limit := COALESCE(seat_limit, public.business_seat_limit_for_tier('starter'));

  SELECT count(*) INTO member_count
  FROM public.business_members
  WHERE business_id = NEW.business_id
    AND status IN ('active', 'pending');

  IF member_count >= seat_limit THEN
    -- Same sentence shape as before so the toast (BusinessTeam surfaces
    -- `err.message` verbatim) still reads correctly next to MembersTab's
    -- "You've reached your N-seat limit" copy -- but N now comes from the
    -- tier the customer is actually paying for.
    RAISE EXCEPTION 'This business has reached its %-seat limit. Upgrade to add more members.', seat_limit;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Retire the two contradictory ladders by delegating them to the canonical
--    helper. Signatures and argument names are unchanged so CREATE OR REPLACE
--    is legal and no caller breaks. `get_business_seat_limit` is what the
--    second BEFORE INSERT trigger (enforce_business_seat_limit, from
--    20260426042619) reads, so this is what stops that trigger from
--    contradicting the one above; `business_seat_limit` has no callers today
--    but is aligned so it cannot become a third answer later.
CREATE OR REPLACE FUNCTION public.get_business_seat_limit(_business_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.business_seat_limit_for_tier(b.seat_tier)
  FROM public.businesses b
  WHERE b.id = _business_id
$$;

CREATE OR REPLACE FUNCTION public.business_seat_limit(_business_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.business_seat_limit_for_tier(b.seat_tier)
  FROM public.businesses b
  WHERE b.id = _business_id
$$;

-- NOTE on the second trigger, deliberately left as-is: enforce_business_seat_limit()
-- has NO owner exemption, so it also caps rows inserted with role='owner'. That
-- is load-bearing and must stay -- the `business_members` INSERT policy admits
-- `(role = 'owner' AND user_id = auth.uid())`, so that trigger is the only
-- thing bounding a self-inserted owner row. Now that it reads the same ladder
-- it agrees with the trigger above instead of allowing 10.
