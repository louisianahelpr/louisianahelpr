
ALTER TABLE public.applications ADD COLUMN attachment_urls text[] DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public) VALUES ('application-attachments', 'application-attachments', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Helpers can upload their own attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'application-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Anyone can view application attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'application-attachments');

CREATE POLICY "Helpers can delete their own attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'application-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
