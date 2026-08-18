-- SEC-001 — close a hole that 20260817120000 opened.
--
-- That migration made the business member cap READ `businesses.seat_tier`,
-- which is correct. What it did not account for is that `seat_tier` is
-- CLIENT-WRITABLE:
--
--   * the live policy "Owner can update their business"
--     (20260425233224_ddac4ad3-…) is
--       FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())
--     — the WHOLE row, with no column restriction; and
--   * the only BEFORE UPDATE trigger on `businesses`,
--     `enforce_business_verification_safety` (20260425235407_ea778f7d-…),
--     pins `verification_status` and the reviewer columns back to OLD for
--     non-admins, but says nothing about `seat_tier`.
--
-- Before 20260817120000 the member trigger hardcoded a cap of 2, so editing
-- `seat_tier` bought an attacker nothing — the hardcoded number was
-- accidentally load-bearing. Once the cap reads the column, a free-tier owner
-- can send ONE request with only their own JWT:
--
--   PATCH /rest/v1/businesses?id=eq.<their id>   {"seat_tier":"enterprise"}
--
-- invite three teammates, and KEEP them: the cap is enforced on INSERT only, so
-- the member rows survive the Stripe reconciler resetting the column. A revenue
-- bug would have been traded for a revenue exploit.
--
-- Verified before writing this: nothing legitimate loses access.
--   * No client code writes `seat_tier` — src/ reads it only (useMyBusiness,
--     useBusinessSeatTier).
--   * The one writer, supabase/functions/check-business-seat-subscription,
--     builds its client with SUPABASE_SERVICE_ROLE_KEY. The service role is
--     the table owner's superuser-equivalent and is NOT subject to column
--     grants, so reconciliation keeps working.
--
-- The subscription bookkeeping columns go with it for the same reason: they are
-- Stripe's record of what was paid for, and no client should be able to rewrite
-- its own billing state.
REVOKE UPDATE (
  seat_tier,
  seat_subscription_id,
  seat_subscription_status,
  seat_subscription_current_period_end
) ON public.businesses FROM authenticated, anon;
