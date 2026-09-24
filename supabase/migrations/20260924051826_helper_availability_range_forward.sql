-- ST-002: helper_availability accepted an available day whose end is before
-- its start (live: one real account, Sunday 21:00-17:00). The day renders as
-- available while the browse filter (job.start >= slot.start AND <= slot.end)
-- can match nothing, so every job that day is silently hidden.
-- NOT VALID: new and updated rows are checked; the one existing row belongs to
-- a real user and is left for them to correct in the editor, which now
-- refuses the same shape before saving.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'helper_availability_range_forward'
      AND conrelid = 'public.helper_availability'::regclass
  ) THEN
    ALTER TABLE public.helper_availability
      ADD CONSTRAINT helper_availability_range_forward
      CHECK (is_available IS NOT TRUE OR start_time IS NULL OR end_time IS NULL OR start_time < end_time)
      NOT VALID;
  END IF;
END $$;
