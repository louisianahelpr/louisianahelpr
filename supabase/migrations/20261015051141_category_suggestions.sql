-- "Suggest a category" (owner decision I1, 2026-10-14, docs/specs/louisiana-hub-roadmap.md
-- "Everyone welcome"): wherever a category is picked, a user can type a
-- suggestion; it lands in an admin queue; the admin approves or declines.
-- "Other" keeps working the whole time, so nobody waits on the queue to post.
--
-- Behind the hidden switch 'suggest_category' (created 'testers', never on):
-- every RPC below starts with require_feature, and the client button reads
-- useFeature("suggest_category").
--
-- What "approved" does today: the suggestion is marked approved (with every
-- other pending suggestion of the same words in the same area), audited, and is
-- the list the next category release adds from. A job category is the
-- job_category enum, which every client renders from its own label/icon tables,
-- so a new value reaches everyone through a release (see
-- 20261015050648_add_trade_job_categories.sql for the shape of one).
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO
-- NOTHING, and grants restated each run.

CREATE TABLE IF NOT EXISTS public.category_suggestions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable + SET NULL: an account deletion anonymises, the demand signal stays.
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Where it was suggested (named suggested_in, not area: fixtures across the
  -- repo use `area` for other things and the fixture contract keys on names).
  suggested_in text NOT NULL CHECK (suggested_in IN ('jobs', 'declutter')),
  suggestion  text NOT NULL CHECK (char_length(btrim(suggestion)) BETWEEN 2 AND 40),
  normalized  text GENERATED ALWAYS AS (lower(regexp_replace(btrim(suggestion), '\s+', ' ', 'g'))) STORED,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  admin_note  text CHECK (admin_note IS NULL OR char_length(admin_note) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS category_suggestions_status_idx
  ON public.category_suggestions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS category_suggestions_user_idx
  ON public.category_suggestions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS category_suggestions_normalized_idx
  ON public.category_suggestions (suggested_in, normalized);

-- RLS on with NO policies: nobody reads or writes the table directly; the
-- definer RPCs below are the only way in.
ALTER TABLE public.category_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.category_suggestions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.category_suggestions TO service_role;

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('suggest_category', 'testers',
        'Suggest a category: the "Suggest a category" button wherever a category is picked, '
        'and the admin queue that approves them. Gates suggest_category() and the admin RPCs.')
ON CONFLICT (key) DO NOTHING;

-- Submit a suggestion as the signed-in caller. Returns the suggestion id.
-- A repeat of the caller's own pending suggestion (same words, same area)
-- returns the existing id instead of a second row. At most 5 per 24 hours.
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
  IF p_area IS NULL OR p_area NOT IN ('jobs', 'declutter') THEN
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

COMMENT ON FUNCTION public.suggest_category(text, text) IS
  'I1 "Suggest a category": queue a category suggestion for the caller (area jobs|declutter). '
  'Behind hidden switch suggest_category. Banned callers refused; 5 per 24h; a repeat of the '
  'caller''s own pending suggestion returns its id.';

-- Admin queue. One row per suggestion, with how many suggestions share its words
-- in that area (the demand signal) and the suggester's display name.
CREATE OR REPLACE FUNCTION public.admin_list_category_suggestions(p_status text DEFAULT 'pending')
RETURNS TABLE(
  id uuid, area text, suggestion text, status text, created_at timestamptz,
  suggester_name text, same_count bigint, reviewed_at timestamptz, admin_note text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_feature('suggest_category');
  IF NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'declined') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT s.id, s.suggested_in, s.suggestion, s.status, s.created_at,
           p.full_name::text,
           (SELECT count(*) FROM public.category_suggestions o
             WHERE o.suggested_in = s.suggested_in AND o.normalized = s.normalized),
           s.reviewed_at, s.admin_note
      FROM public.category_suggestions s
      LEFT JOIN public.profiles p ON p.user_id = s.user_id
     WHERE s.status = p_status
     ORDER BY s.created_at DESC
     LIMIT 200;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_category_suggestions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_category_suggestions(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_list_category_suggestions(text) IS
  'Admin-only: the category suggestion queue for one status (pending|approved|declined), newest '
  'first, max 200, with same_count = suggestions sharing the words in that area.';

-- Admin decision. Approve or decline one pending suggestion; every other
-- pending suggestion of the same words in the same area gets the same decision.
-- Writes one admin_audit_log row. Returns how many suggestions it resolved.
CREATE OR REPLACE FUNCTION public.admin_review_category_suggestion(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_row  public.category_suggestions%ROWTYPE;
  v_to   text;
  v_n    integer;
BEGIN
  PERFORM public.require_feature('suggest_category');
  IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 300 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;

  -- Read plain, then serialize on the WORDS before locking any row: two admins
  -- deciding two suggestions with the same words would otherwise each hold one
  -- row and wait for the other's (a deadlock). normalized is generated from a
  -- column nothing updates, so the key is stable.
  SELECT * INTO v_row FROM public.category_suggestions WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_suggestion' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('review_category_suggestion'),
                                hashtext(v_row.suggested_in || '|' || v_row.normalized));
  SELECT * INTO v_row FROM public.category_suggestions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_suggestion' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'already_reviewed' USING ERRCODE = '55000';
  END IF;

  v_to := CASE WHEN p_approve THEN 'approved' ELSE 'declined' END;
  UPDATE public.category_suggestions s
     SET status = v_to, reviewed_by = v_uid, reviewed_at = now(),
         admin_note = NULLIF(btrim(p_note), '')
   WHERE s.status = 'pending'
     AND s.suggested_in = v_row.suggested_in
     AND s.normalized = v_row.normalized;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'review_category_suggestion', 'category_suggestion', p_id::text,
          jsonb_build_object('decision', v_to, 'area', v_row.suggested_in,
                             'suggestion', v_row.suggestion, 'resolved', v_n));
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_review_category_suggestion(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_category_suggestion(uuid, boolean, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_review_category_suggestion(uuid, boolean, text) IS
  'Admin-only: approve or decline a pending category suggestion and every pending one with the '
  'same words in the same area; audited (review_category_suggestion). Approved = queued for the '
  'next category release.';
