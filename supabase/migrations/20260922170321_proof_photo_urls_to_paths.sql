-- PROOF PHOTOS: STORED SIGNED URLS -> STORAGE PATHS
--
-- `proof-photos` is a private bucket, so PhotoProof.tsx minted a signed URL
-- for each upload and wrote THAT into `jobs.proof_before_urls` /
-- `jobs.proof_after_urls`. The `?token=` on such a URL is a JWT carrying an
-- `exp`: the row is correct the day it is written and 400s forever after, with
-- no error at write time and none at read time. The reader just gets an empty
-- box with its alt text — the shape of the owner's 2026-09-21 report.
--
-- The code half shipped with this migration (src/lib/proofPhotoStorage.ts,
-- src/hooks/useProofPhotoUrls.ts) stores the PATH and signs at display time,
-- the pattern this repo already wrote down for `user-documents` in
-- 20260505220000_split_avatars_bucket_private_user_documents.sql. This is the
-- data half: the values already written down.
--
-- ── MEASURED ON PROD (read-only, fncmgoasalhdgfwzhsqa, 2026-09-22) ──────────
--   93 values across 22 rows of proof_before_urls and 22 of proof_after_urls
--   85 of them  https://…/storage/v1/object/sign/proof-photos/<job>/<file>?token=<jwt>
--               earliest exp 2027-09-07, latest exp 2027-09-18, expired today 0
--    8 of them  https://example.invalid/<job>/before.png  (seed placeholders)
--    0 of them  already a bare path
--
-- ── WHAT HAPPENS TO A VALUE THAT DOES NOT PARSE ─────────────────────────────
-- It is KEPT, BYTE FOR BYTE, IN PLACE. The rewrite is a per-element CASE, so
-- an unrecognised element keeps its position in the array and every other
-- element of that array is still converted. Nothing is dropped, no array is
-- shortened, no row is skipped because one of its elements was odd. The eight
-- `https://example.invalid/…` seed values are exactly this case: they name no
-- bucket, so there is no path to extract, and they survive unchanged. The
-- reader tolerates them too — `extractProofPhotoPath` returns "" for a URL it
-- cannot place, and the component falls back to rendering the URL as given,
-- which is precisely today's behaviour for those rows.
--
-- ── IDEMPOTENCE ─────────────────────────────────────────────────────────────
-- Only elements matching `^https?://…/proof-photos/…` are rewritten, and the
-- result of rewriting one never matches that pattern again (it has no scheme).
-- A second, third or hundredth run therefore finds nothing to do: the WHERE
-- clause matches no rows at all. Replay-safe by construction — there is no
-- DDL here to guard, only data, and the data guards itself.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. jobs.proof_before_urls / jobs.proof_after_urls
-- ──────────────────────────────────────────────────────────────────────────────
UPDATE public.jobs j
SET proof_before_urls = (
  SELECT array_agg(
           CASE
             WHEN e ~ '^https?://.*/proof-photos/'
               THEN split_part(regexp_replace(e, '^https?://.*?/proof-photos/', ''), '?', 1)
             ELSE e
           END
           ORDER BY ord
         )
  FROM unnest(j.proof_before_urls) WITH ORDINALITY AS t(e, ord)
)
WHERE j.proof_before_urls IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(j.proof_before_urls) AS e
    WHERE e ~ '^https?://.*/proof-photos/'
  );

UPDATE public.jobs j
SET proof_after_urls = (
  SELECT array_agg(
           CASE
             WHEN e ~ '^https?://.*/proof-photos/'
               THEN split_part(regexp_replace(e, '^https?://.*?/proof-photos/', ''), '?', 1)
             ELSE e
           END
           ORDER BY ord
         )
  FROM unnest(j.proof_after_urls) WITH ORDINALITY AS t(e, ord)
)
WHERE j.proof_after_urls IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(j.proof_after_urls) AS e
    WHERE e ~ '^https?://.*/proof-photos/'
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. The dispute-evidence columns, fed by the same defect class
-- ──────────────────────────────────────────────────────────────────────────────
-- `disputes.evidence_urls` and `jobs.dispute_evidence_urls` hold ZERO rows
-- today (verified read-only, 2026-09-22) only because no dispute has yet
-- carried evidence through DisputeDialog / DisputeTimelineDialog — both of
-- which still mint a 365-day token (their code fix is not in this commit).
-- Converting them here is therefore a no-op on today's data, and it means the
-- backfill is already in place for whatever lands between now and their fix.
UPDATE public.disputes d
SET evidence_urls = (
  SELECT array_agg(
           CASE
             WHEN e ~ '^https?://.*/(proof-photos|dispute-evidence)/'
               THEN split_part(regexp_replace(e, '^https?://.*?/(proof-photos|dispute-evidence)/', ''), '?', 1)
             ELSE e
           END
           ORDER BY ord
         )
  FROM unnest(d.evidence_urls) WITH ORDINALITY AS t(e, ord)
)
WHERE d.evidence_urls IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(d.evidence_urls) AS e
    WHERE e ~ '^https?://.*/(proof-photos|dispute-evidence)/'
  );

UPDATE public.jobs j
SET dispute_evidence_urls = (
  SELECT array_agg(
           CASE
             WHEN e ~ '^https?://.*/(proof-photos|dispute-evidence)/'
               THEN split_part(regexp_replace(e, '^https?://.*?/(proof-photos|dispute-evidence)/', ''), '?', 1)
             ELSE e
           END
           ORDER BY ord
         )
  FROM unnest(j.dispute_evidence_urls) WITH ORDINALITY AS t(e, ord)
)
WHERE j.dispute_evidence_urls IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(j.dispute_evidence_urls) AS e
    WHERE e ~ '^https?://.*/(proof-photos|dispute-evidence)/'
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Say what the columns hold, where the next maintainer will look
-- ──────────────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.jobs.proof_before_urls IS
  'Storage PATHS within the private proof-photos bucket (e.g. <job_id>/before-<ts>-<rand>.png), NOT full URLs. Resolve with useProofPhotoUrls / signProofPhotoUrls at display time. A signed URL written here carries an exp and 400s silently once it passes — see 20260922170321_proof_photo_urls_to_paths.sql. Legacy full URLs are still tolerated on read.';

COMMENT ON COLUMN public.jobs.proof_after_urls IS
  'Storage PATHS within the private proof-photos bucket (e.g. <job_id>/after-<ts>-<rand>.png), NOT full URLs. Resolve with useProofPhotoUrls / signProofPhotoUrls at display time. A signed URL written here carries an exp and 400s silently once it passes — see 20260922170321_proof_photo_urls_to_paths.sql. Legacy full URLs are still tolerated on read.';
