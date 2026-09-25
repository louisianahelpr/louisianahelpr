-- Dispute evidence cannot be swapped or deleted by a party once uploaded.
--
-- Both dispute dialogs (DisputeDialog, DisputeTimelineDialog) upload evidence
-- to proof-photos at `<uid>/disputes/<jobId>/<file>` and file the PATH; the
-- admin signs and views it at decision time. The proof-photos UPDATE and
-- DELETE policies (20260831171658) allow any `<uid>/…` object of the caller,
-- so a party could overwrite (upsert) or delete a photo after filing it, or
-- after an admin had looked at it, and the admin would decide the money split
-- on whatever is there at the second look (lh-authz-rls review of the dispute
-- settlement branch, 2026-09-15, OPEN LOW).
--
-- Both policies now exclude objects whose second path segment is `disputes`.
-- Nothing a client runs needs those verbs there: no client removes or upserts
-- proof-photos objects (uploads are plain INSERTs), and the only party-token
-- DELETE (e2e/prod-lifecycle.spec.ts teardown) removes before/after proof
-- paths `<jobId>/…`, never `…/disputes/…`. Account purge and the orphan
-- sweep use the service role, which RLS does not bind. For UPDATE, USING also
-- serves as the WITH CHECK, so an object cannot be renamed INTO a disputes
-- path either. INSERT and SELECT are unchanged.
--
-- Live 2026-09-25: 0 proof-photos objects under */disputes/*, 0 evidence
-- paths on disputes, so nothing existing changes hands.
--
-- Guard: src/test/disputeEvidenceImmutable.test.ts (replays every
-- storage.objects policy statement; red on the tree without this migration)
-- and src/test/pglite/disputeEvidenceImmutable.pglite.mjs (live policies,
-- applied 3x; NEW_MIGRATION=skip is red).

DROP POLICY IF EXISTS "Users can update their own proof photos" ON storage.objects;
CREATE POLICY "Users can update their own proof photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND (storage.foldername(name))[2] IS DISTINCT FROM 'disputes'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.is_party_to_job_folder(name)
    )
  );

DROP POLICY IF EXISTS "Users can delete their own proof photos" ON storage.objects;
CREATE POLICY "Users can delete their own proof photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND (storage.foldername(name))[2] IS DISTINCT FROM 'disputes'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.is_party_to_job_folder(name)
    )
  );
