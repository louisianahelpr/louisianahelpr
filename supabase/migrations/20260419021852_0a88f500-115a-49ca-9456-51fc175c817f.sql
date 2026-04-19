ALTER TABLE public.social_post_drafts 
ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image',
ADD COLUMN IF NOT EXISTS video_url text;