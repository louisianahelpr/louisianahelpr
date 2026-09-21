-- Nobody applies to their own job. Server-side, on the table.
--
-- WHAT WAS BROKEN (reproduced on prod fncmgoasalhdgfwzhsqa, 2026-09-21, inside
-- a DO block that ended in RAISE EXCEPTION so nothing committed):
--
--   poster 71c56dfb… owns an open, funded (payment_status='escrow'), non-seed
--   job created two hours ago. As `authenticated` with that poster's own sub:
--     INSERT INTO applications (job_id, helper_id, status, message)
--     VALUES (<their own job>, <themselves>, 'pending', …)
--   -> self_app_id=78d3652a-017b-4a55-82ba-ed3d6ffe22b1  self_err=[NO ERROR]
--
--   The row LANDED. Nothing refused it:
--     * the only INSERT policy, "Helpers can create applications", is
--       (auth.uid() = helper_id) AND status='pending' AND NOT blocked AND
--       job_is_funded(job_id) — it never names customer_id;
--     * none of the 11 non-internal triggers on `applications` tested it
--       (this one covered open-status, ownerless, direct-offer, early access,
--       seed, date and expiry — not identity);
--     * no CHECK or UNIQUE constraint covered it (the only UNIQUE is
--       (job_id, helper_id), which a self-application satisfies).
--
--   `apply_to_job` DOES refuse it ("Cannot apply to your own job"), which is
--   why the UI has never shown one. But apply_to_job is one of two write
--   paths: useApplyFlow.ts falls back to a direct `.from("applications")
--   .insert(...)` on PGRST202, and any client can send that shape directly.
--   The RPC's check is UX; the table had no rule at all.
--
-- WHY IT MATTERS. Not theft — the poster funds their own escrow and loses the
-- platform fee. It is INTEGRITY: a self-completed job inflates completion and
-- review counts, the reliability ladder, neighbour-hire counts and
-- credential/badge progression, all of which other members read when choosing
-- who to hire. And it is a natural accident on an app that is deliberately
-- never role-based — every account both posts and works, and every feature is
-- shown to everyone.
--
-- NOTHING TO BACKFILL. `applications a JOIN jobs j ON j.id=a.job_id WHERE
-- a.helper_id = j.customer_id` returned 0 rows on prod (2026-09-21, checked
-- again after the probe rolled back). No incident to clean up.
--
-- WHY HERE AND NOT A NEW TRIGGER OR A POLICY CLAUSE.
--   * enforce_application_job_state already SELECTs the job row FOR SHARE and
--     already has `customer_id` in hand (it uses it for the ownerless check),
--     so the rule costs one comparison and zero extra reads. A second trigger
--     would re-fetch the same row under a second lock.
--   * A WITH CHECK clause on the INSERT policy would need its own
--     get_job_customer_id(job_id) call (an unlocked read, racing a
--     customer_id change) and can only answer "false" — PostgREST would
--     surface a bare 42501 "new row violates row-level security policy", with
--     no sentence the helper can read. The trigger can name the reason.
--
-- ORDERING. The new C3 sits immediately after C2 (ownerless) and BEFORE C1
-- (job_not_open), C5 (early access) and the rest, because "this is your own
-- post" is the true and most actionable reason whatever else is also wrong
-- with the job. RLS WITH CHECK is evaluated after BEFORE ROW triggers, so C3
-- also pre-empts the policy's job_is_funded clause: a poster self-applying to
-- their own UNFUNDED job now reads "you can't apply to your own post" rather
-- than a funding refusal. That is what makes the e2e assertion in
-- e2e/journeys/abuse/idor-and-authz.spec.ts able to fail.
--
-- The server-context early return is unchanged: a cron spawning the next
-- recurring visit, or an admin tool, is not a helper tapping Apply.
--
-- Every other line of this body is verbatim from the live definition read with
-- pg_get_functiondef on 2026-09-21 (last redefined by 20260915101102). All
-- seven existing RAISE codes are preserved
-- (src/test/migrationRaiseCodesPreserved.test.ts guards that).
--
-- REPLAY-SAFETY: CREATE OR REPLACE only, no new objects, no grants touched.
-- Every function it calls (is_server_context, early_access_cutoff,
-- seed_jobs_hidden_publicly) predates this file and is resolved at call time,
-- not at definition time, so a from-scratch rebuild is unaffected.

CREATE OR REPLACE FUNCTION public.enforce_application_job_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
DECLARE
  v_job RECORD;
BEGIN
  -- Service-role writers run with no JWT. Same gate as the credential tier
  -- trigger beside this one: a cron spawning the next recurring visit, or an
  -- admin tool, is not a helper tapping Apply.
  --
  -- This early return is safe only because RLS excludes NULL-uid callers
  -- before the trigger fires: the sole INSERT policy on `applications` is
  -- TO authenticated with WITH CHECK (auth.uid() = helper_id), which is
  -- NULL -> false for an anon or sub-less token. If that policy is ever
  -- loosened, this line becomes a bypass.
  -- 20260915051905: no longer rests on that. An anon caller (NULL uid, role
  -- anon) is judged like any other client; only a server context passes.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- FOR SHARE (added 2026-09-13): block behind any in-flight UPDATE of this
  -- job — poster_cancel_job's FOR UPDATE, accept_application, a status PATCH —
  -- and read the status THAT transaction committed, not the one before it.
  -- Without the lock, 14 of 20 applications fired alongside a cancel landed on
  -- the cancelled job (the FK's KEY SHARE made the INSERT wait, but only after
  -- this SELECT had already said 'open').
  SELECT j.status,
         j.customer_id,
         j.offered_to_helper_id,
         j.direct_offer_status,
         j.created_at,
         j.is_seed,
         j.date_needed,
         j.expires_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = NEW.job_id
   FOR SHARE;

  -- No row is the FK's problem, not ours; let it raise its own error.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- C2. A job outlives the person who posted it: account deletion anonymises
  -- rather than deletes and deliberately preserves `status`, so an ownerless
  -- job stays 'open' forever. Until now this was refused only because the
  -- notification trigger downstream could not address a NULL poster — a
  -- protection that would evaporate the moment that path was made
  -- null-tolerant, and which meanwhile showed the helper a raw NOT NULL
  -- constraint violation.
  IF v_job.customer_id IS NULL THEN
    RAISE EXCEPTION 'job_has_no_owner'
      USING ERRCODE = '42501',
            HINT = 'The person who posted this job has closed their account.';
  END IF;

  -- C3 (2026-09-21). You cannot apply to your own post. See the header: the
  -- INSERT policy never named customer_id, no constraint covered it, and the
  -- only enforcement lived inside the apply_to_job RPC — which the client's
  -- own PGRST202 fallback, and any direct PostgREST call, goes around.
  --
  -- Deliberately BEFORE the status/early-access/date checks: whatever else is
  -- wrong with the job, this is the reason the person can act on.
  --
  -- Compared against NEW.helper_id rather than auth.uid() so it holds for the
  -- SECURITY DEFINER paths too (apply_to_job, respond_to_direct_offer), where
  -- a row could be written for a helper_id other than the caller. A poster who
  -- direct-offers a job to themselves is refused here as well, which is
  -- correct: the row that offer would create is still a self-application.
  IF v_job.customer_id = NEW.helper_id THEN
    RAISE EXCEPTION 'cannot_apply_to_own_job'
      USING ERRCODE = '42501',
            HINT = 'You posted this job, so you cannot also apply to it.';
  END IF;

  -- C1. Every discovery surface requires status = 'open'.
  IF v_job.status <> 'open' THEN
    RAISE EXCEPTION 'job_not_open'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer accepting applications.';
  END IF;

  -- C4. A job under a live direct offer is private to the helper it was
  -- offered to. The feed withholds it; so must the write path.
  IF v_job.offered_to_helper_id IS NOT NULL
     AND v_job.direct_offer_status = 'pending'
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_reserved_for_another_helper'
      USING ERRCODE = '42501',
            HINT = 'This job has been offered directly to someone else.';
  END IF;

  -- C5. The Early Access perk. The targeted helper of a direct offer keeps the
  -- same escape hatch the four surfaces give them, so a person who was invited
  -- to a job can always answer it immediately.
  IF v_job.created_at > public.early_access_cutoff()
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_in_early_access_window'
      USING ERRCODE = '42501',
            HINT = 'This job is in its Early Access window. Pro and Elite members can apply first.';
  END IF;

  -- C6. Fixture rows, on the shared switch — so when the flag is flipped at
  -- launch the seed jobs go quiet in the feed AND stop accruing real
  -- applications, instead of only the former.
  IF COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RAISE EXCEPTION 'job_not_available'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer available.';
  END IF;

  -- C8. A job whose day has passed is not workable. This IS a feed filter —
  -- `date_needed >= CURRENT_DATE` appears in get_ranked_open_jobs,
  -- get_public_open_jobs and get_open_jobs_for_map (not in open_jobs_browse) —
  -- which is why the TimeZone above has to match theirs exactly.
  IF v_job.date_needed IS NOT NULL AND v_job.date_needed < CURRENT_DATE THEN
    RAISE EXCEPTION 'job_date_has_passed'
      USING ERRCODE = '42501',
            HINT = 'The date this job was needed has already passed.';
  END IF;

  -- C9. Likewise an expired one. This is filtered on only ONE surface today
  -- (get_open_jobs_for_map), so enforcing it here is deliberately stricter
  -- than any feed currently implies — confirmed with the owner before shipping.
  IF v_job.expires_at IS NOT NULL AND v_job.expires_at <= now() THEN
    RAISE EXCEPTION 'job_expired'
      USING ERRCODE = '42501',
            HINT = 'This job posting has expired.';
  END IF;

  RETURN NEW;
END;
$function$;
