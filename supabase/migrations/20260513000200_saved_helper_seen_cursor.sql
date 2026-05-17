-- Saved-helper availability push cursor
--
-- New column: profiles.saved_helper_seen JSONB DEFAULT '{}'
--
-- The saved-helper-availability-push edge function uses this map to
-- track the highest helper_availability.updated_at it has already
-- notified each customer about. Keyed by helper_id → ISO timestamp.
-- Lightweight per-pair cursor without a separate table.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_helper_seen JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.saved_helper_seen IS
  'Per-customer cursor of saved-helper availability updates already notified about. Keyed by helper_id → ISO timestamp of the latest helper_availability row already pushed.';
