-- ST-008: a job that is not flexible must have a start time.
--
-- A non-flexible job with start_time NULL gets four different start times
-- from the server: auto_start_due_jobs reads midnight, sweep_dayof_confirm_reminders
-- 09:00, job_expires_at_for_schedule 23:59:59, and sweep_job_start_reminders
-- never fires for it. The client already refuses the state
-- (useJobSubmit.ts, useJobDerived.ts); nothing on the server did.
--
-- Measured live 2026-09-24: 216 rows violate, every one is_seed, none is a
-- recurring parent. Seed fixtures may keep a NULL start_time, but a recurring
-- parent may not, even as a seed: charge-recurring-visits copies start_time
-- and is_flexible_schedule to each visit (not is_seed) AFTER charging the
-- card, so a violating parent would take the money and then fail to create
-- the visit.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_start_time_required;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_start_time_required CHECK (
    COALESCE(is_flexible_schedule, false)
    OR start_time IS NOT NULL
    OR (is_seed AND recurrence_days IS NULL)
  );
