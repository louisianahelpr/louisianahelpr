-- DISPUTE EVIDENCE: ACCEPT A STORAGE PATH ALONGSIDE THE LEGACY SIGNED URL
--
-- `proof-photos` is private, so DisputeDialog.tsx and DisputeTimelineDialog.tsx
-- mint a signed URL per upload and store THAT. The `?token=` on such a URL is a
-- JWT carrying an `exp`: the row is correct the day it is written and 400s
-- forever after, with no error at write time and none at read time — the same
-- dated fuse 20260922170321 defused for `jobs.proof_before_urls` /
-- `proof_after_urls` (365-day tokens, earliest exp 2027-09-07).
--
-- The established fix is store-the-path, sign-at-display
-- (src/lib/proofPhotoStorage.ts, src/hooks/useProofPhotoUrls.ts). It could not
-- be applied to the two dispute dialogs, because THE DATABASE REFUSES A BARE
-- PATH. `public.dispute_evidence_url_ok(_url, _uploader, _job_id)` — read live
-- from prod with pg_get_functiondef on 2026-09-22 — required the full URL form,
-- and THREE writers enforce it (all three found by scanning pg_proc.prosrc for
-- the validator's name, not by reading migrations):
--
--   1. public.open_dispute_as          -- the one creation path, reached by
--                                         rpc_open_dispute; checks the whole
--                                         `_evidence_urls` array
--   2. public.rpc_add_dispute_evidence -- the admin-re-opened append channel;
--                                         FOREACH over the array
--   3. public.enforce_dispute_evidence_append_only -- BEFORE UPDATE ON
--                                         public.disputes (trigger
--                                         trg_dispute_evidence_append_only),
--                                         which holds the opener's own direct
--                                         UPDATE to the same rule
--
-- There is no fourth: no CHECK constraint anywhere references the validator
-- (pg_constraint scanned), and it is called from nothing else in pg_proc.
-- So writing a path today raises `dispute_evidence_invalid_url` and breaks
-- dispute filing outright, on the money path. This migration removes that
-- blocker and nothing else: it is the DB half, landed first and on its own, so
-- the client half can follow without a flag day in either direction.
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────
-- The predicate becomes an OR of two anchored alternatives:
--
--   A (unchanged, legacy) https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/
--                         object/sign/proof-photos/<uploader>/disputes/<job>/<file>[?…]
--   B (new, path)         <uploader>/disputes/<job>/<file>
--
-- Every existing row and every value the current client writes takes branch A,
-- byte for byte as before. Nothing is removed, so this is not a flag day: both
-- forms validate during the rollout, after it, and on replay.
--
-- ── HOW B STILL PINS UPLOADER AND JOB ──────────────────────────────────────
-- The point of this validator is that a party may attach only their OWN upload
-- for THIS job — it is what stops someone stapling an arbitrary URL, or another
-- user's photo, onto a dispute an admin then decides money on. Branch B keeps
-- that exactly:
--
--   * `_uploader::text` and `_job_id::text` are interpolated as the literal
--     uuids the CALLER was resolved to, never taken from `_url`. A uuid's text
--     form is 36 characters of [0-9a-f-] and contains no regex metacharacter,
--     so it cannot smuggle an alternation or a wildcard into the pattern.
--   * B is anchored `^` directly at `<uploader>`. Not `.*`, not an optional
--     prefix: the first path segment IS the uploader's uid, which is also what
--     the proof-photos INSERT policy keys on ((storage.foldername(name))[1]),
--     so a path that validates here is a path that user could actually have
--     uploaded. The second segment is the literal `disputes`, the third IS this
--     job's uuid.
--   * The file segment is `[^/?#]+$` — ONE segment, and `$` is a true end of
--     string here because `~` is left un-anchored only by choice and both
--     alternatives carry their own `^`…`$`. No `/` means no descent into
--     another uid's or another job's folder; no `?` means a bare path may not
--     carry a `token=` (a path is a path, a ticket is a ticket, and storing the
--     ticket is the defect being fixed); no `#` for the same reason branch A
--     excludes it.
--   * The pre-existing guards are untouched and apply to BOTH branches: NOT
--     NULL on all three arguments, length <= 2048, and `position('..' IN _url)
--     = 0`, which alone defeats `<uploader>/disputes/<job>/..` style traversal
--     before the regex is even reached.
--
-- So B is strictly the same authorisation statement as A with the origin and
-- bucket prefix removed — and that prefix was never the part doing the pinning.
--
-- ── REPLAY-SAFETY ──────────────────────────────────────────────────────────
-- CREATE OR REPLACE on a function whose signature, return type, volatility and
-- search_path are unchanged: applying this twice, or a hundred times, leaves
-- the same object. No DROP, so the three callers and the trigger keep resolving
-- to it throughout — there is no window in which a dispute filing sees no
-- validator. A/B-proven against prod in a rolled-back DO block before landing:
-- under the LIVE definition a bare path is rejected and the legacy URL
-- accepted; under this definition both are accepted and a path bearing another
-- user's uid, another job's id, a second path segment or a `?token=` is still
-- rejected.

CREATE OR REPLACE FUNCTION public.dispute_evidence_url_ok(_url text, _uploader uuid, _job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT _url IS NOT NULL
     AND _uploader IS NOT NULL
     AND _job_id IS NOT NULL
     AND length(_url) <= 2048
     AND position('..' IN _url) = 0
     AND (
       -- A. Legacy: a signed proof-photos object URL on this project's host.
       _url ~ ('^https://fncmgoasalhdgfwzhsqa\.supabase\.co/storage/v1/object/sign/proof-photos/'
               || _uploader::text || '/disputes/' || _job_id::text || '/[^/?#]+([?][^#]*)?$')
       -- B. New: the storage PATH inside proof-photos, signed at display time.
       --    Same two pinned segments, no query string allowed.
       OR _url ~ ('^' || _uploader::text || '/disputes/' || _job_id::text || '/[^/?#]+$')
     )
$function$;

COMMENT ON FUNCTION public.dispute_evidence_url_ok(text, uuid, uuid) IS
  'True when _url is dispute evidence the given uploader could have uploaded for the given job: either a signed proof-photos object URL on this project''s host, or the bare storage PATH <uploader>/disputes/<job>/<file> inside that bucket. Both forms pin the uploader uuid as the first path segment and the job uuid as the third; the path form forbids a query string, so a signed token can never be stored through it. Callers: open_dispute_as, rpc_add_dispute_evidence, enforce_dispute_evidence_append_only. See 20260922172945_widen_dispute_evidence_url_ok_to_paths.sql.';
