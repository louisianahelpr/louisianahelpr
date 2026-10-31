-- The two "ways freeze once listed" guards fail closed when the edit flag was never set (lead review, 2026-10-31).
--
-- What was broken: declutter_items_handovers_guard and declutter_items_porch_frozen (newest CREATE for both:
-- 20261029205908_declutter_edit_listing.sql) let a LIVE listing's ways change only while declutter.editing_listing
-- names the item, the transaction-local flag declutter_edit_listing sets. In a session where that flag was never set,
-- current_setting('declutter.editing_listing', true) is NULL, so `NULL = OLD.id::text` is NULL, NOT NULL is NULL, the
-- whole IF is NULL and the guard does NOT raise. Any UPDATE that reaches declutter_items without the flag (only
-- SECURITY DEFINER code can: authenticated has no UPDATE on the table, checked on prod read-only by Builder 14) could
-- take a way off a listed item, which the lh-money-escrow review (2026-10-28 #4-5) said must never happen.
--
-- The fix: COALESCE(current_setting('declutter.editing_listing', true), '') in both, so a flag never set compares as
-- '' and the guard refuses. Everything else is restated exactly as 20261029205908 wrote it.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only; the triggers themselves already exist (20261028235247, 20261017055504).

CREATE OR REPLACE FUNCTION public.declutter_items_handovers_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.handovers IS DISTINCT FROM OLD.handovers AND OLD.status <> 'draft'
     AND NOT (OLD.handovers IS NOT NULL AND NEW.handovers IS NOT NULL AND OLD.handovers <@ NEW.handovers)
     AND NOT (OLD.status = 'live' AND COALESCE(current_setting('declutter.editing_listing', true), '') = OLD.id::text) THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023',
      HINT = 'Once listed, you can add ways buyers can get it, not take them away.';
  END IF;
  IF NEW.porch_ok IS DISTINCT FROM OLD.porch_ok AND NEW.handovers IS NOT NULL
     AND NEW.handovers IS NOT DISTINCT FROM OLD.handovers THEN
    NEW.handovers := CASE WHEN NEW.porch_ok
      THEN (SELECT array_agg(DISTINCT w ORDER BY w) FROM unnest(NEW.handovers || ARRAY['porch']) AS w)
      ELSE array_remove(NEW.handovers, 'porch') END;
    IF cardinality(NEW.handovers) < 1 THEN
      RAISE EXCEPTION 'invalid_handovers' USING ERRCODE = '22023',
        HINT = 'Porch pickup is the only way buyers can get this item. Tick another way first.';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_handovers_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.declutter_items_porch_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.porch_ok IS DISTINCT FROM OLD.porch_ok AND OLD.status <> 'draft'
     AND NOT (OLD.porch_ok IS FALSE AND NEW.porch_ok IS TRUE)
     AND NOT (OLD.status = 'live' AND COALESCE(current_setting('declutter.editing_listing', true), '') = OLD.id::text) THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023',
      HINT = 'Porch pickup can only be turned off while the listing is a draft.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_porch_frozen() FROM PUBLIC, anon, authenticated;
