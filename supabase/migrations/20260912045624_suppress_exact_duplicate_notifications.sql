-- One event must produce ONE notification.
--
-- Prod carried duplicate notification rows in two shapes. The loud one was
-- `saved-helper-availability-push`: its "already notified" cursor is stored on
-- `profiles.saved_helper_seen` and written with
-- `.update(...).eq("user_id", id)`. For a customer with no `profiles` row that
-- UPDATE matches zero rows and PostgREST returns `{ data: null, error: null }`,
-- so the cursor never advanced, nothing was logged, and the SAME notification
-- went out on every 6-hourly tick — 20 identical copies per pair and growing.
-- That root cause is fixed in the function itself (zero-row guard + skip a
-- customer whose cursor cannot be stored).
--
-- This migration is the guard that does not live beside the defect: a
-- BEFORE INSERT trigger that refuses an EXACT repeat of
-- (user_id, type, title, message, link) inside a short cooldown, no matter
-- which of the ~20 crons, triggers or edge functions wrote it.
--
-- Why a trigger and not a unique index: the natural key is legitimately
-- repeatable over time (the same job can be started, disputed or delivered
-- again months later), so uniqueness has to be time-scoped, and no unique
-- index can express a window.
--
-- Why ten minutes, and why it is safe: measured against the whole live table
-- (580 rows, all history) exactly ONE pair of rows shares the full natural key
-- within an hour of itself — two `transit_updates` "has arrived" rows 9m26s
-- apart, itself a double-submit. Nothing else in the table's history would
-- have been suppressed. `message` is excluded because a chat notification's
-- body IS the user's text, and two identical short replies in one thread
-- ("ok" … "ok") are a real thing a person does.
--
-- Suppression is NOT silent: the dropped row is counted in
-- `public.notification_dedupe_suppressions`, which is what a regression would
-- show up in.

CREATE TABLE IF NOT EXISTS public.notification_dedupe_suppressions (
  id           bigserial PRIMARY KEY,
  user_id      uuid        NOT NULL,
  type         text,
  title        text,
  link         text,
  suppressed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_dedupe_suppressions ENABLE ROW LEVEL SECURITY;
-- No policy: readable only by service_role / SECURITY DEFINER. Operator data.

CREATE INDEX IF NOT EXISTS notification_dedupe_suppressions_at_idx
  ON public.notification_dedupe_suppressions (suppressed_at DESC);

CREATE OR REPLACE FUNCTION public.suppress_exact_duplicate_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Chat bodies are user text; identical consecutive messages are legitimate.
  IF NEW.type IS NOT DISTINCT FROM 'message' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = NEW.user_id
      AND n.created_at > now() - INTERVAL '10 minutes'
      AND n.type    IS NOT DISTINCT FROM NEW.type
      AND n.title   IS NOT DISTINCT FROM NEW.title
      AND n.message IS NOT DISTINCT FROM NEW.message
      AND n.link    IS NOT DISTINCT FROM NEW.link
  ) THEN
    INSERT INTO public.notification_dedupe_suppressions (user_id, type, title, link)
    VALUES (NEW.user_id, NEW.type, NEW.title, NEW.link);
    RETURN NULL;  -- skip the INSERT
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.suppress_exact_duplicate_notification() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS suppress_exact_duplicate_notification ON public.notifications;
CREATE TRIGGER suppress_exact_duplicate_notification
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.suppress_exact_duplicate_notification();
