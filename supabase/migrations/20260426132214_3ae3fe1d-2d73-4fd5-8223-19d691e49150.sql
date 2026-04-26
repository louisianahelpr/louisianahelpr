-- Saved job searches: helprs save filter combos and get notified when new matching jobs post.
CREATE TABLE public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  category text,
  parish text,
  max_budget numeric,
  min_budget numeric,
  location_keyword text,
  notify_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz
);

CREATE INDEX idx_saved_searches_user ON public.saved_searches(user_id);
CREATE INDEX idx_saved_searches_notify ON public.saved_searches(notify_enabled) WHERE notify_enabled = true;

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own saved searches"
  ON public.saved_searches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own saved searches"
  ON public.saved_searches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved searches"
  ON public.saved_searches FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved searches"
  ON public.saved_searches FOR DELETE
  USING (auth.uid() = user_id);

-- Cap saved searches per user at 10 to prevent abuse.
CREATE OR REPLACE FUNCTION public.enforce_saved_search_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.saved_searches
  WHERE user_id = NEW.user_id;
  IF v_count >= 10 THEN
    RAISE EXCEPTION 'You can save up to 10 searches. Delete one to add another.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_saved_search_limit
  BEFORE INSERT ON public.saved_searches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_saved_search_limit();

-- When a new open job posts, fan out notifications to helprs whose saved searches match.
CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_record RECORD;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  FOR match_record IN
    SELECT DISTINCT s.id, s.user_id, s.name
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    WHERE s.notify_enabled = true
      AND p.role = 'helper'
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      AND (s.category IS NULL OR s.category = NEW.category::text)
      AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget)
      AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (
        s.location_keyword IS NULL
        OR NEW.location ILIKE '%' || s.location_keyword || '%'
      )
      -- Throttle: do not notify the same saved search more than once per hour.
      AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      match_record.user_id,
      '🎯 New job matches your saved search',
      'A new job matches "' || match_record.name || '": ' || NEW.title || ' ($' || NEW.budget || ')',
      'job_match',
      '/dashboard?job=' || NEW.id::text
    );

    UPDATE public.saved_searches
       SET last_notified_at = now()
     WHERE id = match_record.id;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_saved_searches
  AFTER INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_saved_searches_on_new_job();