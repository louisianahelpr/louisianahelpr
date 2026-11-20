-- Add missing index on giveaway_reminder_sends(user_id) flagged by Supabase performance advisor.
-- The FK giveaway_reminder_sends_user_id_fkey has no covering index, causing seq-scans on joins.

CREATE INDEX IF NOT EXISTS giveaway_reminder_sends_user_id_idx
  ON public.giveaway_reminder_sends (user_id);
