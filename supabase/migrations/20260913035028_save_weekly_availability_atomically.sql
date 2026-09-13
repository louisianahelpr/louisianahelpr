-- Saving weekly hours was DELETE, then a separate INSERT from the client. If
-- the helper left the page, lost the network or the insert was refused between
-- the two calls, the whole week was gone and the page fell back to a default
-- 9-5 that was never saved. Found on prod by the journeys audit (2026-09-12):
-- a journey leaving mid-save wiped the test helper's real week.
--
-- One function, one transaction: the delete and the insert commit together or
-- not at all. SECURITY INVOKER so the existing RLS policy ("Helpers can manage
-- their own availability", auth.uid() = helper_id) still governs every row.
CREATE OR REPLACE FUNCTION public.save_weekly_availability(p_slots jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' OR jsonb_array_length(p_slots) > 7 THEN
    RAISE EXCEPTION 'Weekly hours must be a list of at most 7 days' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_slots) s
     WHERE (s->>'day_of_week') IS NULL
        OR (s->>'day_of_week')::int NOT BETWEEN 0 AND 6
  ) THEN
    RAISE EXCEPTION 'Each day needs a day_of_week from 0 to 6' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.helper_availability
   WHERE helper_id = v_uid
     AND specific_date IS NULL;

  INSERT INTO public.helper_availability (helper_id, day_of_week, is_available, start_time, end_time, specific_date)
  SELECT v_uid,
         (s->>'day_of_week')::int,
         COALESCE((s->>'is_available')::boolean, true),
         NULLIF(s->>'start_time', '')::time,
         NULLIF(s->>'end_time', '')::time,
         NULL
    FROM jsonb_array_elements(p_slots) s;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.save_weekly_availability(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_weekly_availability(jsonb) TO authenticated, service_role;
