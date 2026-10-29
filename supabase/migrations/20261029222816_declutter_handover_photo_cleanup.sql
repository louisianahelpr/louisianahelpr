-- A refused handover photo can be removed by the member who uploaded it (Declutter audit 1a #10, prod 2026-10-29).
--
-- WHAT WAS BROKEN: the app uploads a handover photo first, then the RPC checks it (declutter_porch_photo,
-- declutter_seller_picked_up, declutter_seller_delivered). When the RPC refused it (wrong place, older than 10
-- minutes, before the booked day), the file stayed in the private declutter-handover bucket for good: no storage
-- policy let anyone but the service delete there (the job-photos "Sellers delete own unattached declutter photos"
-- policy is another bucket, and excludes the handover and problem folders). Each retry left another photo of the
-- seller's porch behind (the audit's object stayed until its cleanup script removed it).
--
-- WHAT CHANGES:
--   * declutter_handover_photo_unattached(p_name): true only when the path is in the CALLER's own handover folder
--     (<uid>/declutter/handover/<order>/<file>) and no declutter_handovers row holds it as set_out_photo_path or
--     picked_up_photo_path (the only columns a handover-folder path is ever saved in). SECURITY DEFINER so the
--     check sees every handover row, whatever the caller can read; NULL or another member's path answers false.
--   * Policy "declutter-handover: the uploader deletes an unattached handover photo" (DELETE, authenticated):
--     own folder, the handover folder only (never 'problem'), and only while nothing references the path.
--     An attached photo (the proof a handover happened) can never be deleted this way.
-- The app removes the uploaded file when the RPC refuses it (src/lib/declutter/handover.ts discardRefusedHandoverPhoto, on a refusal from all three RPCs).
-- REPLAY-SAFETY: CREATE OR REPLACE; DROP POLICY IF EXISTS before CREATE POLICY.
-- Proof: src/test/pglite/declutterHandoverPhotoCleanup.pglite.mjs. Guard: src/test/declutterHandoverPhotoCleanup.test.ts.

CREATE OR REPLACE FUNCTION public.declutter_handover_photo_unattached(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(
    p_name IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND array_length(string_to_array(p_name, '/'), 1) = 5
    AND split_part(p_name, '/', 1) = (SELECT auth.uid())::text
    AND split_part(p_name, '/', 2) = 'declutter'
    AND split_part(p_name, '/', 3) = 'handover'
    AND NOT EXISTS (SELECT 1 FROM public.declutter_handovers h
                     WHERE h.set_out_photo_path = p_name OR h.picked_up_photo_path = p_name),
    false);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_handover_photo_unattached(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_handover_photo_unattached(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "declutter-handover: the uploader deletes an unattached handover photo" ON storage.objects;
CREATE POLICY "declutter-handover: the uploader deletes an unattached handover photo" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'declutter-handover'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[3] = 'handover'
    AND public.declutter_handover_photo_unattached(name)
  );
