-- Q1953 (Shops launch pass 2, 2026-11-18): Shops gets "Suggest a category" under its category picker, as Jobs and
-- Declutter have. category_suggestions.suggested_in and suggest_category() allowed only jobs/declutter, so a
-- 'shops' suggestion was refused (invalid_area / the CHECK). This widens both to 'shops'. Still behind the
-- suggest_category hidden switch (require_feature inside suggest_category, unchanged). suggest_category is
-- restated verbatim from its only CREATE (20261015051141_category_suggestions) with 'shops' added to the area list.
-- Replay-safe: the CHECK is dropped by name IF EXISTS and re-added; CREATE OR REPLACE for the function.

ALTER TABLE public.category_suggestions DROP CONSTRAINT IF EXISTS category_suggestions_suggested_in_check;
ALTER TABLE public.category_suggestions
  ADD CONSTRAINT category_suggestions_suggested_in_check CHECK (suggested_in IN ('jobs', 'declutter', 'shops'));

CREATE OR REPLACE FUNCTION public.suggest_category(p_area text, p_suggestion text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_text text := regexp_replace(btrim(COALESCE(p_suggestion, '')), '\s+', ' ', 'g');
  v_id   uuid;
BEGIN
  PERFORM public.require_feature('suggest_category');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_area IS NULL OR p_area NOT IN ('jobs', 'declutter', 'shops') THEN
    RAISE EXCEPTION 'invalid_area' USING ERRCODE = '22023';
  END IF;
  -- Letters first, then words: "Tutoring", "Car Detailing", "Piano / Music".
  -- No URLs or contact details: no @ or : (the shape), no phone-number run of
  -- six or more digits/separators, no "word.tld" (a dot followed straight by
  -- letters; "St. Bernard" passes because a space follows its dot).
  IF char_length(v_text) NOT BETWEEN 2 AND 40
     OR v_text !~ '^[A-Za-z][A-Za-z0-9 &/''(),.-]*$'
     OR v_text ~ '[0-9][0-9 ().-]{5,}[0-9]'
     OR v_text ~* '[a-z0-9-]\.[a-z]{2,}' THEN
    RAISE EXCEPTION 'invalid_suggestion'
      USING ERRCODE = '22023',
            DETAIL = 'Use 2 to 40 letters, numbers, spaces or & / - ( ) , . characters, starting with a letter.';
  END IF;

  -- One caller at a time: the repeat check, the daily count and the insert
  -- below are read-then-write, so parallel calls would pass the cap.
  PERFORM pg_advisory_xact_lock(hashtext('suggest_category'), hashtext(v_uid::text));

  SELECT s.id INTO v_id
    FROM public.category_suggestions s
   WHERE s.user_id = v_uid
     AND s.suggested_in = p_area
     AND s.status = 'pending'
     AND s.normalized = lower(v_text)
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  IF (SELECT count(*) FROM public.category_suggestions s
       WHERE s.user_id = v_uid AND s.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.category_suggestions (user_id, suggested_in, suggestion)
  VALUES (v_uid, p_area, v_text)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.suggest_category(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_category(text, text) TO authenticated, service_role;
