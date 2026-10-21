-- Q1557, owner 2026-10-21 (via the lead): delete the social-post DRAFTS only.
-- Measured on prod 2026-10-21: marketing_content held 79 rows, every one
-- status 'draft', last updated 2026-09-05; nothing references the table.
-- A row in any other status (scheduled, posted, ...) is kept. Replay-safe: a
-- second run deletes nothing.
DO $$
BEGIN
  IF to_regclass('public.marketing_content') IS NOT NULL THEN
    DELETE FROM public.marketing_content WHERE status = 'draft';
  END IF;
END $$;
