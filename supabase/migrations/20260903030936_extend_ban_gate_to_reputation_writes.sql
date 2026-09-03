-- AR-002 — the ban gate covered three tables, and none of them was a review.
--
-- `enforce_ban_gate` (→ `is_caller_banned()`) existed as a BEFORE trigger on
-- exactly `applications`, `jobs` and `messages`. So a banned account could not
-- apply, post or message — and could still publish a 1-star review on the
-- person who got them banned, respond publicly under someone else's review
-- (`respond_to_review` UPDATEs `reviews`), and pump a colluder's endorsement
-- count. On a marketplace whose ban exists to stop one member harming another,
-- review-bombing is close to the top of the list of things the ban is FOR.
--
-- The set below was derived, not assumed: every table `authenticated` holds
-- INSERT/UPDATE on whose RLS write policy admits a non-admin member, filtered
-- to those whose rows are visible to, or say something about, another user.
--
-- WHAT IS DELIBERATELY *NOT* GATED, and why — a ban must not disarm someone:
--   * `reports`      — a banned member must still be able to report the person
--                      harassing them. `auto_escalate_reports` only notifies
--                      admins; it applies no consequence, so a banned filer
--                      cannot reach past the queue to hurt anyone. Volume abuse
--                      here is a rate-limit problem, not a ban-gate one.
--   * `user_blocks`  — self-protection.
--   * `disputes`, `job_disputes` — the defence path. Gating these would mean a
--                      ban silently forfeits the money argument that may be the
--                      very thing under dispute.
--   * `job_checkins`, `job_tracking`, `group_job_helpers`,
--     `recurring_visit_releases` — in-flight job execution. A ban landing
--                      mid-job must not strand funded escrow.
--   * `profiles`      — a real residual gap (a banned member can still rewrite
--                      their public bio and display name; `prevent_self_escalation`
--                      pins the trust columns but not the free text). A blanket
--                      UPDATE gate here is the wrong shape: it would also block
--                      legal-consent writes and the Apple-required in-app
--                      deletion path. The correct fix is a column pin on the
--                      public-facing text while banned; filed separately.
--
-- ORDERING NOTE. BEFORE-row triggers fire in alphabetical order, so on
-- `reviews` this gate runs ahead of `trg_enforce_review_validity` and a banned
-- member gets `account_restricted` rather than a validity message that would
-- tell them how to try again. Nothing here writes `ban_status`, so none of it
-- can reach the self-abort hazard that kept the message-scan consequence in an
-- AFTER trigger.
--
-- The 14-day blind period (`set_review_visibility`, AFTER INSERT) is untouched.
-- Its own `UPDATE public.reviews SET feedback_visible_at ...` now passes through
-- the new BEFORE UPDATE gate, which is safe by construction: it only ever runs
-- inside a statement whose caller just cleared the INSERT gate.

DO $$
DECLARE
  v_spec  record;
  v_table text;
BEGIN
  -- Nothing to attach if the gate itself has not been created yet. A partial
  -- history should degrade to a no-op rather than an error.
  IF to_regprocedure('public.enforce_ban_gate()') IS NULL THEN
    RAISE NOTICE 'enforce_ban_gate() not present; skipping ban-gate extension';
    RETURN;
  END IF;

  FOR v_spec IN
    SELECT * FROM (VALUES
      -- table,               trigger name,                        event
      ('reviews',             'trg_ban_gate_reviews_insert',       'INSERT'),
      ('reviews',             'trg_ban_gate_reviews_update',       'UPDATE'),
      ('skill_endorsements',  'trg_ban_gate_skill_endorsements',   'INSERT'),
      ('message_reactions',   'trg_ban_gate_message_reactions',    'INSERT'),
      ('pet_report_cards',    'trg_ban_gate_pet_report_cards',     'INSERT'),
      ('job_revisions',       'trg_ban_gate_job_revisions',        'INSERT')
    ) AS t(tbl, trg, evt)
  LOOP
    v_table := 'public.' || quote_ident(v_spec.tbl);

    IF to_regclass(v_table) IS NULL THEN
      RAISE NOTICE 'table % absent; skipping %', v_table, v_spec.trg;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', v_spec.trg, v_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE %s ON %s FOR EACH ROW EXECUTE FUNCTION public.enforce_ban_gate()',
      v_spec.trg, v_spec.evt, v_table);
  END LOOP;
END
$$;
