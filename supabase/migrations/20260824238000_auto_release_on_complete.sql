-- Poster opt-in instant release (owner, 2026-08-24: "give the poster the
-- option to auto release when the helpr marks complete, like put that option
-- with auto tip"). Profile-level toggle beside the auto-tip settings; default
-- OFF. Safe to offer only because 20260824235000 made the completion gates
-- (before/after photos + 30-min floor) database-enforced the same day — a
-- flagged poster's escrow releases on the next auto-release pass (cron runs
-- every 30 min) instead of after the 24h review window.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auto_release_on_complete boolean NOT NULL DEFAULT false;
