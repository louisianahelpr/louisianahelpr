-- Create public storage bucket for social post images
INSERT INTO storage.buckets (id, name, public)
VALUES ('social-posts', 'social-posts', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public reads
CREATE POLICY "Public can view social post images"
ON storage.objects FOR SELECT
USING (bucket_id = 'social-posts');

-- Allow service role / admins to upload
CREATE POLICY "Admins can upload social post images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'social-posts' AND has_role(auth.uid(), 'admin'::app_role));

-- Add image_url column to drafts so we persist the generated image
ALTER TABLE public.social_post_drafts
ADD COLUMN IF NOT EXISTS image_url text;