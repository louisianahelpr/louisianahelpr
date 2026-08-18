-- Enterprise is sold as "4+". The database enforces exactly 4.
-- ============================================================================
--
-- THE BUG. 20260817120000 replaced a hardcoded cap of 2 with the ladder the
-- app actually sells (starter 1 / crew 2 / team 3 / enterprise 4). That was
-- right for three of the four tiers and wrong for the one that pays the most:
-- supabase/functions/_shared/businessSeatTiers.ts — the single source of truth
-- for the pricing page, the in-app seat plan and Stripe checkout — says
--
--     { key: "enterprise", name: "Enterprise", seats: "4+", priceLabel: "$40" }
--
-- and businessTeamHelpers.ts parses that display string with
-- `parseInt("4+", 10)` -> 4. So the "+" is real in the sales conversation and
-- nowhere in the schema. The first six-seat Enterprise deal that closes hits
-- `enforce_business_member_limit` on the FIFTH invite and is told to "upgrade
-- to add more members" — from the top of the ladder, with nothing to upgrade
-- to. That is the same revenue bug 20260817120000 existed to fix, relocated to
-- the highest-margin customer.
--
-- THE FIX (owner's call): a per-business `extra_seats` override, added on top
-- of whatever the tier includes. Not a fifth tier, not "enterprise = 999":
--   * a fifth tier would need a Stripe Price, a pricing-page row and a
--     checkout path for what is a negotiated, per-contract number;
--   * unbounding enterprise would delete the cap for the one tier where an
--     unbilled seat costs the most.
-- `extra_seats` is per-business, defaults to 0 (so every existing row keeps
-- exactly today's behaviour), and is written only over a service-role /
-- migration connection when a deal is signed — see the SECURITY section.
--
-- ---------------------------------------------------------------------------
-- WHERE THE ADDITION GOES, AND WHY IT IS NOT IN THE LADDER HELPER.
--
-- `business_seat_limit_for_tier(_seat_tier text)` is UNTOUCHED. It takes a tier
-- string and nothing else; it is IMMUTABLE, does no table access, and is the
-- one thing `src/hooks/seatLimitLadder.parity.test.ts` reads back out of this
-- tree to prove the marketing/client/DB ladders still agree. Folding a
-- per-business number into a pure tier->number function would either need a
-- second argument at every call site or a table read inside an IMMUTABLE
-- function (a lie to the planner), and it would make the parity test's
-- question — "does the DB allow the seats the pricing page sells?" —
-- unanswerable. It stays pure.
--
-- The override is therefore applied by the things that resolve a limit for a
-- SPECIFIC business, i.e. the ones that already hold a `businesses` row or its
-- id:
--
--   enforce_business_member_limit()    reads the row inline -> adds it inline
--   get_business_seat_limit(uuid)      \  the per-business answer: these two
--   business_seat_limit(uuid)          /  now return tier + override
--
-- `enforce_business_seat_limit()` IS DELIBERATELY NOT EDITED. It already calls
-- `get_business_seat_limit(NEW.business_id)`, so it inherits the override for
-- free — and adding `+ extra_seats` to it as well would DOUBLE-COUNT the
-- override on the owner-row path. If a later change makes that trigger compute
-- its own limit, the addition has to move, not be duplicated.
--
-- Two functions named `*_seat_limit(uuid)` returning "tier only" while the cap
-- enforced tier+override would be a fifth contradictory ladder, which is the
-- exact failure mode this whole workstream exists to end — hence they move too,
-- even though the triggers are their only callers today (verified again here:
-- no hits under src/, supabase/functions/ or e2e/ beyond the generated
-- types.ts entry).
--
-- ---------------------------------------------------------------------------
-- SECURITY: extra_seats is NOT client-writable, and one mechanism is not enough.
--
-- This is the same class as SEC-001, which took three attempts last night. The
-- lesson from 20260818070000 is that `REVOKE UPDATE (col) ... FROM authenticated`
-- is a NO-OP against a TABLE-level grant: it only clears pg_attribute.attacl,
-- which for a fresh column is NULL already. It deploys green and changes
-- nothing. So both of the mechanisms that actually closed SEC-001 are extended
-- here:
--
--   (A) GRANTS — 20260818071500 revoked the table-level UPDATE and re-granted a
--       named column list. Measured on prod before writing this:
--         pg_class.relacl -> {postgres=arwdDxtm/…, anon=ardDxtm/…,
--                             authenticated=ardDxtm/…, service_role=arwdDxtm/…}
--                                                 ^ no `w` for anon/authenticated
--         has_table_privilege('authenticated','public.businesses','UPDATE') -> false
--       A column added under that posture inherits no UPDATE grant, so
--       `extra_seats` is already unwritable the moment it exists. That is a
--       property of the CURRENT acl, not a statement anyone made — a single
--       `GRANT UPDATE ON public.businesses TO authenticated` (an advisor pass,
--       a template, a careless migration) would silently re-open it along with
--       seat_tier. The revoke + re-grant is therefore re-asserted below with
--       `extra_seats` conspicuously absent from the list. The 19 re-granted
--       columns are exactly the 19 that hold `authenticated=w/postgres` in
--       pg_attribute.attacl on prod right now, so this reproduces the live
--       state rather than guessing at it, and no existing client write can
--       start failing on a missing column privilege.
--
--   (B) THE TRIGGER PIN — 20260818090000's `enforce_business_seat_billing_immutable`
--       is a BEFORE UPDATE trigger that snaps the Stripe-owned columns back to
--       OLD for anyone who is not service_role. `extra_seats` joins that group.
--       This is the mechanism that keeps holding if (A) is ever undone, and it
--       is the reason a grant-only fix would be insufficient.
--
-- WHO CAN SET IT. service_role (an edge function or the SQL editor) and a
-- connection with no PostgREST JWT (a migration, psql). There is deliberately
-- NO client-writable path and no admin UI: an owner who could type their own
-- seat count is SEC-001 with extra steps. An operator sets it when the contract
-- is signed. `check-business-seat-subscription` reconciles `seat_tier` from
-- Stripe and never touches `extra_seats`, so a plan change does not wipe a
-- negotiated override.
--
-- MARKETING COPY IS UNCHANGED. `businessSeatTiers.ts` still reads seats: "4+".
-- Before this migration that "+" was aspirational; after it, it is a statement
-- the database can honour. `parseInt("4+", 10)` -> 4 remains the correct BASE
-- for the tier — the "+" is the override, and it is per-business, so it cannot
-- live in a static tier table.
--
-- ---------------------------------------------------------------------------
-- REPLAY-SAFE. `businesses` ships in 20260425233224 and `seat_tier` /
-- `seat_subscription_*` in 20260426042619; the column grants this file
-- re-asserts, and every function it replaces, are all defined by migrations
-- with strictly earlier timestamps (20260818071500, 20260818090000,
-- 20260818110000), so a from-scratch rebuild in timestamp order always finds
-- them. ADD COLUMN is IF NOT EXISTS, the CHECK is guarded on pg_constraint
-- (ADD CONSTRAINT has no IF NOT EXISTS), and every function is
-- CREATE OR REPLACE with its signature and argument names preserved.

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS extra_seats integer NOT NULL DEFAULT 0;

-- Non-negative. A negative override would SUBTRACT seats from a paid tier —
-- silently under-delivering the thing the customer is invoiced for — and at
-- `-tier_limit` or below it would put the cap at 0 and lock the owner out of
-- their own team. NOT NULL + DEFAULT 0 covers the other half: NULL would make
-- `tier + extra` NULL, and `count >= NULL` is NULL, which is a silent ALLOW in
-- both triggers. The COALESCE in each reader is belt-and-braces on top.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_extra_seats_nonneg'
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_extra_seats_nonneg
      CHECK (extra_seats >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.businesses.extra_seats IS
  'Negotiated seats granted to THIS business on top of what its seat_tier '
  'includes — the "+" in Enterprise''s advertised "4+". Effective cap = '
  'business_seat_limit_for_tier(seat_tier) + extra_seats. Default 0. Writable '
  'only by service_role or a no-JWT connection: pinned to OLD for everyone '
  'else by enforce_business_seat_billing_immutable(), and excluded from the '
  'authenticated column-UPDATE grant list.';

-- ---------------------------------------------------------------------------
-- 2. Fold it into the cap.
-- ---------------------------------------------------------------------------

-- 2a. The tier-reading trigger. It already SELECTs the businesses row for the
--     tier, so the override is added right there. `business_seat_limit_for_tier`
--     is still what supplies the base, and the comparison is still against a
--     variable, never a literal — both are asserted by seatLimitLadder.parity.test.ts.
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

  -- Effective cap = what the tier includes + the per-business override.
  SELECT public.business_seat_limit_for_tier(b.seat_tier) + COALESCE(b.extra_seats, 0)
    INTO seat_limit
  FROM public.businesses b
  WHERE b.id = NEW.business_id;

  -- No businesses row -> fail CLOSED at starter, with no override.
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

-- 2b. The two per-business helpers. These answer "what is THIS business's seat
--     limit", so they owe the caller the effective number, not the tier's base.
--     `enforce_business_seat_limit()` — the sibling trigger, the one WITHOUT an
--     owner exemption — calls get_business_seat_limit() and so picks the
--     override up here. It is intentionally left unedited; see the header.
CREATE OR REPLACE FUNCTION public.get_business_seat_limit(_business_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.business_seat_limit_for_tier(b.seat_tier) + COALESCE(b.extra_seats, 0)
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
  SELECT public.business_seat_limit_for_tier(b.seat_tier) + COALESCE(b.extra_seats, 0)
  FROM public.businesses b
  WHERE b.id = _business_id
$$;

COMMENT ON FUNCTION public.get_business_seat_limit(uuid) IS
  'Effective seat cap for one business: business_seat_limit_for_tier(seat_tier) '
  '+ extra_seats. NULL when the business does not exist — callers must COALESCE '
  'to a fail-closed default.';
COMMENT ON FUNCTION public.business_seat_limit(uuid) IS
  'Mirror of get_business_seat_limit(uuid). Kept in lock-step so the schema '
  'never offers two different answers to the same question.';

-- Re-pin the posture set by 20260818124500 (SEC-004). CREATE OR REPLACE does
-- not reset privileges, so this is a no-op on prod; it is here so the guard
-- (scripts/check-migration-grants.mjs) sees the declaration next to the
-- definition and a virgin replay never comes up with default PUBLIC EXECUTE.
REVOKE ALL ON FUNCTION public.get_business_seat_limit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.business_seat_limit(uuid)     FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. SECURITY (A): grants. `extra_seats` is NOT in the re-granted list.
-- ---------------------------------------------------------------------------
-- Belt: clears any column-level UPDATE grant on the new column. On its own this
-- is the no-op that made 20260818070000 useless — it is kept only because it is
-- free and covers the case where someone GRANTs the column specifically.
REVOKE UPDATE (extra_seats) ON public.businesses FROM authenticated, anon;

-- Braces, and the part that actually binds: re-assert the table-level revoke
-- and re-grant the exact owner-editable column list from 20260818071500.
-- `REVOKE UPDATE ON <table>` also drops the column-level UPDATE grants, so the
-- GRANT below is mandatory, not decorative. The list is verbatim from that
-- migration and matches prod's pg_attribute.attacl column-for-column;
-- extra_seats and the four Stripe-owned seat/subscription columns are the only
-- omissions, which is the whole point.
REVOKE UPDATE ON public.businesses FROM authenticated, anon;

GRANT UPDATE (
  id,
  owner_id,
  name,
  created_at,
  updated_at,
  verification_status,
  verification_document_url,
  verification_document_type,
  verification_reviewed_at,
  verification_reviewed_by,
  verification_rejection_reason,
  require_approval_above,
  require_2fa,
  default_payment_method_id,
  monthly_budget,
  monthly_budget_alert_at,
  billing_mode,
  report_recipients,
  report_cadence
) ON public.businesses TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. SECURITY (B): the trigger pin. This is the mechanism that survives a
--    future re-GRANT, so `extra_seats` must be in it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_business_seat_billing_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_role   text;
BEGIN
  -- No PostgREST JWT: migration / psql / direct service connection. Trusted.
  IF v_claims IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_role := v_claims::jsonb ->> 'role';
  EXCEPTION WHEN others THEN
    v_role := NULL;  -- unparseable claims are treated as untrusted
  END;

  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Everyone else (including the business owner, and including an admin using
  -- the normal client) gets these columns pinned to their existing values.
  -- Billing state is Stripe's record of what was paid for; it is not settings.
  NEW.seat_tier                             := OLD.seat_tier;
  NEW.seat_subscription_id                  := OLD.seat_subscription_id;
  NEW.seat_subscription_status              := OLD.seat_subscription_status;
  NEW.seat_subscription_current_period_end  := OLD.seat_subscription_current_period_end;
  -- The negotiated seat override is billing state too: it is the "+" in the
  -- Enterprise contract. An owner who could write it could grant themselves
  -- unlimited unbilled seats in one PATCH — SEC-001 with a different column.
  NEW.extra_seats                           := OLD.extra_seats;

  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged (20260818090000) and still bound to this
-- function; recreated idempotently so a replay that somehow lost it recovers.
DROP TRIGGER IF EXISTS trg_enforce_business_seat_billing_immutable ON public.businesses;
CREATE TRIGGER trg_enforce_business_seat_billing_immutable
BEFORE UPDATE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.enforce_business_seat_billing_immutable();

REVOKE ALL ON FUNCTION public.enforce_business_seat_billing_immutable() FROM PUBLIC, anon, authenticated;
