-- Q782 (owner, 2026-09-27): the database enforces the post-job form's text
-- bounds. The form caps a title at 32 characters and a description at 1000
-- (src/components/postjob/detailsSection/detailsSectionConstants.ts), but
-- nothing below the form did, so every non-form writer (seeders, e2e fixtures,
-- probes, the STR iCal sync, ai-job-builder output) could post longer text the
-- cards were never designed to show. char_length counts characters (code
-- points), the same unit as the form's maxLength on a plain-text field.
--
-- Existing rows: measured on prod 2026-09-27, every violator was a seed row
-- (211 titles over 32, 1 description over 1000, 0 real rows). Those were
-- trimmed on prod first; the same seed-only trim runs here so a replay on a
-- fresh database (or a seed row written between the trim and this deploy)
-- still lets the constraint go on. A REAL row over the bound is never edited:
-- the migration stops instead, so a human decides.
--
-- Replay-safe: the trim is a no-op the second time, and each constraint is
-- dropped before it is added.

UPDATE public.jobs
   SET title = rtrim(left(title, 32))
 WHERE is_seed AND char_length(title) > 32;

UPDATE public.jobs
   SET description = left(description, 1000)
 WHERE is_seed AND char_length(description) > 1000;

DO $q782$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n
    FROM public.jobs
   WHERE char_length(title) > 32 OR char_length(description) > 1000;
  IF n > 0 THEN
    RAISE EXCEPTION 'Q782: % non-seed job row(s) exceed title 32 / description 1000; not trimming real data', n;
  END IF;
END
$q782$;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_title_length;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_title_length CHECK (char_length(title) <= 32);

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_description_length;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_description_length CHECK (char_length(description) <= 1000);
