-- Message attachments: 3 nullable columns on messages (path-only, no URL).
-- Display side fetches a fresh 5-min signed URL on click via the
-- src/lib/messageAttachments.ts helper.
ALTER TABLE public.messages
  ADD COLUMN attachment_url text,
  ADD COLUMN attachment_mime text,
  ADD COLUMN attachment_size integer;

-- New private bucket for message attachments. 5MB cap matches avatars,
-- generous enough for high-res phone photos + small PDFs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  false,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types,
    public = EXCLUDED.public;

-- Path convention: <job_id>/<sender_id>/<uuid>-<filename>. RLS policies
-- below derive job_id + sender_id from the path so we can authorize
-- without joining to messages on every storage check.

-- Sender uploads: only into a path whose second segment is their own uid.
CREATE POLICY "message-attachments: sender uploads to own path"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'message-attachments'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
);

-- Read: anyone whose uid is a participant on the underlying messages row
-- (sender_id or receiver_id), OR an admin. We look up the messages row
-- via the path's job_id segment to be cheap; multiple messages can share
-- the same job_id so we use EXISTS not single-row lookup.
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
    )
  )
);

-- Sender can also delete their own attachments (e.g. on message deletion).
CREATE POLICY "message-attachments: sender deletes own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
);

COMMENT ON COLUMN public.messages.attachment_url IS
  'Storage path in message-attachments bucket (NOT a public URL). Resolve via createSignedUrl(path, 5*60) at display time. Path convention: <job_id>/<sender_id>/<uuid>-<filename>.';
COMMENT ON COLUMN public.messages.attachment_mime IS
  'MIME of the attachment. One of: image/jpeg, image/png, image/webp, image/heic, application/pdf.';
COMMENT ON COLUMN public.messages.attachment_size IS
  'Size in bytes. Server enforces 5MB cap via bucket file_size_limit; this column is informational for UI.';
