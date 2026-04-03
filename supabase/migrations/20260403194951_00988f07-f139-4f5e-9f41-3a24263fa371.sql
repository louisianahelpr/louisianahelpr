
-- Update platform_settings defaults to 10%/10% split model
ALTER TABLE public.platform_settings ALTER COLUMN customer_fee_percent SET DEFAULT 10.00;
ALTER TABLE public.platform_settings ALTER COLUMN helper_fee_percent SET DEFAULT 10.00;

-- Update existing row to match
UPDATE public.platform_settings SET customer_fee_percent = 10.00 WHERE customer_fee_percent = 5.00;
