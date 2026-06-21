-- Grant anon EXECUTE on get_marketplace_activity_count().
--
-- The landing/guest surface calls this SECURITY DEFINER RPC to show a live
-- marketplace activity count, but it was only granted to authenticated. Guests
-- hit "permission denied for function get_marketplace_activity_count" (401).
-- It exposes only an aggregate count, no row data, so anon access is safe.
--
-- Guarded for replay safety: the function is defined by an earlier migration,
-- but guard anyway so a partial/from-scratch replay never aborts here.

DO $$
BEGIN
  IF to_regprocedure('public.get_marketplace_activity_count()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_marketplace_activity_count() TO anon;
  END IF;
END
$$;
