-- Q572: a signed-out Storage listing answered with an ERROR, not an empty list.
--
-- Measured on prod 2026-10-02: an anon POST to /storage/v1/object/list/<bucket>
-- for avatars, proof-photos, job-photos and user-documents returned HTTP 400
-- {"statusCode":"403","error":"Unauthorized","message":"permission denied for
-- table jobs"}. Postgres evaluates every policy that applies to the caller's
-- role, whatever bucket is asked for. "Job participants can view proof photos"
-- (20260403180249) was created with no TO clause, so it applies to PUBLIC,
-- which includes anon, and its USING clause reads public.jobs, on which anon
-- holds no SELECT. The policy never granted anon a row (every branch needs
-- auth.uid()); it only turned the signed-out answer into an error.
--
-- "Owner upload user-documents" (20260427011417) is the only other TO-public
-- policy on storage.objects. Its check needs auth.uid() too, so it also grants
-- anon nothing. Both are scoped to authenticated; for a signed-in caller
-- neither changes. Public buckets are served by /object/public/, which does not
-- consult these policies.
--
-- Guard: src/test/storagePoliciesAreAuthenticated.test.ts (the newest
-- definition of every storage.objects policy names neither public nor anon).
--
-- REPLAY-SAFETY: each ALTER runs only if its policy exists, so a rebuild that
-- has dropped or renamed it later is untouched. Re-running is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND policyname = 'Job participants can view proof photos') THEN
    ALTER POLICY "Job participants can view proof photos" ON storage.objects TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND policyname = 'Owner upload user-documents') THEN
    ALTER POLICY "Owner upload user-documents" ON storage.objects TO authenticated;
  END IF;
END
$$;
