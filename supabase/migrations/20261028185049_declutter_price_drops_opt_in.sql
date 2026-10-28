-- Price drops are OPT-IN everywhere (owner 2026-10-28: "they should have an option to say if the price drops,
-- personally I wouldn't want my items to be decreased by the day, I would want them to stay that price the full
-- time it's listed").
--
-- 20261028160637 added declutter_items.drop_pct with DEFAULT 5, so every listing made before the new sell form
-- (and any listing a path other than the sell form creates: moving-out drafts, Sell it for me) drops 5% a night
-- although its seller never chose it. The sell form already sends 0 when the seller leaves drops off.
-- 1. The column default becomes 0 (off): a seller turns drops on, never off.
-- 2. Every existing listing goes to 0: none of their sellers opted in (measured 2026-10-28: 13 listings, all at
--    the default 5). A seller who wants drops turns them on in Manage listing.
-- The nightly sweep (declutter_price_drop_sweep) already skips drop_pct = 0. Replay-safe: the reset only touches
-- listings created before this change, so a re-run never undoes a seller who opted in afterwards.

ALTER TABLE public.declutter_items ALTER COLUMN drop_pct SET DEFAULT 0;

UPDATE public.declutter_items
   SET drop_pct = 0, updated_at = now()
 WHERE drop_pct <> 0
   AND created_at < '2026-10-28 19:00:00+00';
