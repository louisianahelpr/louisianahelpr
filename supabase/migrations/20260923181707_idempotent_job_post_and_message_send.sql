-- Q267 + Q268: a retried job post or message send must write ONE row.
--
-- Both writes were plain PostgREST INSERTs with nothing to recognise a repeat.
-- When the request reaches the server and the RESPONSE is lost (a dropped
-- connection on a rural cell signal), the client sees a failure, the user
-- presses again, and the server writes a second, identical row: a second job
-- (and, on the post+pay path, a second Checkout Session) or the same message
-- twice in the thread.
--
-- The fix is a client-generated key that stays the same across every retry of
-- ONE attempt, and a unique index that makes the second INSERT of that key
-- fail with 23505. The client treats that 23505 as "it already landed" and
-- reads the existing row back (useJobSubmit.ts, sendHandlers.ts).
--
--   jobs.client_request_id      UNIQUE (customer_id, client_request_id)
--   messages.client_id          UNIQUE (sender_id, client_id)
--
-- Scoped per author, not globally, so one user can never collide with (or
-- probe for) another's key. Both columns are nullable and both indexes are
-- partial on NOT NULL: every existing row, every server-side insert
-- (charge-recurring-visits' visit rows, system messages) and every client
-- that predates this change writes NULL and is untouched. Account deletion
-- anonymises customer_id / sender_id to NULL, and NULLs never conflict, so
-- anonymised rows cannot trip the index either.
--
-- Grants. INSERT on both tables is table-wide for authenticated, so both
-- keys can be written. SELECT on jobs is COLUMN-level for authenticated
-- (20260915045110 withholds offered_to_helper_id), so a new jobs column comes
-- up with no SELECT at all and the client's lookup-by-key would be a 42501:
-- sync_jobs_select_grants() re-derives the grants from the catalog (the key
-- is the poster's own random value; RLS still decides which ROWS are read).
-- UPDATE on messages is column-scoped to (content, edited_at) and does not
-- gain client_id.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS,
-- and the grant sync is skipped where its function does not exist.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS client_request_id uuid;

COMMENT ON COLUMN public.jobs.client_request_id IS
  'Idempotency key minted by the Post a Job client once per post attempt and '
  'resent on every retry of it (Q267). UNIQUE per customer_id via '
  'jobs_customer_client_request_id_key; NULL for server-created rows.';

CREATE UNIQUE INDEX IF NOT EXISTS jobs_customer_client_request_id_key
  ON public.jobs (customer_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS client_id uuid;

COMMENT ON COLUMN public.messages.client_id IS
  'Idempotency key: the optimistic bubble''s clientId, resent by Tap to Retry '
  '(Q268). UNIQUE per sender_id via messages_sender_client_id_key; NULL for '
  'system messages and older clients.';

CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_client_id_key
  ON public.messages (sender_id, client_id)
  WHERE client_id IS NOT NULL;

DO $$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  ELSE
    RAISE NOTICE 'sync_jobs_select_grants() absent; jobs column grants not re-synced';
  END IF;
END
$$;
