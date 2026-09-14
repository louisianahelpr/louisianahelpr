-- Message attachments: a sender could read ANY user's attachment, and nobody
-- could upload or delete a voice note.
--
-- ── 1. Cross-user read (security) ─────────────────────────────────────────
-- "message-attachments: participants and admins read" granted SELECT on an
-- object when SOME messages row had attachment_url = objects.name and the
-- reader was that row's sender or receiver. The "Users can send messages"
-- INSERT policy never constrained attachment_url, so a user who knew (or was
-- shown) another user's object path could insert a message in a job of their
-- own, point attachment_url at that path, and then sign and download the file.
-- Proved on prod 2026-09-14 with two test accounts: helper-e2e inserted a
-- message in its own job naming a file poster-e2e had uploaded to a job
-- helper-e2e is not a party to, then createSignedUrl returned 200 and the
-- downloaded bytes equalled the upload. (UPDATE was never a route:
-- `authenticated` holds no UPDATE privilege on messages.attachment_url.)
--
-- Fixed twice over, so either layer alone closes it:
--   a. READ: the object's own path must match the granting message — its job
--      segment equals messages.job_id and its sender segment equals
--      messages.sender_id. A forged row names someone else's folder, so it
--      grants nothing, including forged rows written before this migration.
--   b. WRITE: a client message may only carry an attachment_url inside its own
--      <job_id>/<sender_id>/ (or voice-notes/<job_id>/<sender_id>/) folder.
--      Checked live before writing this: all 13 attachment rows on prod have
--      exactly that shape.
--
-- ── 2. Voice notes (broken feature) ───────────────────────────────────────
-- src/lib/messageAttachments.ts uploads voice notes to
-- voice-notes/<jobId>/<senderId>/<uuid>.<ext>, where the sender is folder
-- segment [3]. The INSERT and DELETE policies only compared segment [2]
-- (the job id) to auth.uid(), so every voice-note upload was refused by RLS
-- (prod: 403 "new row violates row-level security policy"). Behind that, the
-- bucket's allowed_mime_types had no audio type at all (prod: 415 for
-- audio/webm;codecs=opus and audio/mp4). Storage matches allowed_mime_types
-- literally, parameters included, so the list names the exact MIME strings
-- useVoiceRecorder.ts can hand the upload: audio/mp4, audio/webm;codecs=opus,
-- audio/webm, audio/ogg. The 5 MB bucket file_size_limit is unchanged.
--
-- INSERT now also requires the uploader to be allowed to message in the job
-- named by the path (public.can_message_in_job, the same predicate the messages
-- INSERT policy uses), so nobody can plant an object inside a job they are not
-- part of, and a job id that happens to equal a uid satisfies nothing. DELETE
-- keeps only the sender-segment check, so a user can always remove their own
-- files after a job ends.
--
-- Roles are named: every policy here is TO authenticated (anon has no uid, so
-- the old {public} INSERT policy on messages admitted nobody extra).
--
-- REPLAY-SAFETY: DROP POLICY IF EXISTS before every CREATE; storage DDL is
-- skipped when the storage schema is absent; the policies that call
-- can_message_in_job/is_party_to_job are only (re)created when both exist.

DO $mig$
BEGIN
  IF to_regprocedure('public.can_message_in_job(uuid,uuid)') IS NULL
     OR to_regprocedure('public.is_party_to_job(uuid,uuid)') IS NULL
     OR to_regprocedure('public.has_role(uuid,app_role)') IS NULL
     OR to_regclass('public.messages') IS NULL THEN
    RAISE NOTICE 'message attachment policies skipped: prerequisites not defined yet';
    RETURN;
  END IF;

  -- ── messages INSERT: attachment_url confined to the sender's own folder ──
  DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
  CREATE POLICY "Users can send messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = sender_id
    AND public.can_message_in_job(job_id, (SELECT auth.uid()))
    AND public.is_party_to_job(job_id, receiver_id)
    AND (
      attachment_url IS NULL
      OR (
        split_part(attachment_url, '/', 1) = job_id::text
        AND split_part(attachment_url, '/', 2) = sender_id::text
        AND split_part(attachment_url, '/', 3) <> ''
        AND split_part(attachment_url, '/', 4) = ''
      )
      OR (
        split_part(attachment_url, '/', 1) = 'voice-notes'
        AND split_part(attachment_url, '/', 2) = job_id::text
        AND split_part(attachment_url, '/', 3) = sender_id::text
        AND split_part(attachment_url, '/', 4) <> ''
        AND split_part(attachment_url, '/', 5) = ''
      )
    )
  );

  COMMENT ON COLUMN public.messages.attachment_url IS
    'Storage path in message-attachments bucket (NOT a public URL). Resolve via createSignedUrl(path, 5*60) at display time. Path: <job_id>/<sender_id>/<uuid>-<filename> or voice-notes/<job_id>/<sender_id>/<uuid>.<ext>; the messages INSERT policy and the storage read policy both require the path to be the sender''s own folder in the message''s job.';

  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects absent: storage policies skipped';
    RETURN;
  END IF;

  -- ── storage: upload ──
  DROP POLICY IF EXISTS "message-attachments: sender uploads to own path" ON storage.objects;
  CREATE POLICY "message-attachments: sender uploads to own path"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'message-attachments'
    -- Nested CASE, not AND, so the ::uuid cast only runs once the regex has
    -- matched (AND gives no evaluation-order guarantee).
    AND CASE
      -- voice-notes/<job_id>/<sender_id>/<file>
      WHEN (storage.foldername(name))[1] = 'voice-notes' THEN
        CASE
          WHEN (storage.foldername(name))[3] = (SELECT auth.uid())::text
               AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN public.can_message_in_job(((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
          ELSE false
        END
      -- <job_id>/<sender_id>/<file>
      ELSE
        CASE
          WHEN (storage.foldername(name))[2] = (SELECT auth.uid())::text
               AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN public.can_message_in_job(((storage.foldername(name))[1])::uuid, (SELECT auth.uid()))
          ELSE false
        END
    END
  );

  -- ── storage: delete own ──
  DROP POLICY IF EXISTS "message-attachments: sender deletes own" ON storage.objects;
  CREATE POLICY "message-attachments: sender deletes own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND CASE
      WHEN (storage.foldername(name))[1] = 'voice-notes'
      THEN (storage.foldername(name))[3] = (SELECT auth.uid())::text
      ELSE (storage.foldername(name))[2] = (SELECT auth.uid())::text
    END
  );

  -- ── storage: read, scoped to the object's own job and sender ──
  DROP POLICY IF EXISTS "message-attachments: participants and admins read" ON storage.objects;
  CREATE POLICY "message-attachments: participants and admins read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.attachment_url = storage.objects.name
          AND ((SELECT auth.uid()) = m.sender_id OR (SELECT auth.uid()) = m.receiver_id)
          AND (
            (
              split_part(storage.objects.name, '/', 1) = m.job_id::text
              AND split_part(storage.objects.name, '/', 2) = m.sender_id::text
            )
            OR (
              split_part(storage.objects.name, '/', 1) = 'voice-notes'
              AND split_part(storage.objects.name, '/', 2) = m.job_id::text
              AND split_part(storage.objects.name, '/', 3) = m.sender_id::text
            )
          )
      )
    )
  );

  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets
       SET allowed_mime_types = ARRAY[
             'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
             'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'
           ]
     WHERE id = 'message-attachments';
  END IF;
END
$mig$;
