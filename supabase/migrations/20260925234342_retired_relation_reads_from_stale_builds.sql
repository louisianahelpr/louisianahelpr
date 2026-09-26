-- Q387 (docs/OPEN.md; alert, error_logs, 2026-09-25).
--
-- WHAT WAS BROKEN. The owner's iPhone (native, capacitor://localhost, iOS 18.7)
-- writes a client error_logs row on every dashboard load for two tables that no
-- longer exist:
--   · public.pif_credits (renamed to gift_cards by 20260913051340; warning,
--     source useDashboardSideQueries.*), first row 2026-09-19;
--   · public.broadcast_messages (dropped by 20260924174847; error, source
--     BroadcastBanner.loadActive).
-- PostgREST answers both with PGRST205 "Could not find the table 'public.X' in
-- the schema cache" (measured 2026-09-25 with the anon key: both 404/PGRST205;
-- gift_cards answers 42501, i.e. it exists). Nothing in src/ reads either name
-- (src/test/clientRelationNamesExist.test.ts), and the rows carry no
-- context.release, which errorLogger has stamped for weeks: the caller is an
-- INSTALLED native bundle built before both migrations. Its JavaScript cannot be
-- patched from the repo, so every sweep of error_logs re-found the same rows.
--
-- THE FIX, where every client row passes. trg_error_logs_00_z_retired_relation
-- (BEFORE INSERT; sorts after trg_error_logs_00_stamp_origin, which sets
-- tags.origin, and before trg_error_logs_01_throttle) drops a row only when ALL
-- of these hold:
--   · tags.origin = 'client' (a server row is never touched);
--   · the message is PostgREST's PGRST205 text for public.X;
--   · X is listed in public.retired_client_relations;
--   · X still does not exist (to_regclass NULL). A listed name that exists
--     again means PGRST205 on a real table, a schema-cache fault: kept, loud.
-- Any other PGRST205 (a table the current app expects and the database lacks)
-- is untouched and lands in error_logs exactly as before.
--
-- THE DROP IS COUNTED, NOT SILENT. retired_client_relations.stale_reads /
-- first_stale_read_at / last_stale_read_at record every dropped row, so "an old
-- build is still in use" stays measurable (the same fact push-tokens-empty
-- measures) without a row per dashboard load:
--   SELECT relation, stale_reads, last_stale_read_at
--     FROM public.retired_client_relations WHERE stale_reads > 0;
-- The counter UPDATE is bounded (lock_timeout 50ms, lock_not_available caught,
-- as src/test/errorLogTriggersNeverWait.test.ts requires of error_logs trigger
-- paths) and never raises: if it cannot be written the row is still dropped;
-- if anything else fails the row is KEPT.
--
-- THE LIST is every relation a migration dropped or renamed away that the
-- generated schema no longer has (36, each measured PGRST205 on prod with the
-- anon key, 2026-09-25). src/test/retiredRelationReadsAreNotNoise.test.ts
-- derives that set from the migrations and types.ts and fails unless it equals
-- the rows inserted here and in any later migration: a new DROP TABLE must list
-- its table, and a listed name that comes back must leave the list.
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING,
-- CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS; the trigger is created
-- only while public.error_logs exists. Applied 3x in PGlite.

-- ── 1. the list (server-only) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.retired_client_relations (
  relation            text        PRIMARY KEY CHECK (relation ~ '^[a-z][a-z0-9_]*$'),
  retired_by          text        NOT NULL,
  stale_reads         bigint      NOT NULL DEFAULT 0,
  first_stale_read_at timestamptz,
  last_stale_read_at  timestamptz
);
ALTER TABLE public.retired_client_relations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.retired_client_relations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.retired_client_relations TO service_role;
COMMENT ON TABLE public.retired_client_relations IS
  'Q387: public relations a migration dropped or renamed away (retired_by = that migration). A client error_logs row that is PGRST205 for one of these, while it still does not exist, comes from a stale installed build: trg_error_logs_00_z_retired_relation drops it and counts it here (stale_reads, first/last_stale_read_at). Kept equal to the migrations by src/test/retiredRelationReadsAreNotNoise.test.ts.';

INSERT INTO public.retired_client_relations (relation, retired_by) VALUES
  ('addon_requests', '20260430012651'),
  ('broadcast_dismissals', '20260924174847'),
  ('broadcast_messages', '20260924174847'),
  ('business_api_keys', '20260828004538'),
  ('business_job_templates', '20260828004538'),
  ('business_members', '20260828011811'),
  ('business_webhooks', '20260828004538'),
  ('businesses', '20260828011811'),
  ('care_relationships', '20260829083842'),
  ('community_post_likes', '20260830065052'),
  ('community_posts', '20260830065052'),
  ('email_unsubscribe_tokens', '20260830072801'),
  ('evacuation_pets', '20260830072801'),
  ('helper_circle_members', '20260830072801'),
  ('helper_circles', '20260830072801'),
  ('helper_late_cancellations', '20260830072801'),
  ('helper_preferred_parishes', '20260907194734'),
  ('helper_skills', '20260904034410'),
  ('home_maintenance_reminders', '20260904034410'),
  ('job_boosts', '20260830072801'),
  ('job_disputes', '20260904034410'),
  ('job_milestones', '20260430012651'),
  ('job_scope_items', '20260430012651'),
  ('open_jobs_safe', '20260618120000'),
  ('parish_tax_rates', '20260824010000'),
  ('partner_applications', '20260630000000'),
  ('pet_report_cards', '20260913053041'),
  ('pif_credits', '20260913051340'),
  ('public_profiles', '20260312230251'),
  ('retainer_agreements', '20260830072801'),
  ('skill_endorsements', '20260904034410'),
  ('social_post_drafts', '20260830072801'),
  ('subscription_cancel_reasons', '20260913053041'),
  ('subscription_waitlist', '20260830072801'),
  ('time_credits', '20260901035602'),
  ('worker_protection_credits', '20260830072801')
ON CONFLICT (relation) DO NOTHING;

-- ── 2. the trigger function ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.drop_retired_relation_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $retired$
DECLARE
  v_rel  text;
  v_prev text := current_setting('lock_timeout');
BEGIN
  -- Server rows (edge functions, cron, SECURITY DEFINER paths) are never
  -- touched; tags.origin was stamped by trg_error_logs_00_stamp_origin and a
  -- client cannot claim 'server'.
  IF coalesce(NEW.tags ->> 'origin', '') <> 'client' THEN
    RETURN NEW;
  END IF;

  -- PostgREST's PGRST205 message, verbatim.
  v_rel := substring(coalesce(NEW.message, '')
                     from 'Could not find the table ''public\.([a-z][a-z0-9_]*)'' in the schema cache');
  IF v_rel IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.retired_client_relations r WHERE r.relation = v_rel) THEN
      RETURN NEW;  -- not retired on purpose: a real missing table, stays loud
    END IF;
    IF to_regclass(format('public.%I', v_rel)) IS NOT NULL THEN
      RETURN NEW;  -- it exists again: PGRST205 on it is a schema-cache fault, stays loud
    END IF;

    BEGIN
      IF v_prev IN ('0', '') OR v_prev::interval > interval '50 milliseconds' THEN
        PERFORM set_config('lock_timeout', '50ms', true);
      END IF;
      UPDATE public.retired_client_relations
         SET stale_reads = stale_reads + 1,
             first_stale_read_at = coalesce(first_stale_read_at, now()),
             last_stale_read_at = now()
       WHERE relation = v_rel;
      PERFORM set_config('lock_timeout', v_prev, true);
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      -- The sub-block's abort restored lock_timeout. The row is still dropped.
      NULL;
    END;
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    -- The logger must never break the app, and a doubt keeps the row.
    RETURN NEW;
  END;
END;
$retired$;

COMMENT ON FUNCTION public.drop_retired_relation_error_log() IS
  'Q387: BEFORE INSERT on error_logs. Drops (RETURN NULL) a client-origin PGRST205 row for a relation listed in retired_client_relations that still does not exist, and counts it there (lock_timeout 50ms, never raises). Every other row, including PGRST205 for any unlisted or existing relation, is kept.';

REVOKE ALL ON FUNCTION public.drop_retired_relation_error_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drop_retired_relation_error_log() TO service_role;

-- ── 3. the trigger ────────────────────────────────────────────────────────
DO $trg$
BEGIN
  IF to_regclass('public.error_logs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_error_logs_00_z_retired_relation ON public.error_logs;
    CREATE TRIGGER trg_error_logs_00_z_retired_relation
      BEFORE INSERT ON public.error_logs
      FOR EACH ROW EXECUTE FUNCTION public.drop_retired_relation_error_log();
  END IF;
END;
$trg$;
