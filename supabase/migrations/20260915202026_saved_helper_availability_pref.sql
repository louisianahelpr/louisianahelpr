-- Saved-helper availability nudges: opt-in preference (default OFF).
--
-- The saved-helper-availability-push cron (a re-engagement channel) sent every
-- customer who saved a Helpr a "X updated availability" notification whenever
-- that Helpr published new slots. Owner testing prod (2026-09-15) got one for a
-- saved test Helpr and never wants these; the feature has value for users who
-- do want it, so it becomes opt-in rather than being removed.
--
-- This is a STANDALONE preference column, not a `notification_type_pref_map`
-- type: the notification keeps its generic `info` type, and the cron reads this
-- column directly to decide whether to fan out at all (so no in-app row and no
-- device push for anyone who has not opted in). That deliberately keeps the
-- six-registry closed type set (notificationTypeRegistries.test.ts) untouched —
-- like `match_digest_mode` and the quiet-hours columns, which are also prefs
-- the map does not route.
--
-- Default false: nobody gets these unless they turn the switch on. As a bonus
-- it also ends the orphan-customer duplicate stream the cron documents (a
-- favorite_helpers row pointing at a customer with no profile can never opt in).

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS saved_helper_availability boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.notification_preferences.saved_helper_availability IS
  'Opt-in (default false): send "<Helpr> updated availability" nudges for saved Helprs. Read directly by the saved-helper-availability-push cron, not routed through notification_type_pref_map.';
