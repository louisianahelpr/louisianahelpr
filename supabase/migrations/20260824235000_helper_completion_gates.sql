-- Server-side teeth for the unified completion gates (owner, 2026-08-24,
-- decided during the two-role lifecycle E2E).
--
-- WHAT WAS WRONG. Two client paths write `helper_completed_at` — the payout
-- CTA (gated: before/after photos + 30-min work floor) and the tracker's Done
-- step (no gates at all). The E2E drove the tracker path to completion with
-- zero photos minutes after Working, and that stamp starts the auto-release
-- clock — so every protection on the CTA was decorative. Both clients now
-- enforce the same gates, and this trigger makes the database the authority
-- so no future surface can bypass them.
--
-- THE GATES (helper-initiated writes only):
--   * before AND after proof photos must be present on the row;
--   * at least 30 minutes since work started — the poster's working
--     confirmation when it exists, else the helper's own arrival stamp.
--     The poster's confirmation is deliberately NOT required (a ghosting
--     poster must not block the payout request; they keep the 24h review
--     window, tightened from 48h the same day).
--
-- Service-role writers (auto-release cron, admin tooling) have auth.uid()
-- NULL and pass through, as does the poster/admin path — identical scoping to
-- enforce_helper_jobs_column_whitelist.

CREATE OR REPLACE FUNCTION public.enforce_helper_completion_gates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL THEN
    IF COALESCE(array_length(NEW.proof_before_urls, 1), 0) = 0
       OR COALESCE(array_length(NEW.proof_after_urls, 1), 0) = 0 THEN
      RAISE EXCEPTION 'completion_requires_proof_photos'
        USING ERRCODE = '23514',
              HINT = 'Add before and after photos before marking the job done.';
    END IF;

    IF COALESCE(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) IS NOT NULL
       AND now() - COALESCE(OLD.poster_confirmed_working_at, OLD.helper_arrived_at) < interval '30 minutes' THEN
      RAISE EXCEPTION 'completion_min_work_time'
        USING ERRCODE = '23514',
              HINT = 'A job cannot be marked done within 30 minutes of starting.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_helper_completion_gates ON public.jobs;
CREATE TRIGGER trg_helper_completion_gates
  BEFORE UPDATE OF helper_completed_at ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_helper_completion_gates();
