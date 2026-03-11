ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS is_urgent boolean DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS urgent_fee numeric DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS cancellation_fee numeric DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS cancellation_fee_status text DEFAULT null;