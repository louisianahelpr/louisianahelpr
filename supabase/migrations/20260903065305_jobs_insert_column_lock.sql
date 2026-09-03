-- INSERT and UPDATE are separate attack surfaces, and every money guard on
-- `jobs` was written for only one of them.
--
-- `prevent_job_field_escalation` and `enforce_poster_jobs_money_lock` are both
-- BEFORE **UPDATE** — confirmed against prod, not read off a migration:
--
--     trg_prevent_job_field_escalation   BEFORE  UPDATE
--     trg_poster_jobs_money_lock         BEFORE  UPDATE
--
-- and the INSERT policy pins nothing but ownership, IDV and business_id:
--
--     ((auth.uid() = customer_id)
--      AND (idv_requirement_paused() OR EXISTS (… idv_status = 'verified'))
--      AND (business_id IS NULL))
--
-- So every column those triggers defend on UPDATE was writable at POST TIME,
-- which is the one moment every user reaches. The authz lane proved it live in
-- a rolled-back transaction as a non-admin with has_role = false: a job
-- inserted with payment_status = 'escrow', a forged
-- stripe_payment_intent_id, boosted_at set 30 days out, platform_fee 0 — and it
-- came back visible_in_open_jobs_browse = 1. A second probe produced
-- status = 'completed' + payment_status = 'escrow' + helper_id = self, which is
-- exactly the row shape `get_payout_batch_job_ids` selects into the admin
-- payout queue.
--
-- ─── WHY THIS LOCKS SEVEN COLUMNS AND NOT THE WHOLE UPDATE LIST ────────────
--
-- Because copying the UPDATE list would break posting for every user, and a
-- trigger that force-resets too much passes every attack probe while doing it.
-- The client insert payload was read column by column
-- (`src/pages/postjob/jobSubmitHelpers.ts`, the only builder; the only two
-- client inserts into `jobs` are `useJobSubmit.ts:402` and `:423`), and it
-- DOES legitimately set `is_urgent`, `urgent_fee`, `platform_fee_percent`,
-- `platform_fee_amount`, `sales_tax_rate` and `sales_tax_amount` at post time.
-- Forcing those to a default would silently break urgent posting and zero out
-- the commission on every real job — a worse bug than the one being fixed.
--
-- The seven below are the columns that appear in NO legitimate insert path:
--
--     payment_status            → 'unpaid'   forged escrow
--     stripe_payment_intent_id  → NULL       forged payment reference
--     stripe_session_id         → NULL       forged checkout-in-flight
--     boosted_at                → NULL       free paid placement
--     boost_expires_at          → NULL          "
--     is_seed                   → false      hiding a job from admin money figures
--     status                    → 'open'     forging a completed job
--     helper_id                 → NULL       self-assignment
--
-- `helper_id` is on that list and it is worth saying why, because it looks
-- unsafe and is not: a DIRECT OFFER does not set `helper_id`. It sets
-- `offered_to_helper_id` + `direct_offer_status` + `direct_offer_expires_at`,
-- all of which stay writable. `helper_id` is assigned only when an offer or an
-- application is ACCEPTED, which is an UPDATE. Checked before including it.
--
-- STILL OPEN, deliberately, and filed rather than rushed: `is_urgent` /
-- `urgent_fee` (a free urgent placement) and `platform_fee_percent` /
-- `platform_fee_amount` (a self-set commission). Both are real and both need
-- the server to RECOMPUTE the value rather than reject it, because the client
-- legitimately computes them today. That is a larger change than a column lock
-- and it belongs in daylight with the owner awake, not in a trigger written at
-- 06:00. Checkout recomputes the charge from its own figures, which is why this
-- is a revenue-reporting problem rather than a live money-loss one — but it
-- should not stay open past launch.
--
-- ─── RESET, NOT REJECT ─────────────────────────────────────────────────────
--
-- The UPDATE triggers RAISE. This one overwrites. On INSERT there is no OLD to
-- compare against, so "did the caller change this?" is not a question that can
-- be asked — only "what value is arriving?". Raising on a non-default value
-- would reject any future legitimate insert that happens to pass an explicit
-- default, and would turn a code path I failed to find into a hard outage on
-- the app's core action. Overwriting degrades to exactly the right value in
-- every case. The attack silently does nothing, which is also the correct
-- outcome: it tells a prober nothing.
--
-- ─── WHO IS CONSTRAINED ────────────────────────────────────────────────────
--
-- Only a poster inserting their OWN job, mirroring
-- `enforce_poster_jobs_money_lock`'s structure exactly. Service-role edge
-- functions run with auth.uid() IS NULL and pass straight through; an admin
-- inserting on someone else's behalf passes through; an admin posting their own
-- job is constrained, which is correct because they are acting as a user.

CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role (uid NULL) and anyone not inserting their own job pass
  -- through untouched. Same gate as the UPDATE money lock.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Escrow state is the webhook's to set, never the poster's.
  NEW.payment_status           := 'unpaid';
  NEW.stripe_payment_intent_id := NULL;
  NEW.stripe_session_id        := NULL;

  -- Paid placement is create-boost-payment's to grant.
  NEW.boosted_at               := NULL;
  NEW.boost_expires_at         := NULL;

  -- Fixture flag: a poster must not be able to hide a job from the admin
  -- money figures by marking it seed data.
  NEW.is_seed                  := false;

  -- A new job is open and unassigned. Assignment happens on UPDATE, through
  -- accept_application / the direct-offer flow; a direct offer at post time
  -- uses offered_to_helper_id, which is deliberately left writable.
  NEW.status                   := 'open';
  NEW.helper_id                := NULL;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_jobs_insert_column_lock() IS
  'BEFORE INSERT twin of enforce_poster_jobs_money_lock. Those triggers are '
  'UPDATE-only, so every column they defend was writable at post time — the '
  'one moment every user reaches. Resets rather than raises because on INSERT '
  'there is no OLD to compare against. Locks only columns proven absent from '
  'the client insert payload; is_urgent/urgent_fee and the platform_fee '
  'columns are legitimately client-set and need server recomputation instead.';

DROP TRIGGER IF EXISTS trg_jobs_insert_column_lock ON public.jobs;

-- Fires BEFORE the notify/AFTER triggers, and the ban gate stays independent.
CREATE TRIGGER trg_jobs_insert_column_lock
  BEFORE INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_jobs_insert_column_lock();

-- ───────────────────────────────────────────────────────────────────────────
-- The same asymmetry on `applications`, where it is more obvious because the
-- rule is already WRITTEN DOWN twice on the neighbouring policies.
--
-- Measured against prod:
--
--   UPDATE "Helpers can update their own pending applications"
--       USING  (auth.uid() = helper_id AND status = 'pending')
--       CHECK  (auth.uid() = helper_id AND status = 'pending')
--   DELETE "Helpers can delete their own pending applications"
--       USING  (auth.uid() = helper_id AND status = 'pending')
--   INSERT "Helpers can create applications"
--       CHECK  (auth.uid() = helper_id)                       ← no status
--
-- So a helper could self-insert an application already marked 'accepted' on a
-- stranger's job. Proven live by the authz lane. It does not hire — `helper_id`
-- on `jobs` is untouched, and acceptance is a separate UPDATE the poster makes
-- — but it forges poster-facing state and fires `notify_on_application`, so the
-- poster is told someone was accepted onto their job by someone who was not
-- them.
--
-- Pinning the literal rather than "the default": a policy that says
-- `status = 'pending'` keeps holding if the column default is ever changed,
-- and it reads as the same sentence as the two policies beside it.
DROP POLICY IF EXISTS "Helpers can create applications" ON public.applications;

CREATE POLICY "Helpers can create applications"
  ON public.applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = helper_id
    AND status = 'pending'::application_status
  );

COMMENT ON POLICY "Helpers can create applications" ON public.applications IS
  'A helper may only create an application in the pending state. The UPDATE and '
  'DELETE policies have always pinned status = pending in every arm; INSERT did '
  'not, so a helper could self-insert an already-accepted application on someone '
  'else''s job — forging poster-facing state and firing notify_on_application. '
  'INSERT and UPDATE are separate attack surfaces.';
