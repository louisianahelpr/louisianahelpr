-- Q1461 (owner-reported 2026-10-06): Helprs never saw the poster's
-- "Materials I'll provide" note or the "Access & Parking" notes.
--
-- WHAT WAS BROKEN. The post form stored BOTH notes in one column,
-- jobs.special_requirements, as "Materials I'll provide: <x>\n\n<access>".
-- Only the admin dialog, the edit dialog and the poster's own card rendered
-- it. Worse, the column is returned by open_jobs_browse (anon + every signed-in
-- browser), so the access text — gate codes, which door, where the key is —
-- was readable over the API by anyone, while no Helpr was ever shown it.
--
-- OWNER DECISION (pop-up 2026-10-06):
--   * materials -> shown to EVERYONE viewing the job (job page, browse card);
--   * access & parking -> shown ONLY to the booked Helpr(s) and the poster.
-- OWNER ANSWERS (2026-10-06, after the first review):
--   (1) a Helpr can NOT read them once the job is completed or cancelled;
--   (2) admins CAN read them;
--   (3) the poster CAN edit them after booking (no booked lock on these;
--       materials_note keeps its lock), and the booked Helpr(s) are told;
--   (4) a hired-but-unconfirmed Helpr CAN read them, like the address.
--
-- WHAT THIS DOES
--   1. jobs.materials_note (public text, <= 500), synced into the column
--      SELECT grants (sync_jobs_select_grants) and appended to
--      open_jobs_browse.
--   2. public.job_access_notes (job_id PK -> jobs ON DELETE CASCADE, notes
--      <= 500). RLS on, nothing for anon. SELECT: the poster, an admin, and,
--      until the job is completed or cancelled, the job's helper_id, its
--      series' recurring_helper_id, or a crew-roster member
--      (can_read_job_access_notes, definer, reads auth.uid() itself so it
--      cannot be used to probe who is booked on someone else's job).
--      INSERT/UPDATE/DELETE: the poster only, booked or not; a change on a
--      live job tells its Helpr(s) ("Access notes updated") and is copied to
--      the series' live visits (job_access_notes_changed).
--   3. zzzzz_jobs_route_notes: any write that still sends the combined text in
--      special_requirements (a native build from before this change, or any
--      other writer) is split by split_special_requirements(): the materials
--      half goes to materials_note, the access half to job_access_notes, and
--      special_requirements is set to NULL. It sorts LAST among the BEFORE
--      triggers so the booked lock and the contact scan see the write first.
--      The CHECK jobs_special_requirements_retired then makes "no access
--      text in a jobs column" a schema fact, so no browse view or RPC that
--      still names special_requirements can return it.
--   4. Backfill through the same trigger (prod held 2 such rows, measured
--      2026-10-06 20:3xZ: 23dfb700 cancelled, 4d7f3085 open; both prefixed).
--   5. Recurring visits inherit the series' materials note (route trigger)
--      and access note (trg_jobs_visit_inherits_access_notes), so
--      charge-recurring-visits needs no change.
--   6. Account deletion (purge_user_data 4b, which nulled special_requirements
--      on the poster's retained jobs) also nulls materials_note and deletes
--      the access notes on them: the job outlives its poster (customer_id is
--      ON DELETE SET NULL, helper_id kept), so a gate code left behind would
--      stay readable by the Helpr with nobody able to remove it.
--   7. materials_note joins: locked_when_booked (enforce_poster_jobs_money_lock),
--      the contact-leak scan (reject_contact_leak_in_job), and the direct-offer
--      terms that void a pending accept (clear_job_accept_pending). The access
--      note is scanned by its own trigger, as special_requirements was.
--
-- REPLAY-SAFE: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS
-- throughout; constraints added only when absent; the view goes through the
-- to_regclass guard its predecessors use; grants restated. Proof:
-- src/test/pglite/jobAccessNotes.pglite.mjs (applies this file 3x).

-- ── 1. jobs.materials_note ──────────────────────────────────────────────────
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS materials_note text;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.jobs'::regclass
                    AND conname = 'jobs_materials_note_len') THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_materials_note_len
      CHECK (materials_note IS NULL OR char_length(materials_note) <= 500);
  END IF;
END
$c$;

-- Column-level SELECT for authenticated (20260915045110): a new jobs column is
-- unreadable until the grants are re-synced.
DO $g$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END
$g$;

-- ── 2. job_access_notes ─────────────────────────────────────────────────────
-- The FK is DEFERRABLE INITIALLY DEFERRED for one writer: the route trigger
-- below runs BEFORE INSERT on jobs, when the job row does not exist yet, and
-- files the access half of a legacy combined text under the job's final id.
-- The check still runs, at commit.
CREATE TABLE IF NOT EXISTS public.job_access_notes (
  job_id     uuid PRIMARY KEY
             REFERENCES public.jobs(id) ON DELETE CASCADE
             DEFERRABLE INITIALLY DEFERRED,
  notes      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_access_notes_notes_len
    CHECK (char_length(notes) <= 500 AND btrim(notes, E' \t\r\n') <> '')
);

COMMENT ON TABLE public.job_access_notes IS
  'Q1461: the poster''s Access & Parking notes (gate codes, parking, which door). '
  'Readable only by the poster and the booked Helpr(s); never by browse.';

ALTER TABLE public.job_access_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_access_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_access_notes TO authenticated;
GRANT ALL ON public.job_access_notes TO service_role;

-- Who may read a job's access notes: the poster, and, while the job is live
-- (not completed or cancelled: owner answer 1), the job's Helpr (hired,
-- confirmed or not: owner answer 4), the series' standing Helpr, or a member
-- of its crew roster. Definer so the crew lookup and the series parent are
-- not hidden by their own tables' RLS; it reads auth.uid() itself and takes
-- no user argument, so a caller can only ever ask about themselves.
CREATE OR REPLACE FUNCTION public.can_read_job_access_notes(_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = _job_id
       AND (j.customer_id = auth.uid()
            OR (j.status::text NOT IN ('completed', 'cancelled')
                AND (j.helper_id = auth.uid()
                     OR j.recurring_helper_id = auth.uid()
                     OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                                 WHERE g.job_id = j.id AND g.helper_id = auth.uid()))))
  );
$fn$;

REVOKE ALL ON FUNCTION public.can_read_job_access_notes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_job_access_notes(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Poster and booked Helprs read access notes" ON public.job_access_notes;
-- The poster clause is spelled out (the job_pets id match) so the readability
-- derivations that read policy text (dataExportCoversEveryUserTable) see that
-- the poster reads these rows; the function adds the booked Helprs.
CREATE POLICY "Poster and booked Helprs read access notes" ON public.job_access_notes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = job_access_notes.job_id
                    AND j.customer_id = (SELECT auth.uid()))
         OR public.can_read_job_access_notes(job_id));

-- Owner answer 2: admins read them (dispute handling: "couldn't get in").
DROP POLICY IF EXISTS "Admins read access notes" ON public.job_access_notes;
CREATE POLICY "Admins read access notes" ON public.job_access_notes
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- Writes: the poster only (same id match as job_pets' "Poster manages the
-- pets on their job": jobs.customer_id is the auth uid), booked or not
-- (owner answer 3).
DROP POLICY IF EXISTS "Poster adds access notes" ON public.job_access_notes;
CREATE POLICY "Poster adds access notes" ON public.job_access_notes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j
                       WHERE j.id = job_access_notes.job_id
                         AND j.customer_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Poster edits access notes" ON public.job_access_notes;
CREATE POLICY "Poster edits access notes" ON public.job_access_notes
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = job_access_notes.job_id
                    AND j.customer_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j
                       WHERE j.id = job_access_notes.job_id
                         AND j.customer_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Poster removes access notes" ON public.job_access_notes;
CREATE POLICY "Poster removes access notes" ON public.job_access_notes
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = job_access_notes.job_id
                    AND j.customer_id = (SELECT auth.uid())));

-- Row stamps and the contact scan. NO booked lock (owner answer 3): the
-- poster may change these after booking; job_access_notes_changed tells the
-- Helpr(s).
CREATE OR REPLACE FUNCTION public.enforce_job_access_notes_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_reason   text;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    IF TG_OP = 'UPDATE' AND NEW.job_id IS DISTINCT FROM OLD.job_id THEN
      RAISE EXCEPTION 'job_access_notes.job_id cannot change' USING ERRCODE = '42501';
    END IF;
    -- The stamps are the database's, never the client's.
    NEW.created_at := CASE WHEN TG_OP = 'INSERT' THEN now() ELSE OLD.created_at END;
    NEW.updated_at := now();
    -- Same scanner and error shape as the job's public text (IB-002): these
    -- notes used to live in special_requirements, which was scanned.
    IF TG_OP = 'INSERT' OR NEW.notes IS DISTINCT FROM OLD.notes THEN
      v_reason := public.contact_leak_reason(NEW.notes);
      IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = 'check_violation',
          MESSAGE = v_reason || ' in the access and parking notes. Keep contact details and payment off the post; hiring and payment happen in the app.';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_job_access_notes_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_access_notes_write ON public.job_access_notes;
CREATE TRIGGER trg_job_access_notes_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.job_access_notes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_access_notes_write();

-- Owner answer 3: a change to the notes of a LIVE job (not completed or
-- cancelled) tells its Helpr(s): the job's helper_id (hired, confirmed or
-- not), the series' standing Helpr, the crew roster, and the Helpr of each
-- live visit of a series. A series' live visits get the same notes, so a
-- booked visit never keeps an old gate code. Writes made under
-- app.access_notes_server_write (a visit inheriting its series' note, this
-- function's own copy to the visits, account deletion) tell nobody.
-- FOR SHARE (race class, 20260913014328): the job's state decides who is told.
CREATE OR REPLACE FUNCTION public.job_access_notes_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_job      uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;
  v_customer uuid;
  v_helper   uuid;
  v_series   uuid;
  v_status   text;
  v_title    text;
  v_visit    record;
  v_visits   uuid[] := '{}';
  v_visit_helprs uuid[] := '{}';
BEGIN
  IF current_setting('app.access_notes_server_write', true) = '1' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.notes IS NOT DISTINCT FROM OLD.notes THEN
    RETURN NULL;
  END IF;

  SELECT j.customer_id, j.helper_id, j.recurring_helper_id, j.status::text, j.title
    INTO v_customer, v_helper, v_series, v_status, v_title
    FROM public.jobs j WHERE j.id = v_job
     FOR SHARE;
  -- A job inserted in this same transaction by the legacy route trigger is
  -- not visible yet (NOT FOUND): it is new, so nobody is booked on it.
  IF NOT FOUND OR v_status IN ('completed', 'cancelled') THEN
    RETURN NULL;
  END IF;

  -- The series' live visits (locked like the job) carry the same notes.
  FOR v_visit IN
    SELECT c.id, c.helper_id FROM public.jobs c
     WHERE c.parent_job_id = v_job AND c.status::text NOT IN ('completed', 'cancelled')
       FOR SHARE
  LOOP
    v_visits := v_visits || v_visit.id;
    v_visit_helprs := v_visit_helprs || v_visit.helper_id;
  END LOOP;
  PERFORM set_config('app.access_notes_server_write', '1', true);
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.job_access_notes n WHERE n.job_id = ANY (v_visits);
  ELSE
    INSERT INTO public.job_access_notes (job_id, notes)
    SELECT v.id, NEW.notes FROM unnest(v_visits) AS v(id)
    ON CONFLICT (job_id) DO UPDATE SET notes = EXCLUDED.notes;
  END IF;
  PERFORM set_config('app.access_notes_server_write', '', true);

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  SELECT DISTINCT r.uid,
         'Access notes updated',
         'The poster updated the access and parking notes for "' || COALESCE(v_title, 'your job')
           || '". Open the job to see them before you go.',
         'job_updates',
         '/jobs?job=' || v_job::text,
         v_job
    FROM (
      SELECT v_helper AS uid
      UNION ALL SELECT v_series
      UNION ALL SELECT g.helper_id FROM public.group_job_helpers g WHERE g.job_id = v_job
      UNION ALL SELECT unnest(v_visit_helprs)
    ) r
   WHERE r.uid IS NOT NULL
     AND r.uid IS DISTINCT FROM v_customer
     -- One unread notice per Helpr per job per 10 minutes: a poster typing a
     -- few edits in a row does not flood them (lh-authz-rls re-review, should-fix).
     AND NOT EXISTS (SELECT 1 FROM public.notifications x
                      WHERE x.user_id = r.uid AND x.job_id = v_job
                        AND x.title = 'Access notes updated' AND NOT x.read
                        AND x.created_at > now() - interval '10 minutes');

  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.job_access_notes_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_access_notes_changed ON public.job_access_notes;
CREATE TRIGGER trg_job_access_notes_changed
  AFTER INSERT OR UPDATE OR DELETE ON public.job_access_notes
  FOR EACH ROW EXECUTE FUNCTION public.job_access_notes_changed();

-- The two gates every client-writable job table carries (job_pets is the model).
DO $gates$
BEGIN
  IF to_regprocedure('public.enforce_ban_gate()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ban_gate_job_access_notes_insert ON public.job_access_notes;
    CREATE TRIGGER trg_ban_gate_job_access_notes_insert BEFORE INSERT ON public.job_access_notes
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
    DROP TRIGGER IF EXISTS trg_ban_gate_job_access_notes_update ON public.job_access_notes;
    CREATE TRIGGER trg_ban_gate_job_access_notes_update BEFORE UPDATE ON public.job_access_notes
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
    DROP TRIGGER IF EXISTS trg_ban_gate_job_access_notes_delete ON public.job_access_notes;
    CREATE TRIGGER trg_ban_gate_job_access_notes_delete BEFORE DELETE ON public.job_access_notes
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate();
  END IF;
  -- Q807: the unconfirmed-email gate goes on every public table through its
  -- own attacher (idempotent; it skips tables that already carry it).
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gates$;

-- ── 3. Splitting the legacy combined text ───────────────────────────────────
-- The client composed it as  "Materials I'll provide: <m>"  or
-- "Materials I'll provide: <m>\n\n<access>"  (composeSpecialRequirements,
-- retired by this change); anything without the prefix was access notes only.
-- A materials note that itself held a blank line splits early: the rest goes
-- to the PRIVATE side, which is the safe direction to be wrong in.
CREATE OR REPLACE FUNCTION public.split_special_requirements(p_text text, OUT materials text, OUT access text)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_ws     CONSTANT text := E' \t\r\n';
  v_prefix CONSTANT text := 'Materials I''ll provide:';
  v_text   text := btrim(COALESCE(p_text, ''), E' \t\r\n');
  v_rest   text;
  v_pos    integer;
BEGIN
  materials := NULL;
  access := NULL;
  IF v_text = '' THEN
    RETURN;
  END IF;
  IF left(v_text, length(v_prefix)) = v_prefix THEN
    v_rest := substr(v_text, length(v_prefix) + 1);
    v_pos := position(E'\n\n' IN v_rest);
    IF v_pos > 0 THEN
      materials := NULLIF(btrim(left(v_rest, v_pos - 1), v_ws), '');
      access := NULLIF(btrim(substr(v_rest, v_pos + 2), v_ws), '');
    ELSE
      materials := NULLIF(btrim(v_rest, v_ws), '');
    END IF;
  ELSE
    access := v_text;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.split_special_requirements(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.split_special_requirements(text) TO service_role;

CREATE OR REPLACE FUNCTION public.jobs_route_notes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_split record;
BEGIN
  -- Blank is not a note.
  NEW.materials_note := NULLIF(btrim(NEW.materials_note, E' \t\r\n'), '');

  -- A recurring visit carries its series' materials note.
  IF TG_OP = 'INSERT' AND NEW.parent_job_id IS NOT NULL AND NEW.materials_note IS NULL THEN
    SELECT p.materials_note INTO NEW.materials_note
      FROM public.jobs p WHERE p.id = NEW.parent_job_id
       FOR SHARE;
  END IF;

  -- The legacy combined text: route both halves, keep neither here.
  IF NEW.special_requirements IS NOT NULL THEN
    v_split := public.split_special_requirements(NEW.special_requirements);
    IF v_split.materials IS NOT NULL THEN
      NEW.materials_note := left(v_split.materials, 500);
    END IF;
    IF v_split.access IS NOT NULL THEN
      INSERT INTO public.job_access_notes (job_id, notes)
      VALUES (NEW.id, left(v_split.access, 500))
      ON CONFLICT (job_id) DO UPDATE SET notes = EXCLUDED.notes;
    END IF;
    NEW.special_requirements := NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_route_notes() FROM PUBLIC, anon, authenticated;

-- LAST of the BEFORE triggers (BEFORE triggers fire in name order; the
-- previous last is zzzz_offer_deadline_follows_start): the booked lock and the
-- contact scan judge the write as the client sent it, and trg_jobs_insert_
-- column_lock has already fixed NEW.id.
DROP TRIGGER IF EXISTS zzzzz_jobs_route_notes ON public.jobs;
CREATE TRIGGER zzzzz_jobs_route_notes
  BEFORE INSERT OR UPDATE OF special_requirements, materials_note ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_route_notes();

-- A recurring visit inherits its series' access note. The flag marks it a
-- server copy, so job_access_notes_changed tells nobody about it.
CREATE OR REPLACE FUNCTION public.jobs_visit_inherits_access_notes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM set_config('app.access_notes_server_write', '1', true);
  INSERT INTO public.job_access_notes (job_id, notes)
  SELECT NEW.id, a.notes
    FROM public.job_access_notes a
   WHERE a.job_id = NEW.parent_job_id
  ON CONFLICT (job_id) DO NOTHING;
  PERFORM set_config('app.access_notes_server_write', '', true);
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_visit_inherits_access_notes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_visit_inherits_access_notes ON public.jobs;
CREATE TRIGGER trg_jobs_visit_inherits_access_notes
  AFTER INSERT ON public.jobs
  FOR EACH ROW WHEN (NEW.parent_job_id IS NOT NULL)
  EXECUTE FUNCTION public.jobs_visit_inherits_access_notes();

-- ── 4. Backfill, through the route trigger ──────────────────────────────────
-- Runs as the migration role (a server context), so the locks pass. Under
-- app.access_notes_server_write: moving a note is not a change of it, so no
-- Helpr is told (job_access_notes_changed).
DO $bf$
BEGIN
  PERFORM set_config('app.access_notes_server_write', '1', true);
  UPDATE public.jobs
     SET special_requirements = special_requirements
   WHERE special_requirements IS NOT NULL;
  PERFORM set_config('app.access_notes_server_write', '', true);
END
$bf$;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.jobs'::regclass
                    AND conname = 'jobs_special_requirements_retired') THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_special_requirements_retired
      CHECK (special_requirements IS NULL);
  END IF;
END
$c$;

-- ── 5. open_jobs_browse: + materials_note (appended; CREATE OR REPLACE VIEW
--    may only add columns at the end). Body verbatim from 20261006042617.
--    The access notes are in another table and never joined here.
DO $view$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NULL THEN
    RAISE NOTICE 'open_jobs_browse absent: skipped';
    RETURN;
  END IF;
  EXECUTE $v$
CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false)
AS
 SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending'::text THEN location
            ELSE mask_job_location(location)
        END AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    special_requirements,
    status,
    created_at,
    updated_at,
    boosted_at,
    boost_expires_at,
    expires_at,
    recurrence_interval,
    recurrence_end_date,
    parent_job_id,
    payment_status,
    customer_id,
        CASE
            WHEN customer_id = auth.uid() OR offered_to_helper_id = auth.uid() THEN offered_to_helper_id
            ELSE NULL::uuid
        END AS offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    ( SELECT count(*)::integer AS count
           FROM applications a
          WHERE a.job_id = jobs.id) AS applicant_count,
    pricing_mode,
    round(latitude, 2) AS latitude,
    round(longitude, 2) AS longitude,
    parish,
    credential_tier,
    require_photo_proof,
    recurrence_days,
    recurrence_weeks,
    series_split_ok,
        CASE
            WHEN is_group_job IS TRUE THEN (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id)) ELSE 0 END)
            ELSE NULL::integer
        END AS crew_spots_open,
    materials_note
   FROM jobs
  WHERE (status = 'open'::job_status OR (status = 'accepted'::job_status AND is_group_job IS TRUE AND (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id)) ELSE 0 END) > 0)) AND parent_job_id IS NULL AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT seed_jobs_hidden_publicly()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier) AND (NOT (EXISTS ( SELECT 1 FROM ban_settlement_queue q WHERE q.user_id = jobs.customer_id AND q.review_state = 'open'::text)))
$v$;
END
$view$;

-- Browse is read-only to clients (20260923205337). CREATE OR REPLACE keeps the
-- grants; restated so a replay from scratch ends in the same place.
REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

-- ── 6. The booked lock: + materials_note in locked_when_booked. Body verbatim
--    from 20261004193548 otherwise.
CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'boost_auto_extended',
    'is_urgent',
    'is_seed',
    -- Added 20260915044137 (VN-33). The Helpr arrival stamps are written
    -- only by mark_helper_arrival (helper) and reset by
    -- zz_jobs_arrival_integrity (which sorts after this trigger). A poster
    -- writing the GPS half would satisfy half of the arrival rule for them.
    'helper_arrived_at',
    'helper_arrival_verified_at',
    -- VN-33(b): server-owned near-miss record. A poster writing it would make
    -- their own confirmation count without the Helpr ever being near.
    'helper_arrival_near_miss_at',
    'helper_arrival_near_miss_ft',
    -- ADDED 20260925231810 (Q423). The Helpr's own acceptance and day-of
    -- confirmation. poster_cancel_job charges a late-cancel fee (and strikes
    -- the poster) only while helper_confirmed_at is set, so a poster who
    -- cleared it cancelled late for $0. No poster path writes either.
    'helper_confirmed_at',
    'helper_dayof_confirmed_at',
    -- ADDED 20261004165404 (Q1189). The row's birth time: browse freshness
    -- and the early-access cutoff read it, and no poster path writes it.
    'created_at'
  ];
  locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'protection_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
  -- ADDED 20260925231810 (Q423). The fee's clock: hours until
  -- date_needed + start_time. Moving it past 24h before cancelling took the
  -- fee to $0. Free to change while nobody is booked.
  locked_when_booked CONSTANT text[] := ARRAY[
    'date_needed',
    'start_time',
    -- ADDED 20261004165404 (Q1204, owner 2026-10-03): once a Helpr is booked
    -- the place and the details they agreed to are locked, like the schedule.
    -- PLACE: where the work is.
    'location',
    'parish',
    'zip_code',
    -- Coordinates are the place too: unlocked, a poster could move the pin
    -- with a PATCH and skip the location lock. The geocoder
    -- (backfill-job-geocode) writes them as service role, a server context.
    'latitude',
    'longitude',
    -- DETAILS: what the work is.
    'title',
    'description',
    'category',
    'special_requirements',
    'photos',
    'scope_video_url',
    'estimated_hours',
    -- With date_needed / start_time: "any time that day" vs a fixed time.
    'is_flexible_schedule',
    -- ADDED 20261004193548 (Q1245, lh-authz-rls review 2026-10-04): the
    -- terms the Helpr agreed to. TERMS: requires_w9 false -> true adds
    -- paperwork after the agreement (the require_photo_proof shape);
    -- credential_tier moves who qualifies; pricing_mode is how the price was
    -- set. SERIES: is_recurring and recurrence_interval are the series the
    -- Helpr signed up for (recurrence_days/weeks/end_date and series_split_ok
    -- are already locked by enforce_series_columns_client_lock).
    -- OWNERSHIP: department and business_id (the businesses feature was
    -- removed, 20260828011811). No SQL function, edge function or client
    -- update writes any of the seven (measured 2026-10-04), so the lock
    -- breaks no writer; the server keeps them (is_server_context passes).
    'requires_w9',
    'credential_tier',
    'pricing_mode',
    'is_recurring',
    'recurrence_interval',
    'department',
    'business_id',
    -- ADDED 20261006204113 (Q1461): what the poster said they will provide
    -- is part of the details the Helpr agreed to, like special_requirements.
    'materials_note'
  ];
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_always) THEN
      -- ADDED 20261003193541 (Q1180). report_helper_no_show's reopen clears
      -- the departed Helpr's acceptance stamps together with the unassign.
      -- Same flag and the same narrowness as the helper_id unassign below:
      -- the trusted ladder write, these two columns, cleared to NULL, in the
      -- UPDATE that sets helper_id NULL. A stamp left behind made the next
      -- Hire read as an already-accepted re-save (lh-authz-rls review F3).
      IF changed_col IN ('helper_confirmed_at', 'helper_dayof_confirmed_at')
         AND (CASE changed_col WHEN 'helper_confirmed_at' THEN NEW.helper_confirmed_at
                               ELSE NEW.helper_dayof_confirmed_at END) IS NULL
         AND NEW.helper_id IS NULL AND OLD.helper_id IS NOT NULL
         AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Posters may not modify jobs.%', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF OLD.payment_status IS DISTINCT FROM 'unpaid'
     OR OLD.stripe_session_id IS NOT NULL THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        IF changed_col = 'helper_id'
           AND OLD.helper_id IS NULL
           AND NEW.helper_id IS NOT NULL
           AND OLD.status = 'open' THEN
          CONTINUE;
        END IF;
        -- ADDED 2026-09-05 — the server-owned UNASSIGN.
        -- `report_helper_no_show` reopens the job by clearing helper_id, and
        -- announces itself with the same transaction-local flag four other
        -- triggers already honour. Narrow on purpose: trusted ladder write,
        -- this column, and NULL specifically. Re-pointing helper_id at another
        -- person stays blocked even here.
        IF changed_col = 'helper_id'
           AND NEW.helper_id IS NULL
           AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Posters may not modify jobs.% once checkout has opened', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  -- Q423: once a Helpr is booked (a single job's helper_id, or a crew roster
  -- row naming a Helpr) the schedule is the fee's clock.
  IF OLD.helper_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                 WHERE g.job_id = OLD.id AND g.helper_id IS NOT NULL) THEN
    -- require_photo_proof is NOT in the list: turning it OFF only relaxes the
    -- completion gate (enforce_helper_completion_gates reads it when the Helpr
    -- marks the job done), so the poster keeps that. Turning it ON adds work
    -- the Helpr did not agree to, so that direction is locked.
    IF OLD.require_photo_proof IS DISTINCT FROM TRUE
       AND NEW.require_photo_proof IS TRUE THEN
      RAISE EXCEPTION 'Posters may not change jobs.require_photo_proof once a Helpr is booked (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'The place and details are locked once a Helpr is booked. Message them, or cancel and post the job again.';
    END IF;

    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_booked) THEN
        -- ADDED 20260927012809 (Q407 (8)): a new date / start time the Helpr
        -- ASKED for and this poster ACCEPTED. Its only writer is
        -- respond_job_schedule_change (20260927012807), which sets this
        -- transaction-local flag only after checking that the caller is the
        -- party the request is addressed to and the request is still live,
        -- and clears it right after its one UPDATE. Only the schedule columns
        -- pass; locked_always and locked_when_funded above still apply.
        -- 20261004165404: the carve-out covers the two schedule columns only,
        -- so the flag cannot also unlock the place and details above.
        IF changed_col IN ('date_needed', 'start_time')
           AND current_setting('app.schedule_change_rpc', true) = '1' THEN
          CONTINUE;
        END IF;
        IF changed_col IN ('date_needed', 'start_time') THEN
          RAISE EXCEPTION 'Posters may not move jobs.% once a Helpr is booked (job_id=%)', changed_col, OLD.id
            USING ERRCODE = '42501',
                  HINT = 'A booked Helpr planned around this time. Message them, or cancel and post the job again for the new time.';
        END IF;
        RAISE EXCEPTION 'Posters may not change jobs.% once a Helpr is booked (job_id=%)', changed_col, OLD.id
          USING ERRCODE = '42501',
                HINT = 'The place and details are locked once a Helpr is booked. Message them, or cancel and post the job again.';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_poster_jobs_money_lock() FROM PUBLIC, anon, authenticated;

-- ── 7. Direct-offer terms that void a pending accept: + materials_note (the
--    offered Helpr is shown it). Body verbatim from 20261003214350 otherwise.
CREATE OR REPLACE FUNCTION public.clear_job_accept_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  -- Q1185: a pending accept stays while the row still describes a live offer
  -- for its Helpr: a Hire's offer (accepted, theirs, unconfirmed) or a direct
  -- offer (open, offered to them, pending). Anything else ends it.
  DELETE FROM public.job_accept_pending p
   WHERE p.job_id = NEW.id
     AND NOT (
           (NEW.status::text = 'accepted' AND NEW.helper_id = p.helper_id AND NEW.helper_confirmed_at IS NULL)
        OR (NEW.status::text = 'open' AND NEW.helper_id IS NULL
            AND NEW.offered_to_helper_id = p.helper_id AND NEW.direct_offer_status = 'pending'));

  -- A direct offer's yes was given to the terms on screen at the tap: when,
  -- where, what, the pay and the series. If the poster changes them while it
  -- waits on setup, it is never completed on terms the Helpr did not see
  -- (final review #2: the poster moved a pending direct accept's date, start
  -- and place, and Stripe then booked the Helpr on them; Q423's schedule lock
  -- reads helper_id, NULL on a direct offer). The yes ends and the Helpr is
  -- told; the poster was never told of the yes, so their edit is neither
  -- refused nor reported. Direct offers only (the job is open): a Hire's
  -- schedule moves only through the agreed-change RPC, which both sides
  -- accept, and its yes protects the Helpr from the expiry strike (re-review
  -- of the final fixes, must-fix 2 and 3). Coordinates are not terms: only
  -- the geocoders write them, and the Helpr never sees them (must-fix 1).
  IF NEW.status::text = 'open'
     AND (OLD.date_needed, OLD.start_time, OLD.estimated_hours, OLD.is_flexible_schedule,
          OLD.location, OLD.parish, OLD.zip_code,
          OLD.title, OLD.description, OLD.category, OLD.special_requirements, OLD.photos,
          OLD.scope_video_url, OLD.require_photo_proof,
          OLD.budget, OLD.pricing_mode, OLD.is_urgent, OLD.urgent_fee,
          OLD.is_recurring, OLD.recurrence_interval, OLD.recurrence_days, OLD.recurrence_weeks,
          OLD.recurrence_end_date, OLD.series_split_ok, OLD.materials_note)
         IS DISTINCT FROM
         (NEW.date_needed, NEW.start_time, NEW.estimated_hours, NEW.is_flexible_schedule,
          NEW.location, NEW.parish, NEW.zip_code,
          NEW.title, NEW.description, NEW.category, NEW.special_requirements, NEW.photos,
          NEW.scope_video_url, NEW.require_photo_proof,
          NEW.budget, NEW.pricing_mode, NEW.is_urgent, NEW.urgent_fee,
          NEW.is_recurring, NEW.recurrence_interval, NEW.recurrence_days, NEW.recurrence_weeks,
          NEW.recurrence_end_date, NEW.series_split_ok, NEW.materials_note) THEN
    WITH gone AS (
      DELETE FROM public.job_accept_pending p WHERE p.job_id = NEW.id RETURNING p.helper_id
    )
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT g.helper_id,
           'The job changed',
           'The details of "' || COALESCE(NEW.title, 'the job')
             || '" changed after you tapped Accept, so your accept was not completed.'
             -- "still yours" only while it is (re-review should-fix 6)
             || CASE WHEN NEW.direct_offer_expires_at IS NULL OR NEW.direct_offer_expires_at > now()
                     THEN ' The offer is still yours: look at the new details and tap Accept again if they work for you.'
                     ELSE '' END,
           'job_updates',
           '/jobs?job=' || NEW.id::text,
           NEW.id
      FROM gone g;
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.clear_job_accept_pending() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_jobs_clear_accept_pending ON public.jobs;
CREATE TRIGGER trg_jobs_clear_accept_pending
  AFTER UPDATE OF helper_id, helper_confirmed_at, status, offered_to_helper_id, direct_offer_status,
                  date_needed, start_time, estimated_hours, is_flexible_schedule,
                  location, parish, zip_code,
                  title, description, category, special_requirements, photos,
                  scope_video_url, require_photo_proof,
                  budget, pricing_mode, is_urgent, urgent_fee,
                  is_recurring, recurrence_interval, recurrence_days, recurrence_weeks,
                  recurrence_end_date, series_split_ok, materials_note ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.clear_job_accept_pending();

-- ── 8. Contact scan: + materials_note, public text like the description.
--    Body verbatim from 20260924045813 otherwise.
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title THEN
    v_reason := public.contact_leak_reason(NEW.title);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in the job title. Keep contact details and payment off the post; hiring and payment happen in the app.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.description IS DISTINCT FROM OLD.description THEN
    v_reason := public.contact_leak_reason(NEW.description);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in the job description. Keep contact details and payment off the post; hiring and payment happen in the app.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.special_requirements IS DISTINCT FROM OLD.special_requirements THEN
    v_reason := public.contact_leak_reason(NEW.special_requirements);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in the job special requirements. Keep contact details and payment off the post; hiring and payment happen in the app.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.materials_note IS DISTINCT FROM OLD.materials_note THEN
    v_reason := public.contact_leak_reason(NEW.materials_note);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = v_reason || ' in the materials note. Keep contact details and payment off the post; hiring and payment happen in the app.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_job ON public.jobs;
CREATE TRIGGER trg_reject_contact_leak_in_job
  BEFORE INSERT OR UPDATE OF title, description, special_requirements, materials_note ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_job();

-- ── 9. Download My Data: the poster's own access notes (Q1461). Body verbatim
--    from 20261005060801 (live md5(pg_get_functiondef) 2026-10-06 =
--    ed37f6650b8fe4eaa67956b79927b7a8, that file) plus the one section after
--    job_pets, scoped like it to the caller's own jobs. Grants restated
--    (service_role only, Q408). jobs.materials_note rides in the jobs section.
--    The no-argument door stays dropped (Q408), restated for replay.
DROP FUNCTION IF EXISTS public.export_my_data();

CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;

-- ── 10. Account deletion (Q1461): purge_user_data 4b also nulls
--     materials_note and deletes the poster's access notes. Body verbatim from
--     20260924072554, the newest definition (live prosrc compared 2026-10-06:
--     identical, 35006 chars), plus those two changes. Grants restated as live
--     (postgres + service_role only).
CREATE OR REPLACE FUNCTION public.purge_user_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_jobs_deleted   int := 0;
  v_jobs_redacted  int := 0;
  v_messages       int := 0;
  v_notifications  int := 0;
  v_push_tokens    int := 0;
  v_prefs          int := 0;
  v_payouts        int := 0;
  v_profile        int := 0;
  v_nolog          int := 0;
  v_login          int := 0;
  v_saved          int := 0;
  v_fraud          int := 0;
  v_ref_codes      int := 0;
  v_ref_credits    int := 0;
  v_ref_credits_an int := 0;
  v_referrals      int := 0;
  v_referrals_an   int := 0;
  v_roster         int := 0;
  v_analytics      int := 0;
  v_errorlogs      int := 0;
  v_tracking       int := 0;
  v_availability   int := 0;
  v_favorites      int := 0;
  v_consent_an     int := 0;
  v_reports_an     int := 0;
  v_jobs_kept_fk   int := 0;
  v_gift_cards     int := 0;
  -- Added by 20260903035008.
  v_email          text;
  v_searches       int := 0;
  v_dismissals     int := 0;
  v_emailtrack     int := 0;
  v_checkins       int := 0;
  v_violations     int := 0;
  v_shadowbans     int := 0;
  v_adminnotes     int := 0;
  v_blocks         int := 0;
  v_viol_an        int := 0;
  v_jobs_actor_an  int := 0;
  v_reviewer_an    int := 0;
  v_sendlog        int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'purge_user_data: p_user_id is required';
  END IF;

  -- 0. Capture the email BEFORE anything nulls it.
  --
  --    `email_send_log` (step 4q) has no user column at all — `recipient_email`
  --    is the only link to a person, so the address is the only key that can
  --    reach it. Step 4e nulls `profiles.email` and the caller deletes the auth
  --    user immediately after, so this is the last point at which it is
  --    knowable.
  --
  --    auth.users leads because it is the authoritative copy and is still
  --    present here (the auth delete is the caller's step 4, after this RPC).
  --    On a RETRY following a partial run both may be gone; v_email is then
  --    NULL and step 4q no-ops, which is correct — the first run already did
  --    it. Same reasoning as the `anonymized_at` guard on 4e.
  SELECT COALESCE(
           (SELECT u.email::text FROM auth.users u WHERE u.id = p_user_id),
           (SELECT p.email       FROM public.profiles p WHERE p.user_id = p_user_id)
         )
    INTO v_email;

  -- 4a. Jobs the user POSTED that touched nobody and no money. Erase outright.
  --
  --     Scoped to customer_id ONLY. A job where this user was merely the
  --     helper is the POSTER's record — deleting it would destroy a third
  --     party's history to satisfy this user's request. The FK conversion in
  --     the previous migration nulls helper_id on those instead.
  --
  --     The money test is an ALLOWLIST (`payment_status = 'unpaid'`), not a
  --     denylist: when a new payment_status is added, an allowlist retains the
  --     row by default and a denylist deletes it. For a destructive predicate,
  --     default-retain is the only safe direction. `helper_id IS NULL` is the
  --     other half — once a helper was assigned, the job is part of THEIR work
  --     history too.
  --
  --     ── Why this is a loop with an exception handler ────────────────────
  --     The three NOT EXISTS clauses below cover `payout_transfers`, `reviews`
  --     and `applications`. They are NOT the whole set: eight further tables
  --     reference `jobs(id)` with no ON DELETE clause, i.e. NO ACTION —
  --     `user_violations.job_id`, `user_strikes.job_id`, `gift_cards.job_id`,
  --     `skill_endorsements.job_id`, `home_maintenance_reminders.last_job_id`,
  --     `worker_protection_credits.job_id`, `str_processed_events.job_id`, and
  --     `jobs.parent_job_id`. A cancelled, unpaid, unassigned job carrying a
  --     `user_violations` row — which `apply_cancellation_violation_consequence`
  --     writes routinely — would raise 23503 and abort this entire transaction,
  --     which is exactly the permanent-refusal failure these two migrations
  --     exist to eliminate.
  --
  --     Enumerating all eleven would work today and rot the moment somebody
  --     adds a twelfth. Instead each delete is attempted individually and a
  --     foreign-key violation is caught and treated as "this job belongs to
  --     someone else's record after all" — the job stays, and step 4b redacts
  --     it like any other retained job. Default-retain, enforced by the
  --     database rather than by a list somebody has to remember to update.
  --
  --     NOTE (20260903035008): step 4n now deletes this user's
  --     `user_violations`, one of those eight blockers. It runs AFTER this
  --     loop, deliberately — moving it earlier would make strictly more jobs
  --     erasable, and quietly widening a destructive predicate is not a change
  --     to make as a side effect of a PII sweep. Blocked jobs are retained and
  --     redacted by 4b, which is the safe outcome either way.
  DECLARE
    v_job_id uuid;
  BEGIN
    FOR v_job_id IN
      SELECT j.id
      FROM public.jobs j
      WHERE j.customer_id = p_user_id
        AND COALESCE(j.payment_status, 'unpaid') = 'unpaid'
        AND j.helper_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt WHERE pt.job_id = j.id)
        AND NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.job_id = j.id)
        AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id)
    LOOP
      BEGIN
        DELETE FROM public.jobs WHERE id = v_job_id;
        v_jobs_deleted := v_jobs_deleted + 1;
      EXCEPTION WHEN foreign_key_violation THEN
        -- Something else still points at this job. Keep it; 4b redacts it.
        v_jobs_kept_fk := v_jobs_kept_fk + 1;
      END;
    END LOOP;
  END;

  -- 4b. Jobs the user POSTED that DID carry money: retain the financial record,
  --     strip the free text that identifies them. `location` is the poster's
  --     street address and `description` routinely carries a phone number or a
  --     gate code. Title, budget, fees, dates, status and the Stripe ids stay —
  --     that is what makes the row reconcilable, and it is also all the
  --     counterparty needs to recognise the job in their own history.
  WITH upd AS (
    UPDATE public.jobs
       SET location             = NULL,
           latitude             = NULL,
           longitude            = NULL,
           description          = 'This job''s details were removed when the poster closed their account.', -- AL-012 user copy
           special_requirements = NULL,
           materials_note       = NULL -- Q1461
     WHERE customer_id = p_user_id
       AND description IS DISTINCT FROM 'This job''s details were removed when the poster closed their account.'
    RETURNING id
  )
  SELECT count(*) INTO v_jobs_redacted FROM upd;

  -- Q1461: the poster's Access & Parking notes (a gate code) go with the rest
  -- of their free text. The job stays (and its Helpr with it), so the note
  -- would otherwise stay readable with no poster left to remove it. The flag
  -- marks it a server write, so job_access_notes_changed tells nobody.
  PERFORM set_config('app.access_notes_server_write', '1', true);
  DELETE FROM public.job_access_notes n
   WHERE n.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = p_user_id);
  PERFORM set_config('app.access_notes_server_write', '', true);

  -- 4c. The tables that carry PII and have NO foreign key at all, so nothing
  --     cascades and nothing would ever clean them up.
  --
  --     Scoped to `sender_id` ONLY. Deleting on `receiver_id` too would destroy
  --     messages the COUNTERPARTY wrote — the identical mistake to cascading
  --     away the reviews this user authored, just pointed the other way. What
  --     someone else typed is their record; the departing user's own words are
  --     the thing being erased. The counterparty is left with a one-sided
  --     thread, which is the honest representation of "the other person left".
  --
  --     The caller purges `message-attachments` for these rows BEFORE calling
  --     this function, because `messages.attachment_url` is the ONLY pointer to
  --     those objects — deleting the row first would strand the file in storage
  --     permanently with nothing left to locate it by.
  WITH del AS (
    DELETE FROM public.messages
     WHERE sender_id = p_user_id
    RETURNING id
  ) SELECT count(*) INTO v_messages FROM del;

  WITH del AS (
    DELETE FROM public.notifications WHERE user_id = p_user_id RETURNING id
  ) SELECT count(*) INTO v_notifications FROM del;

  -- Privacy-critical: a token that survives deletion keeps delivering this
  -- person's notifications to whatever device still holds it.
  WITH del AS (
    DELETE FROM public.push_tokens WHERE user_id = p_user_id RETURNING id
  ) SELECT count(*) INTO v_push_tokens FROM del;

  WITH del AS (
    DELETE FROM public.notification_preferences WHERE user_id = p_user_id RETURNING id
  ) SELECT count(*) INTO v_prefs FROM del;

  -- 4d. Stamp the payout ledger rows so the NULL helper_id they are about to
  --     receive reads as a deliberate redaction rather than an incomplete
  --     write. Done BEFORE the auth delete, while helper_id still names them.
  WITH upd AS (
    UPDATE public.payout_transfers
       SET helper_redacted_at = now()
     WHERE helper_id = p_user_id
       AND helper_redacted_at IS NULL
    RETURNING id
  ) SELECT count(*) INTO v_payouts FROM upd;

  -- 4e. Redact the profile in place. The row CASCADEs away with the auth user
  --     moments later, so this looks redundant — it is not. It is what makes
  --     the sequence resumable: if the auth delete then fails, the account is
  --     left with no name, no phone, no address, no date of birth and no
  --     document pointer, and a retry finishes the job. Guarded on
  --     `anonymized_at`, one column that means exactly "this row has been
  --     through the purge", rather than a hand-maintained sample of the columns
  --     being nulled that can drift out of sync with the SET list.
  WITH upd AS (
    UPDATE public.profiles
       SET full_name                = NULL,
           phone                    = NULL,
           avatar_url               = NULL,
           insurance_url            = NULL,
           license_url              = NULL,
           date_of_birth            = NULL,
           location                 = NULL,
           latitude                 = NULL,
           longitude                = NULL,
           zip_code                 = NULL,
           bio                      = NULL,
           business_name            = NULL,
           emergency_contact_name   = NULL,
           emergency_contact_phone  = NULL,
           portfolio_urls           = NULL,
           extra_comments           = NULL,
           hear_about_us            = NULL,
           tools_equipment          = NULL,
           email                    = NULL,
           anonymized_at            = now()
     WHERE user_id = p_user_id
       AND anonymized_at IS NULL
    RETURNING id
  ) SELECT count(*) INTO v_profile FROM upd;

  -- 4f. ERASE — the no-FK tables holding this person's own artifacts. Each of
  --     these was proven to survive a completed deletion by querying prod for
  --     the deleted uuid; see the header. `notification_logs` and
  --     `login_history` lead because they hold literal PII (an email address
  --     and an IP), not just a pseudonymous id.
  IF to_regclass('public.notification_logs') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.notification_logs WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_nolog FROM del;
  END IF;

  IF to_regclass('public.login_history') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.login_history WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_login FROM del;
  END IF;

  IF to_regclass('public.saved_jobs') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.saved_jobs WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_saved FROM del;
  END IF;

  -- A fraud flag is a judgment about an identified individual. Once the account
  -- is gone the flag can no longer gate anything, and keeping an accusation
  -- about someone who asked to be forgotten is the same call the first
  -- migration made when it left reviews.reviewee_id on CASCADE.
  IF to_regclass('public.fraud_flags') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.fraud_flags WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_fraud FROM del;
  END IF;

  -- 4g. Referral economy. Their own code and their own unspent balance are
  --     erased; anything that belongs to the OTHER party is anonymised so that
  --     party keeps the credit they earned.
  --
  --     Order matters: referral_credits and referrals both point at
  --     referral_codes(id) with a real FK, so the codes go last.
  IF to_regclass('public.referral_credits') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.referral_credits
         SET referred_user_id = NULL
       WHERE referred_user_id = p_user_id
         AND user_id IS DISTINCT FROM p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_ref_credits_an FROM upd;

    WITH del AS (DELETE FROM public.referral_credits WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_ref_credits FROM del;
  END IF;

  IF to_regclass('public.referrals') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.referrals
         SET referrer_id = NULL
       WHERE referrer_id = p_user_id
         AND referred_id IS DISTINCT FROM p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_referrals_an FROM upd;

    WITH del AS (DELETE FROM public.referrals WHERE referred_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_referrals FROM del;
  END IF;

  IF to_regclass('public.referral_codes') IS NOT NULL THEN
    -- ANONYMISED, not deleted — see the DROP NOT NULL note above. Deleting the
    -- row raised 23503 from a third party's `referrals` row, and nulling that
    -- third party's pointer to make the delete legal would have broken
    -- `check_referral_bonus`'s dedupe key and re-minted their bonus forever.
    --
    -- `code` is rewritten as well as `user_id` nulled, and that half is load-
    -- bearing: a code left readable is a live coupon with no owner, and a new
    -- signup entering it would mint credit toward an account that no longer
    -- exists. The replacement keeps the UNIQUE constraint satisfied and is not
    -- guessable from the original.
    WITH upd AS (
      UPDATE public.referral_codes
         SET user_id = NULL,
             code    = 'REDACTED-' || replace(id::text, '-', '')
       WHERE user_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_ref_codes FROM upd;
  END IF;

  -- 4g-bis. ANONYMISE — behavioural logs.
  --
  --   Found by a different method to the rest: rather than deleting a test
  --   account and looking for what survived, every user-shaped uuid column in
  --   the exposed schema was compared against the LIVE auth.users set. 173 prod
  --   rows name a user who no longer exists, and `analytics_events.user_id`
  --   (63 rows, 3 departed users) is the one that is neither a compliance trail
  --   nor already covered above.
  --
  --   These are ANONYMISED, not deleted, and the distinction is the point: an
  --   event stream exists to be counted in aggregate, and deleting rows would
  --   silently rewrite historical funnels every time somebody closed their
  --   account. Severing the actor keeps the count honest and leaves nothing
  --   attributable. `error_logs` gets the same treatment defensively — it
  --   currently holds no orphans, which only means nobody with an error row has
  --   left yet.
  --
  --   Deliberately NOT touched: `admin_audit_log.admin_id`, the largest orphan
  --   set at 100 rows. That is the compliance trail — "who did what to whom" —
  --   and it is supposed to outlive the admin who left. It has no FK for the
  --   same reason.
  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.analytics_events SET user_id = NULL
       WHERE user_id = p_user_id RETURNING id
    ) SELECT count(*) INTO v_analytics FROM upd;
  END IF;

  -- 20260903035008: `user_agent` joins `user_id` here. Nulling the actor and
  -- leaving the device string behind is the same half-measure this function
  -- already rejected for `legal_acceptances` at 4k, which nulls user_id,
  -- ip_address and user_agent together. 271 prod rows carry both today.
  IF to_regclass('public.error_logs') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.error_logs SET user_id = NULL, user_agent = NULL
       WHERE user_id = p_user_id RETURNING id
    ) SELECT count(*) INTO v_errorlogs FROM upd;
  END IF;

  -- 4g-ter. Close the gift card re-claim hole that the FK conversion in
  --   the first migration opens.
  --
  --   `gift_cards.recipient_id` goes CASCADE -> SET NULL, so a gift this user
  --   had CLAIMED reverts to `recipient_id IS NULL` while `status` stays
  --   'sent'. `claim-gift-card/index.ts:90` refuses only when recipient_id is
  --   non-null and `:129` binds only `.is("recipient_id", null)` — so the row
  --   reads as unclaimed again. `recipient_email` is the departed person's
  --   address, it was never purged, and their email is freed the moment
  --   auth.admin.deleteUser runs. Whoever holds the gift link and can receive
  --   at that address could re-claim donor-funded money.
  --
  --   Nulling `recipient_email` closes it using logic already in that function:
  --   `:112` refuses a token-only claim outright when the gift names no
  --   recipient ("a bearer-only token that anyone could claim is never valid
  --   for a directed gift"). It fails closed, which is what we want. The
  --   donor's record and the amount are untouched.
  IF to_regclass('public.gift_cards') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.gift_cards
         SET recipient_email = NULL
       WHERE recipient_id = p_user_id
         AND recipient_email IS NOT NULL
      RETURNING id
    ) SELECT count(*) INTO v_gift_cards FROM upd;
  END IF;

  -- 4h. ANONYMISE — the group-job roster. Only the LEAD helper is ever written
  --     to jobs.helper_id; every other helper on a group job exists solely as a
  --     row here. Deleting the row would quietly shrink the poster's record of
  --     who worked a completed, paid job, so the row stays and the identity
  --     goes. (The same gap on the read side let a non-lead group helper delete
  --     their account mid-job — closed in _shared/accountPurge.ts
  --     `findActiveWork`, which now reads this table too.)
  IF to_regclass('public.group_job_helpers') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.group_job_helpers
         SET helper_id = NULL
       WHERE helper_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_roster FROM upd;
  END IF;

  -- ── 4i–4k. The five tables the 20260902014651 census could not have found ──
  --
  --   That migration built its list empirically: it deleted one test account
  --   and looked for that uuid across 87 (table, column) pairs. The method is
  --   sound but it is blind by construction to any table the test account
  --   happened to hold no rows in — it can only find what that one user had.
  --   These five were found the other way round: rows were SEEDED into each
  --   table first, and only then was the purge run. Five of six seeded rows
  --   survived a "successful" deletion.
  --
  --   Confirmed against prod (fncmgoasalhdgfwzhsqa, 2026-09-02) before this
  --   was written, rather than inferred from migration history:
  --     select prosrc like '%legal_acceptances%' from pg_proc
  --      where proname = 'purge_user_data'   ->  false, and false for all five.
  --   Orphan census the same day: legal_acceptances 8 rows, ALL EIGHT holding
  --   a non-null ip_address AND user_agent. The other four sat at 0 only
  --   because no deleted user had happened to have such a row yet — the gap is
  --   identical, it just has not been tripped.
  --
  --   All five reference a user by a bare uuid with NO foreign key, so nothing
  --   cascades and the retention policy in 20260901033011 never applies.

  -- 4i. ERASE — live location history. `job_tracking` holds the helper's
  --     latitude/longitude breadcrumbs while a job is in progress. Its only FK
  --     is to `jobs` (ON DELETE CASCADE), and funded jobs are deliberately
  --     RETAINED and redacted rather than deleted (step 4b), so the GPS trail
  --     of a departed person outlives them on exactly the jobs that matter.
  --     There is no anonymise option worth having here: a co-ordinate track is
  --     identifying on its own, and `helper_id` is NOT NULL.
  IF to_regclass('public.job_tracking') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.job_tracking WHERE helper_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_tracking FROM del;
  END IF;

  -- 4j. ERASE — their own schedule and their own saved-helper list, plus every
  --     OTHER user's saved row that names them.
  --
  --     The second direction is the one that is easy to miss and is the more
  --     visible defect: `favorite_helpers` is deleted by `customer_id` (their
  --     list) AND by `helper_id` (their presence in everyone else's list). Left
  --     alone, a deleted helper stays pinned in strangers' saved-helpers tabs
  --     forever, pointing at a redacted profile.
  IF to_regclass('public.helper_availability') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.helper_availability WHERE helper_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_availability FROM del;
  END IF;

  IF to_regclass('public.favorite_helpers') IS NOT NULL THEN
    WITH del AS (
      DELETE FROM public.favorite_helpers
       WHERE customer_id = p_user_id OR helper_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_favorites FROM del;
  END IF;

  -- 4k. ANONYMISE — the consent record and the reports they filed.
  --
  --     `legal_acceptances` is the residual-PII case: `ip_address` and
  --     `user_agent` are the person's literal IP and device string, the same
  --     class as `login_history` (step 4f, ERASEd) — but unlike login history
  --     this table is an append-only record that terms version X was accepted
  --     at time T, which has aggregate value that survives the person. So the
  --     ROW stays and the identity goes: user_id, ip_address and user_agent
  --     are all nulled. What remains cannot be tied back to anybody.
  --
  --     `reports.reporter_id` is somebody ELSE's protection. Deleting the row
  --     would erase a safety filing about the person it names, who has not
  --     asked to be forgotten and may still be on the platform — so the report
  --     survives and only the reporter's identity is dropped.
  --     `reports.reported_id` is deliberately NOT touched: it is a bare uuid
  --     with no PII beside it, the profile behind it is already redacted by
  --     step 4e, and it is the substance of another user's report.
  --
  --     Both columns were NOT NULL until the ALTERs above, for the same reason
  --     the 13 columns in 20260901033011 / 20260902014651 were.
  IF to_regclass('public.legal_acceptances') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.legal_acceptances
         SET user_id = NULL, ip_address = NULL, user_agent = NULL
       WHERE user_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_consent_an FROM upd;
  END IF;

  IF to_regclass('public.reports') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.reports SET reporter_id = NULL
       WHERE reporter_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_reports_an FROM upd;
  END IF;

  -- ══ 4l–4q. 20260903035008 — the remaining no-FK user columns ══════════════
  --
  --   One rule applied throughout, so the calls are consistent rather than
  --   case-by-case. Each clause is a precedent this function already set:
  --
  --     * The user's OWN artifact, with no third-party value        -> ERASE.
  --     * A record that JUDGES or CONSTRAINS this user and can no longer
  --       constrain anyone once the account is gone                 -> ERASE
  --       (the `fraud_flags` precedent at 4f, argued in full there).
  --     * A record of an ACTION AN ADMIN TOOK                       -> RETAIN
  --       (the `admin_audit_log` precedent at 4g-bis).
  --     * A record belonging to a COUNTERPARTY: keep the row, drop the
  --       departing user's identity  -> ANONYMISE (the `reports.reporter_id`
  --       precedent at 4k).

  -- 4l. ERASE — their own settings and their own UI state. No counterparty and
  --     no aggregate value, and `saved_searches.location_keyword` is a street
  --     address they typed.
  IF to_regclass('public.saved_searches') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.saved_searches WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_searches FROM del;
  END IF;


  IF to_regclass('public.broadcast_dismissals') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.broadcast_dismissals WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_dismissals FROM del;
  END IF;

  -- 4m. ERASE — residual IP, device and location telemetry: the `login_history`
  --     class at 4f, which this function already erases rather than anonymises.
  --
  --     `email_tracking` carries `ip_address` and `user_agent` beside the open
  --     or click. `job_checkins` carries `latitude`, `longitude` and a free
  --     `note`, and it is the exact twin of `job_tracking` at 4i — same shape,
  --     same FK-to-jobs-only, same argument: a co-ordinate is identifying on
  --     its own. It was missed there because it holds zero rows, and a
  --     data-driven census cannot see an empty table.
  --
  --     Scoped to this user's OWN check-ins, so the counterparty's half of the
  --     arrival record is untouched. The gate that reads it (`arrivalGate.ts`)
  --     only runs on live jobs, and deletion is already refused while any job
  --     is live (`findActiveWork`), so nothing in flight can depend on these.
  IF to_regclass('public.email_tracking') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.email_tracking WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_emailtrack FROM del;
  END IF;

  IF to_regclass('public.job_checkins') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.job_checkins WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_checkins FROM del;
  END IF;

  -- 4n. ERASE — judgments about this user that can no longer gate anything.
  --     Identical reasoning to `fraud_flags` at 4f.
  --
  --     `user_violations` is the consequence ladder's input; `helper_shadowbans`
  --     is a soft, auto-expiring visibility sanction; and `admin_user_notes.note`
  --     is free text an admin wrote ABOUT this person — the densest PII of the
  --     three. None can constrain an account that does not exist, and a
  --     returning user is issued a new uuid, so none survives as enforcement
  --     either way.
  --
  --     `user_bans` is the deliberate EXCEPTION and is RETAINED — see the
  --     COMMENT on that table. 20260903014600 built `retain_ban_on_deletion` so
  --     a ban's effect outlives deletion as an email hash; deleting the source
  --     row would contradict that, and would make this function depend on that
  --     retention having succeeded.
  --
  --     Shadowban evasion by delete-and-resignup is NOT closed by this — only
  --     formal bans are carried forward by `retained_bans`. That is a question
  --     about `retained_bans`' scope, filed for trust-and-safety rather than
  --     answered here by keeping a row that enforces nothing.
  IF to_regclass('public.user_violations') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.user_violations WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_violations FROM del;
  END IF;

  IF to_regclass('public.helper_shadowbans') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.helper_shadowbans WHERE helper_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_shadowbans FROM del;
  END IF;

  IF to_regclass('public.admin_user_notes') IS NOT NULL THEN
    -- Scoped to `user_id`, the SUBJECT. `admin_id` is retained: that is which
    -- admin wrote it, the admin_audit_log class.
    WITH del AS (DELETE FROM public.admin_user_notes WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_adminnotes FROM del;
  END IF;

  -- 4o. ERASE — the block list, BOTH directions. Exactly the `favorite_helpers`
  --     argument at 4j pointed at the negative list instead of the positive
  --     one: their own blocks leave with them, and their presence in a
  --     stranger's block list would otherwise render forever as a ghost user.
  --
  --     Dropping the rows costs no protection. A block is keyed on a uuid that
  --     will never be issued again, so it is already inert the moment the
  --     account is deleted; protection against a returning bad actor is
  --     `retained_bans`, not this table.
  IF to_regclass('public.user_blocks') IS NOT NULL THEN
    WITH del AS (
      DELETE FROM public.user_blocks
       WHERE blocker_id = p_user_id OR blocked_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_blocks FROM del;
  END IF;

  -- 4p. ANONYMISE — actor pointers on rows that belong to somebody else.
  --
  --     `user_violations.reported_by` is the `reports.reporter_id` case at 4k
  --     exactly: the violation is about a THIRD PARTY who has not asked to be
  --     forgotten, so the row survives and only the reporter's identity goes.
  --
  --     `jobs.cancelled_by` / `disputed_by` / `offered_to_helper_id` are this
  --     user's own participation pointers on a job row whose OTHER
  --     participation pointers — `customer_id`, `helper_id`,
  --     `recurring_helper_id` — are already SET NULL by the FK conversion in
  --     20260901033011. Leaving these three populated makes one row internally
  --     inconsistent: no customer, no helper, but still a named canceller.
  --     `offered_to_helper_id` additionally leaves a job believing it has an
  --     outstanding direct offer to somebody who no longer exists.
  --
  --     `jobs.removed_by` is deliberately NOT in that list. It records an ADMIN
  --     removing a job — an enforcement action, the admin_audit_log class — and
  --     the admin surface that reads it should see the truth.
  --
  --     `profiles.license_reviewed_by` / `insurance_reviewed_by` name the admin
  --     who reviewed somebody ELSE's credential, so they sit on another user's
  --     row and 4e cannot reach them. They are nulled rather than retained
  --     because the schema already decided this exact case:
  --     `helper_verifications.changed_by` is the same concept and carries a real
  --     FK with ON DELETE SET NULL. Consistency with the existing column beats
  --     the general admin-retention rule here.
  IF to_regclass('public.user_violations') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.user_violations SET reported_by = NULL
       WHERE reported_by = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_viol_an FROM upd;
  END IF;

  WITH upd AS (
    UPDATE public.jobs
       SET cancelled_by         = CASE WHEN cancelled_by         = p_user_id THEN NULL ELSE cancelled_by         END,
           disputed_by          = CASE WHEN disputed_by          = p_user_id THEN NULL ELSE disputed_by          END,
           offered_to_helper_id = CASE WHEN offered_to_helper_id = p_user_id THEN NULL ELSE offered_to_helper_id END
     WHERE cancelled_by = p_user_id
        OR disputed_by = p_user_id
        OR offered_to_helper_id = p_user_id
    RETURNING id
  ) SELECT count(*) INTO v_jobs_actor_an FROM upd;

  WITH upd AS (
    UPDATE public.profiles
       SET license_reviewed_by   = CASE WHEN license_reviewed_by   = p_user_id THEN NULL ELSE license_reviewed_by   END,
           insurance_reviewed_by = CASE WHEN insurance_reviewed_by = p_user_id THEN NULL ELSE insurance_reviewed_by END
     WHERE license_reviewed_by = p_user_id
        OR insurance_reviewed_by = p_user_id
    RETURNING id
  ) SELECT count(*) INTO v_reviewer_an FROM upd;

  -- 4q. ERASE — the transactional email log, matched by ADDRESS.
  --
  --     `email_send_log` is the one table in this census with no user column at
  --     all: `recipient_email` is the only link to a person, which is why a
  --     purge keyed entirely on uuid has never been able to see it. 169 of its
  --     174 prod rows name a current user's address.
  --
  --     Deleted rather than anonymised, following `notification_logs` at 4f —
  --     its near-twin, which also carries a `recipient_email` and is erased
  --     outright. Nulling the address instead would leave a row that says
  --     nothing and still costs a write.
  --
  --     `v_email` is NULL on a retry after a partial run (step 0), in which
  --     case this no-ops rather than matching an unbounded set. The empty match
  --     is the safe direction here.
  IF v_email IS NOT NULL AND to_regclass('public.email_send_log') IS NOT NULL THEN
    WITH del AS (
      DELETE FROM public.email_send_log
       WHERE lower(btrim(recipient_email)) = lower(btrim(v_email))
      RETURNING id
    ) SELECT count(*) INTO v_sendlog FROM del;
  END IF;

  RETURN jsonb_build_object(
    'user_id',                          p_user_id,
    'jobs_deleted',                     v_jobs_deleted,
    'jobs_kept_fk_referenced',          v_jobs_kept_fk,
    'jobs_redacted',                    v_jobs_redacted,
    'messages_deleted',                 v_messages,
    'notifications_deleted',            v_notifications,
    'push_tokens_deleted',              v_push_tokens,
    'notification_preferences_deleted', v_prefs,
    'payout_rows_redacted',             v_payouts,
    'profile_redacted',                 v_profile,
    'notification_logs_deleted',        v_nolog,
    'login_history_deleted',            v_login,
    'saved_jobs_deleted',               v_saved,
    'fraud_flags_deleted',              v_fraud,
    'referral_codes_anonymised',        v_ref_codes,
    'referral_credits_deleted',         v_ref_credits,
    'referral_credits_anonymised',      v_ref_credits_an,
    'referrals_deleted',                v_referrals,
    'referrals_anonymised',             v_referrals_an,
    'group_roster_anonymised',          v_roster,
    'analytics_events_anonymised',      v_analytics,
    'error_logs_anonymised',            v_errorlogs,
    'gift_card_recipient_emails_cleared', v_gift_cards,
    'job_tracking_deleted',             v_tracking,
    'helper_availability_deleted',      v_availability,
    'favorite_helpers_deleted',         v_favorites,
    'legal_acceptances_anonymised',     v_consent_an,
    'reports_anonymised',               v_reports_an,
    'saved_searches_deleted',           v_searches,
    'broadcast_dismissals_deleted',     v_dismissals,
    'email_tracking_deleted',           v_emailtrack,
    'job_checkins_deleted',             v_checkins,
    'user_violations_deleted',          v_violations,
    'helper_shadowbans_deleted',        v_shadowbans,
    'admin_user_notes_deleted',         v_adminnotes,
    'user_blocks_deleted',              v_blocks,
    'user_violations_anonymised',       v_viol_an,
    'jobs_actor_cols_anonymised',       v_jobs_actor_an,
    'credential_reviewers_anonymised',  v_reviewer_an,
    'email_send_log_deleted',           v_sendlog
  );
END $function$;

REVOKE ALL ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;
