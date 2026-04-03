
-- Add split fee columns to platform_settings
ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS customer_fee_percent numeric NOT NULL DEFAULT 5.00,
ADD COLUMN IF NOT EXISTS helper_fee_percent numeric NOT NULL DEFAULT 10.00;

-- Update existing row to set new defaults
UPDATE public.platform_settings
SET customer_fee_percent = 5.00, helper_fee_percent = 10.00;

-- Add customer fee tracking to jobs table
ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS customer_fee_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS helper_fee_percent numeric DEFAULT NULL;
