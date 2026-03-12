ALTER TABLE public.notification_preferences
  ADD COLUMN email_job_applications boolean NOT NULL DEFAULT true,
  ADD COLUMN email_job_updates boolean NOT NULL DEFAULT true,
  ADD COLUMN email_messages boolean NOT NULL DEFAULT false,
  ADD COLUMN email_payments boolean NOT NULL DEFAULT true,
  ADD COLUMN email_reviews boolean NOT NULL DEFAULT true,
  ADD COLUMN email_promotions boolean NOT NULL DEFAULT false,
  ADD COLUMN email_system_alerts boolean NOT NULL DEFAULT true;