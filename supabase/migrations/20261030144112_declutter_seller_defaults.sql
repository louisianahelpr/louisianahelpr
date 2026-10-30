-- Declutter: a seller's remembered listing choices (owner request via the lead, 2026-10-30: "Remember the seller's
-- choices so they don't re-enter them every time ... prefer saving them on the account so they follow the seller
-- across phone and computer").
--
-- ONE row per member, written by the sell form when a listing is posted and by the Declutter settings page
-- (Builder 101), read by the sell form to pre-fill a NEW listing. The seller can still change anything per listing;
-- nothing here changes a listing that exists. No row = the app's defaults (keep it up ON, price drops ON at 5% a
-- night down to half the price, never free, porch pickup).
--
--   keep_up          "Keep it up until it sells"
--   drops            "Lower the price if it doesn't sell?"
--   drop_pct         how much each evening (the sell form's DROP_PCT_CHOICES)
--   floor_pct        the lowest price as a percent of the asking price (pre-fills "Lowest you'll take")
--   free_after_days  "If it doesn't sell, make it free after" (NULL = never; AUTO_FREE_DAY_CHOICES)
--   handovers        the ways buyers can get it (declutter_items.handovers' values)
--
-- Access: plain row-level security, the member's own row only (read, insert, update, delete). No definer
-- function, no other member's row, nothing for anon. Account deletion removes the row (ON DELETE CASCADE).
-- Replay-safe: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS, grants restated.

CREATE TABLE IF NOT EXISTS public.declutter_seller_defaults (
  member_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  keep_up boolean NOT NULL DEFAULT true,
  drops boolean NOT NULL DEFAULT true,
  drop_pct smallint NOT NULL DEFAULT 5 CONSTRAINT declutter_seller_defaults_drop_pct CHECK (drop_pct IN (5, 10, 15, 20)),
  floor_pct smallint NOT NULL DEFAULT 50 CONSTRAINT declutter_seller_defaults_floor_pct CHECK (floor_pct BETWEEN 10 AND 95),
  free_after_days smallint CONSTRAINT declutter_seller_defaults_free_after CHECK (free_after_days IS NULL OR free_after_days IN (7, 14, 21, 30)),
  handovers text[] NOT NULL DEFAULT ARRAY['porch']::text[] CONSTRAINT declutter_seller_defaults_handovers CHECK (
    cardinality(handovers) BETWEEN 1 AND 4
    AND handovers <@ ARRAY['porch', 'seller_delivery', 'meetup', 'delivery']::text[]
  ),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.declutter_seller_defaults IS
  'A seller''s remembered Declutter listing choices; pre-fills a new listing. Own row only (RLS). Owner request 2026-10-30.';

ALTER TABLE public.declutter_seller_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS declutter_seller_defaults_own_read ON public.declutter_seller_defaults;
CREATE POLICY declutter_seller_defaults_own_read ON public.declutter_seller_defaults
  FOR SELECT TO authenticated USING (member_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS declutter_seller_defaults_own_insert ON public.declutter_seller_defaults;
CREATE POLICY declutter_seller_defaults_own_insert ON public.declutter_seller_defaults
  FOR INSERT TO authenticated WITH CHECK (member_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS declutter_seller_defaults_own_update ON public.declutter_seller_defaults;
CREATE POLICY declutter_seller_defaults_own_update ON public.declutter_seller_defaults
  FOR UPDATE TO authenticated USING (member_id = (SELECT auth.uid())) WITH CHECK (member_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS declutter_seller_defaults_own_delete ON public.declutter_seller_defaults;
CREATE POLICY declutter_seller_defaults_own_delete ON public.declutter_seller_defaults
  FOR DELETE TO authenticated USING (member_id = (SELECT auth.uid()));

REVOKE ALL ON public.declutter_seller_defaults FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.declutter_seller_defaults TO authenticated;
GRANT ALL ON public.declutter_seller_defaults TO service_role;
