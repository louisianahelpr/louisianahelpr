ALTER TABLE public.jobs ADD COLUMN helper_on_the_way_at timestamptz DEFAULT NULL;
ALTER TABLE public.jobs ADD COLUMN helper_arrived_at timestamptz DEFAULT NULL;