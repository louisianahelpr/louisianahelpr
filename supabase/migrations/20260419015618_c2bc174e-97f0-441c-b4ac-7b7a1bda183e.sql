ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS social_webhook_url text;