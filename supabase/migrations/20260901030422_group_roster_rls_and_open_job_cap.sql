-- Two independent defects, both found by the 2026-08-31 group/recurring audit.
-- They share a migration because both are one-statement RLS/trigger repairs on
-- features that have ZERO production rows (verified read-only 2026-08-31:
-- `group_job_helpers` has never held a row; no job in prod has
-- `recurrence_days` set), so neither carries a backfill or a data risk.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. `group_job_helpers` — a DELETE that can never match, and an UPDATE that
--    lets a helper move themselves onto someone else's payroll.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260311041556 created the table with RLS enabled and exactly three policies:
-- SELECT, INSERT and UPDATE. There is no DELETE policy, and no later migration
-- adds one. RLS with no policy for a command denies that command outright, so
-- `GroupJobHelpers.tsx`'s "Remove Helpr" control has NEVER been able to remove
-- anyone: the DELETE matches zero rows on every call. Before that file grew its
-- `unwrapMutation` guard the failure was completely silent — the row vanished
-- from the poster's list optimistically, the poster believed they had dismissed
-- a Helpr, and that Helpr was still rostered and still due a payout share. The
-- guard now surfaces "That Helpr wasn't removed", which is honest but describes
-- a control that cannot work rather than one that failed.
--
-- The UPDATE policy is the more serious half:
--
--   USING (auth.uid() IN (SELECT customer_id FROM jobs WHERE id = job_id)
--          OR auth.uid() = helper_id)
--
-- with no WITH CHECK. Postgres then reuses USING as WITH CHECK, so the NEW row
-- only has to satisfy the same disjunction. `auth.uid() = helper_id` holds for
-- the row's own helper no matter what `job_id` says. A helper who is legitimately
-- on ANY group roster could therefore
--
--   UPDATE group_job_helpers SET job_id = '<someone else's funded group job>'
--   WHERE helper_id = auth.uid();
--
-- and `process-scheduled-payouts` — which fans out over exactly this table
-- (index.ts:126-153) — would cut them a Stripe transfer out of a stranger's
-- escrow. The table has default `authenticated` grants (the 20260819060000
-- authz hardening revoked writes on `messages`, not here), so nothing else
-- stands in the way. Nobody can reach this today because the roster is empty,
-- which is the only good time to close it.
--
-- THE MODEL THIS SETTLES ON. The roster is poster-owned bookkeeping, exactly
-- like the INSERT policy already assumes:
--
--   * DELETE — the poster, and ONLY while the job is still staffing
--     (`jobs.status = 'open'`, which is precisely the window
--     `accept_group_application` keeps the job in until the final slot fills).
--     Once the crew is complete the job is a live commitment with escrow behind
--     it, and dropping a Helpr from it is a cancellation — it owes them notice
--     and a fee settlement — so it must not be a silent row delete. Removal
--     after that point is deliberately not expressible here.
--   * UPDATE — the poster only. Helpers had UPDATE for no reason: no client
--     path writes this table as a helper, and the only mutable column is
--     `status`. Dropping their write is the whole exploit above.
--   * The identity columns are frozen by a trigger rather than by WITH CHECK,
--     because a policy cannot compare NEW to OLD. Even the poster may not
--     re-point a roster row at a different job or a different person — that is
--     a delete-and-insert, and both halves are policed above.
--
-- REPLAY-SAFETY: every policy is dropped IF EXISTS before creation, and the
-- trigger is dropped before it is re-created, so the file is idempotent under
-- repeated application.

DROP POLICY IF EXISTS "Participants can update group helpers" ON public.group_job_helpers;
DROP POLICY IF EXISTS "Job owner can update group helpers" ON public.group_job_helpers;
DROP POLICY IF EXISTS "Job owner can remove group helpers while staffing" ON public.group_job_helpers;

CREATE POLICY "Job owner can update group helpers"
  ON public.group_job_helpers
  FOR UPDATE
  USING (
    auth.uid() IN (SELECT j.customer_id FROM public.jobs j WHERE j.id = group_job_helpers.job_id)
  )
  WITH CHECK (
    auth.uid() IN (SELECT j.customer_id FROM public.jobs j WHERE j.id = group_job_helpers.job_id)
  );

CREATE POLICY "Job owner can remove group helpers while staffing"
  ON public.group_job_helpers
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = group_job_helpers.job_id
        AND j.customer_id = auth.uid()
        -- Only while the roster is still filling. After the last slot lands,
        -- accept_group_application flips the job to 'accepted' and this stops
        -- matching, so a staffed crew cannot be quietly edited out from under
        -- the people in it.
        AND j.status = 'open'
    )
  );

CREATE OR REPLACE FUNCTION public.freeze_group_roster_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- `job_id` and `helper_id` together ARE the roster row. Changing either one
  -- is not an edit, it is a different assignment, and it would bypass both
  -- accept_group_application's capacity check and this table's INSERT policy.
  IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'group_roster_job_immutable';
  END IF;
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id THEN
    RAISE EXCEPTION 'group_roster_helper_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS freeze_group_roster_identity ON public.group_job_helpers;
CREATE TRIGGER freeze_group_roster_identity
  BEFORE UPDATE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.freeze_group_roster_identity();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The 5-open-job cap fires on inserts that cannot possibly be open jobs,
--    which charges a recurring poster and then refuses to give them the visit.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `enforce_open_job_limit` is a BEFORE INSERT trigger on `jobs`. It counts the
-- poster's existing `status = 'open'` rows and raises at 5. It never looks at
-- the row being inserted, so it fires for EVERY insert regardless of that row's
-- status — including the ones that provably cannot add to the count it just
-- measured.
--
-- `charge-recurring-visits` is the case where that costs money. Its ordering is
-- deliberate and documented: charge the poster's saved card FIRST, create the
-- visit only once the PaymentIntent has succeeded, so a declined card can never
-- leave a helper walking into an unfunded job. The visit it then inserts is
-- `status = 'accepted'` with the standing helper already on it — it is not an
-- open listing and never appears in browse. But if the poster happens to have 5
-- other jobs open, this trigger raises on that insert, and the function lands in
-- its "charged but not created" branch and refunds.
--
-- The poster's card is authorised and refunded, they are told "We couldn't
-- charge for your next visit" (which is false — the charge succeeded), the
-- helper is told not to turn up, and the whole cycle repeats tomorrow and every
-- day the date stays inside the 3-day funding window. Nothing about the failure
-- names the real cause.
--
-- THE FIX IS THE TRIGGER'S OWN ARITHMETIC. The cap's metric is the number of
-- rows with `status = 'open'`. Inserting a row whose status is anything else
-- cannot change that number, so evaluating the cap against it is measuring one
-- thing to gate another. Returning early for a non-'open' insert does not weaken
-- the cap: the count, the threshold, and the rows it protects are all identical,
-- and a poster still cannot create a 6th OPEN job. This also unblocks every
-- other legitimate non-open insert (recurring visits today; direct-offer and
-- instant-book shapes if they ever insert pre-accepted).
--
-- The 'abandoned' exclusion from 20260831010000 is preserved verbatim.

CREATE OR REPLACE FUNCTION public.enforce_open_job_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  open_count integer;
BEGIN
  -- The cap counts 'open' rows. A row that is not being inserted as 'open'
  -- cannot move that count, so it is not what this cap is for. See the note
  -- above: gating it charged recurring posters and then refunded them.
  IF NEW.status IS DISTINCT FROM 'open' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO open_count
  FROM public.jobs
  WHERE customer_id = NEW.customer_id
    AND status = 'open'
    AND payment_status IS DISTINCT FROM 'abandoned';

  IF open_count >= 5 THEN
    RAISE EXCEPTION 'You can have a maximum of 5 open jobs at a time. Please wait for existing jobs to be accepted or close them first.';
  END IF;
  RETURN NEW;
END;
$function$;
