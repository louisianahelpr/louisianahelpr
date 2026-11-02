-- A3-75 (audit 11-01, Medium GAP): a Declutter review could not be reported, though a Jobs review can. Owner rule (admin
-- reviews only on report): content goes live at once and admin acts only on a report, so a member hit with an unfair,
-- abusive or contact-baiting Declutter review had no way to reach admin from it. Pattern: 20261101021934 (questions).
-- NEW COLUMN: declutter_reviews.removed_at (an admin took it down after a report). A removed review leaves every
-- member-facing read; the row stays (the order's review slot stays used: declutter_i_reviewed and the UNIQUE
-- (order_id, reviewer_side) still count it, and it still counts toward the blind rule's "both sides reviewed", which is
-- about whether both wrote one).
-- RESTATED FROM THE NEWEST CREATE on this branch (wip/b139-a3 on train-l30), checked by name:
--   reports_reported_type_check    from 20261101021934 (newest), plus 'declutter_review'
--   report_message_party_and_copy   from 20261101021934 (newest); only the declutter_review branch is new
--   declutter_visible_reviews       from 20261021023530 (newest); only "AND r.removed_at IS NULL" is new
--   get_public_profile_stats        from 20261031234653 (newest); only "AND dr.removed_at IS NULL" (Declutter half) is new
--   notify_reporter_report_outcome  from 20261102015348 (newest); only the 'declutter_review' -> 'a review' noun is new
-- NOT RESTATED, checked: export_my_data (newest 20261102030000) exports the member's own data, so a removed review
-- they wrote or one about them stays in their export; to_jsonb(t) carries removed_at, so it says it was removed.
-- declutter_i_reviewed (20261102015451) keeps counting a removed review (the side has reviewed; no second one).
-- admin_section_funnel (20261021091636) counts reviewed orders for admins; unchanged.
-- NEW: declutter_admin_remove_review(review, note, report), declutter_admin_reported_reviews(ids).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE. Grants: the new RPCs
-- authenticated + service_role, never PUBLIC or anon; CREATE OR REPLACE keeps the restated functions' grants.
-- MONEY: none. Proof: src/test/pglite/declutterReviewReport.pglite.mjs (3x, Supabase's default anon grant emulated).

-- 1. Removed by an admin after a report.
ALTER TABLE public.declutter_reviews ADD COLUMN IF NOT EXISTS removed_at timestamptz;

-- 2. The list from 20261101021934 plus 'declutter_review' (reported_id is the declutter_reviews id).
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reported_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text, 'application'::text, 'declutter_item'::text, 'declutter_wanted'::text, 'declutter_question'::text, 'declutter_answer'::text, 'declutter_review'::text]));

-- 3. The report keeps a copy of the review ("4 stars: <comment>"), as a question report does.
CREATE OR REPLACE FUNCTION public.report_message_party_and_copy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  m public.messages%ROWTYPE;
  w public.declutter_wanted%ROWTYPE;
  q public.declutter_questions%ROWTYPE;
  it public.declutter_items%ROWTYPE;
  dr public.declutter_reviews%ROWTYPE;
  dro public.declutter_orders%ROWTYPE;
BEGIN
  -- CHANGED (A3-75): a Declutter review. A member reports only a review they could be shown, by declutter_visible_reviews'
  -- rule (20261021023530, restated in this file): not removed, and the order was handed over 14+ days ago or both sides
  -- have reviewed (the blind rule: until then even its subject can't read it); a test account's review stays hidden
  -- from others under the seed switch. Anything else reads as not found (this runs as the definer, and the copy is
  -- readable by its reporter). Never your own words: the reviewer can't report their own review.
  IF NEW.reported_type = 'declutter_review' THEN
    SELECT * INTO dr FROM public.declutter_reviews WHERE id = NEW.reported_id;
    IF FOUND THEN
      SELECT * INTO dro FROM public.declutter_orders WHERE id = dr.order_id;
    END IF;
    IF dr.id IS NULL OR dro.id IS NULL
       OR (NOT public.is_server_context()
           AND (dr.removed_at IS NOT NULL
                OR NOT (dr.reviewer_id IS NOT DISTINCT FROM NEW.reporter_id
                        OR dro.handed_over_at <= now() - interval '14 days'
                        OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = dr.order_id) = 2)
                OR NOT (dr.reviewee_id IS NOT DISTINCT FROM NEW.reporter_id OR dr.is_seed IS NOT TRUE
                        OR NOT (SELECT public.seed_hidden_from_caller())))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM dr.reviewer_id THEN
      RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
    END IF;
    NEW.reported_content := left(concat_ws(': ', dr.stars || CASE WHEN dr.stars = 1 THEN ' star' ELSE ' stars' END,
                                           NULLIF(btrim(COALESCE(dr.comment, '')), '')), 4000);
    RETURN NEW;
  END IF;
  -- CHANGED (B48): a Declutter question or its answer. A member reports only one they could be shown (not removed, on
  -- an item they can read: the seller's own, a live or reserved one, or one they bought), restated from the questions
  -- row policy and the items read policy (20261030080020), since this runs as the definer. Anything else reads as not
  -- found: the copy is readable by its reporter and would otherwise read out a removed question. An answer report
  -- needs an answer. Never your own words: the asker can't report the question, the seller can't report the answer.
  IF NEW.reported_type IN ('declutter_question', 'declutter_answer') THEN
    SELECT * INTO q FROM public.declutter_questions WHERE id = NEW.reported_id;
    IF FOUND THEN
      SELECT * INTO it FROM public.declutter_items WHERE id = q.item_id;
    END IF;
    IF q.id IS NULL OR it.id IS NULL
       OR (NOT public.is_server_context()
           AND (q.removed_at IS NOT NULL
                OR NOT (it.seller_id = NEW.reporter_id
                        OR (it.status IN ('live', 'reserved') AND NOT it.seller_hidden
                            AND (NOT it.is_seed OR NOT (SELECT public.seed_hidden_in_discovery())))
                        OR EXISTS (SELECT 1 FROM public.declutter_cart_items c
                                    WHERE c.item_id = it.id AND c.buyer_id = NEW.reporter_id AND c.status = 'paid')))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF NEW.reported_type = 'declutter_answer' AND q.answer IS NULL THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.is_server_context()
       AND ((NEW.reported_type = 'declutter_question' AND NEW.reporter_id IS NOT DISTINCT FROM q.asker_id)
            OR (NEW.reported_type = 'declutter_answer' AND NEW.reporter_id IS NOT DISTINCT FROM it.seller_id)) THEN
      RAISE EXCEPTION 'report_own_content' USING ERRCODE = '42501';
    END IF;
    NEW.reported_content := left(concat_ws(E'\n', 'Question: ' || q.question, 'Answer: ' || q.answer), 4000);
    RETURN NEW;
  END IF;
  IF NEW.reported_type = 'declutter_wanted' THEN
    SELECT * INTO w FROM public.declutter_wanted WHERE id = NEW.reported_id;
    IF NOT FOUND
       OR (NOT public.is_server_context()
           AND (NOT w.public OR w.removed_at IS NOT NULL OR w.user_id = NEW.reporter_id
                OR (w.is_seed IS TRUE AND (SELECT public.seed_hidden_from_caller())))) THEN
      RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
    END IF;
    NEW.reported_content := left(w.what, 4000);
    RETURN NEW;
  END IF;
  IF NEW.reported_type IS DISTINCT FROM 'message' THEN
    NEW.reported_content := NULL;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM public.messages WHERE id = NEW.reported_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- L6: only someone in the conversation reports its message.
  IF NOT public.is_server_context()
     AND NEW.reporter_id IS DISTINCT FROM m.sender_id
     AND NEW.reporter_id IS DISTINCT FROM m.receiver_id THEN
    RAISE EXCEPTION 'report_not_allowed' USING ERRCODE = '42501';
  END IF;
  NEW.reported_content := left(concat_ws(E'\n',
    NULLIF(m.content, ''),
    CASE WHEN m.attachment_url IS NOT NULL THEN 'Attachment: ' || m.attachment_url END), 4000);
  RETURN NEW;
END;
$function$;

-- 4. Members stop seeing a removed review.
CREATE OR REPLACE FUNCTION public.declutter_visible_reviews(p_user_id uuid)
RETURNS TABLE (id uuid, reviewer_side text, stars smallint, comment text, created_at timestamptz, tags text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- No order id (lh-authz-rls review 2.5); a test account's review stays hidden under the seed switch (Q552).
  SELECT r.id, r.reviewer_side, r.stars, r.comment, r.created_at, r.tags
    FROM public.declutter_reviews r
    JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE r.reviewee_id = p_user_id
     AND r.removed_at IS NULL  -- A3-75: an admin removed it after a report
     AND (SELECT auth.uid()) IS NOT NULL
     AND (r.reviewer_id = (SELECT auth.uid())
          OR o.handed_over_at <= now() - interval '14 days'
          OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = r.order_id) = 2)
     AND (r.reviewee_id = (SELECT auth.uid()) OR r.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
   ORDER BY r.created_at DESC;
$fn$;

-- 5. A removed review leaves the public star rating.
CREATE OR REPLACE FUNCTION public.get_public_profile_stats(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, review_count integer, avg_rating numeric, poster_review_count integer, poster_avg_rating numeric, completed_jobs_as_helper integer, completed_jobs_total integer, posted_jobs_total integer, jobs_total integer, cancelled_jobs integer, cancellation_rate numeric, on_time_sample integer, on_time_rate numeric, revision_sample integer, revision_rate numeric, repeat_client_sample integer, repeat_hire_percent numeric, is_id_verified boolean, has_stripe_account boolean, is_background_checked boolean, has_pending_credentials boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT p.user_id, p.idv_status,
           p.stripe_account_id, p.background_check_status
    FROM public.profiles p
    WHERE (p.user_id = ANY(p_user_ids) OR p.id = ANY(p_user_ids))
      AND (
        -- Public gate, character-for-character the one get_safe_profiles uses.
        (
          p.email_verified
          AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
          -- Q552: the same seed clause get_safe_profiles carries.
          AND (p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
        )
        -- …or it is your own row. Your own preview must not lie to you while
        -- your email is unverified, which is the same reason the client keeps a
        -- self-select fallback next to get_safe_profiles.
        OR p.user_id = auth.uid()
      )
  ),
  -- Reviews this person RECEIVED that are genuinely public: published, past
  -- the anti-retaliation reveal, and not attached to a job that ended up
  -- cancelled. That last clause is the one the client used to express as
  -- `jobs!inner(status)` — a join through a table no visitor can read, which
  -- is why it silently returned zero reviews for everyone. It is a real guard,
  -- not a no-op: the status machine in 20260504152414 allows
  -- completed -> disputed -> cancelled, so an admin resolving a
  -- post-completion dispute for the poster leaves a live review on a cancelled
  -- job. Enforced here, where `jobs` is readable, instead of there.
  visible_reviews AS (
    SELECT t.user_id, r.rating, (j.customer_id = t.user_id) AS as_poster
    FROM target t
    JOIN public.reviews r ON r.reviewee_id = t.user_id
    JOIN public.jobs j ON j.id = r.job_id
    WHERE r.status = 'published'
      AND r.feedback_visible_at IS NOT NULL
      AND r.feedback_visible_at <= now()
      AND j.status <> 'cancelled'
      -- Test data never counts (b62; replaces Q552's switch-gated clause): not on a
      -- test job, not from or about a test account, for every caller, own stats too.
      AND j.is_seed IS NOT TRUE
      AND NOT public.is_test_member(r.reviewer_id)
      AND NOT public.is_test_member(r.reviewee_id)
    UNION ALL
    -- Declutter slice 4 (row 45, lead 2026-10-15): ONE star rating across job
    -- reviews and Declutter reviews. A Declutter review counts once it is
    -- public (both sides reviewed, or 14 days after the handover: the blind
    -- rule of declutter_visible_reviews); it is never a poster review.
    SELECT t.user_id, dr.stars::integer, false
    FROM target t
    JOIN public.declutter_reviews dr ON dr.reviewee_id = t.user_id
    JOIN public.declutter_orders o ON o.id = dr.order_id
    WHERE o.status = 'handed_over'
      AND (o.handed_over_at <= now() - interval '14 days'
           OR (SELECT count(*) FROM public.declutter_reviews d2 WHERE d2.order_id = dr.order_id) = 2)
      -- A3-75: a review an admin removed after a report never counts.
      AND dr.removed_at IS NULL
      -- Test data never counts (b62; replaces Q552's switch-gated clause).
      AND dr.is_seed IS NOT TRUE
      AND o.is_seed IS NOT TRUE
      AND NOT public.is_test_member(dr.reviewer_id)
      AND NOT public.is_test_member(dr.reviewee_id)
  ),
  review_agg AS (
    SELECT
      t.user_id,
      COUNT(v.rating)::integer AS review_count,
      ROUND(AVG(v.rating)::numeric, 2) AS avg_rating,
      COUNT(v.rating) FILTER (WHERE v.as_poster)::integer AS poster_review_count,
      ROUND(AVG(v.rating) FILTER (WHERE v.as_poster)::numeric, 2) AS poster_avg_rating
    FROM target t
    LEFT JOIN visible_reviews v ON v.user_id = t.user_id
    GROUP BY t.user_id
  ),
  -- Job counts. `jobs_total` / `cancelled_jobs` deliberately span BOTH sides
  -- of the marketplace, matching the combined denominator the profile card has
  -- always shown ("Cancelled · 3 of 12 jobs").
  job_agg AS (
    SELECT
      t.user_id,
      -- The Helpr side: the single Helpr, or (Q728) a crew member, who is joined
      -- below through the roster and is never the job's poster.
      COUNT(*) FILTER (WHERE j.customer_id IS DISTINCT FROM t.user_id AND j.status = 'completed')::integer AS completed_as_helper,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed')::integer AS completed_total,
      -- Owner 10-31 ("expired jobs I post must never be visible to other users"):
      -- an unfilled expired listing is not counted as posted or as a job either.
      -- A LEFT JOIN row with no job still counts in jobs_total as before (the
      -- expression is false for it, so NOT(...) keeps it).
      COUNT(*) FILTER (WHERE j.customer_id = t.user_id
        AND NOT (j.status = 'cancelled' AND j.helper_id IS NULL AND j.cancelled_by IS NULL AND COALESCE(j.cancellation_reason, '') LIKE 'Job listing expired%'))::integer AS posted_total,
      COUNT(*) FILTER (WHERE NOT (j.status = 'cancelled' AND j.helper_id IS NULL AND j.cancelled_by IS NULL AND COALESCE(j.cancellation_reason, '') LIKE 'Job listing expired%'))::integer AS jobs_total,
      -- Owner 10-31: a listing that expired with no Helpr (auto-expire-jobs'
      -- fixed reason) is NOT a cancellation, so it never counts here. cancelled_by
      -- IS NULL is the sweep's real marker: auto-expire-jobs never sets it and
      -- poster_cancel_job always does, so a poster who types that reason still counts.
      COUNT(*) FILTER (WHERE j.status = 'cancelled'
        AND NOT (j.helper_id IS NULL AND j.cancelled_by IS NULL AND COALESCE(j.cancellation_reason, '') LIKE 'Job listing expired%'))::integer AS cancelled_jobs
    FROM target t
    LEFT JOIN public.jobs j
      ON (j.customer_id = t.user_id OR j.helper_id = t.user_id
      -- Q728: a crew has no lead (Q407), so a crew member's jobs are found
      -- through the roster.
      OR (j.is_group_job IS TRUE AND EXISTS (
            SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id = t.user_id)))
      -- Test data never counts (b62). Inside the ON, so a member with no real
      -- jobs still gets their row.
      AND j.is_seed IS NOT TRUE
      AND NOT public.is_test_member(j.customer_id)
      AND NOT public.is_test_member(t.user_id)
    GROUP BY t.user_id
  ),
  -- Timing, over this person's ENTIRE completed helper history. The client
  -- version capped its sample at the 50 most recent rows purely because that
  -- was one page of a `select`; there is no reason to throw away the rest here.
  -- Q731(a), 2026-10-05: every completed job this person WORKED, the single
  -- Helpr's and (a crew has no lead, Q407) each crew job they were on, with
  -- the member's OWN arrival stamp from the roster. Timing and repeat-client
  -- both read this one set, so neither can drop crews again.
  worked AS (
    SELECT t.user_id, j.id AS job_id, j.customer_id, j.revision_count, j.helper_arrived_at,
           j.date_needed, j.start_time
    FROM target t
    JOIN public.jobs j ON j.helper_id = t.user_id AND j.status = 'completed'
      -- Test data never counts (b62).
      AND j.is_seed IS NOT TRUE AND NOT public.is_test_member(j.customer_id) AND NOT public.is_test_member(t.user_id)
    UNION ALL
    SELECT t.user_id, j.id, j.customer_id, j.revision_count, g.helper_arrived_at,
           j.date_needed, j.start_time
    FROM target t
    JOIN public.group_job_helpers g ON g.helper_id = t.user_id
    JOIN public.jobs j ON j.id = g.job_id AND j.is_group_job IS TRUE AND j.status = 'completed'
      AND j.is_seed IS NOT TRUE AND NOT public.is_test_member(j.customer_id) AND NOT public.is_test_member(t.user_id)
  ),
  -- Timing, over this person's ENTIRE completed helper history. The client
  -- version capped its sample at the 50 most recent rows purely because that
  -- was one page of a `select`; there is no reason to throw away the rest here.
  timing AS (
    SELECT
      w.user_id,
      w.revision_count,
      w.helper_arrived_at,
      -- date_needed + start_time are wall-clock LOUISIANA time, not UTC.
      ((w.date_needed::date + COALESCE(w.start_time::text, '00:00')::time)
        AT TIME ZONE 'America/Chicago') AS scheduled_at
    FROM worked w
  ),
  timing_agg AS (
    SELECT
      t.user_id,
      COUNT(ti.revision_count)::integer AS revision_sample,
      COUNT(*) FILTER (WHERE COALESCE(ti.revision_count, 0) > 0)::integer AS revised,
      COUNT(*) FILTER (WHERE ti.helper_arrived_at IS NOT NULL AND ti.scheduled_at IS NOT NULL)::integer AS on_time_sample,
      -- 10-minute grace, carried over verbatim: "on time" is a humane window,
      -- not a stopwatch.
      COUNT(*) FILTER (
        WHERE ti.helper_arrived_at IS NOT NULL
          AND ti.scheduled_at IS NOT NULL
          AND ti.helper_arrived_at <= ti.scheduled_at + interval '10 minutes'
      )::integer AS on_time_hits
    FROM target t
    LEFT JOIN timing ti ON ti.user_id = t.user_id
    GROUP BY t.user_id
  ),
  -- Repeat hire: share of this helper's distinct completed-job clients who
  -- came back. Same arithmetic as get_user_repeat_hire_percent (20260612470000),
  -- now with a sample size attached so the caller can refuse to publish it.
  repeat_clients AS (
    SELECT w.user_id, w.customer_id, COUNT(*) AS jobs_together
    FROM worked w
    WHERE w.customer_id IS NOT NULL
    GROUP BY w.user_id, w.customer_id
  ),
  repeat_agg AS (
    SELECT
      t.user_id,
      COUNT(rc.customer_id)::integer AS client_sample,
      COUNT(rc.customer_id) FILTER (WHERE rc.jobs_together > 1)::integer AS returning_clients
    FROM target t
    LEFT JOIN repeat_clients rc ON rc.user_id = t.user_id
    GROUP BY t.user_id
  ),
  cred_agg AS (
    SELECT t.user_id,
           EXISTS (
             SELECT 1 FROM public.helper_credentials hc
             WHERE hc.user_id = t.user_id AND hc.status = 'submitted'
           ) AS has_pending
    FROM target t
  )
  SELECT
    t.user_id,
    ra.review_count,
    -- NULL, never 0.0, when there is nothing to average. A zero average is a
    -- terrible review; "no reviews" is not.
    CASE WHEN ra.review_count > 0 THEN ra.avg_rating END,
    ra.poster_review_count,
    -- 3 poster reviews minimum — the floor the card already applied.
    CASE WHEN ra.poster_review_count >= 3 THEN ra.poster_avg_rating END,
    ja.completed_as_helper,
    ja.completed_total,
    ja.posted_total,
    ja.jobs_total,
    ja.cancelled_jobs,
    CASE WHEN ja.jobs_total >= 5
      THEN ROUND(100.0 * ja.cancelled_jobs / ja.jobs_total, 1) END,
    ta.on_time_sample,
    CASE WHEN ta.on_time_sample >= 5
      THEN ROUND(100.0 * ta.on_time_hits / ta.on_time_sample, 1) END,
    ta.revision_sample,
    CASE WHEN ta.revision_sample >= 5
      THEN ROUND(100.0 * ta.revised / ta.revision_sample, 1) END,
    rpa.client_sample,
    -- The 100%-from-one-client fix. 0% here is a genuine measurement across at
    -- least three clients and is published as such.
    CASE WHEN rpa.client_sample >= 3
      THEN ROUND(100.0 * rpa.returning_clients / rpa.client_sample) END,
    -- The "ID verified" BADGE (owner 2026-10-21): Stripe Identity only, the
    -- same expression get_safe_profiles.is_id_verified uses. A badge, not a gate.
    (t.idv_status IS NOT DISTINCT FROM 'verified'),
    (t.stripe_account_id IS NOT NULL),
    (t.background_check_status = 'verified'),
    ca.has_pending
  FROM target t
  JOIN review_agg ra ON ra.user_id = t.user_id
  JOIN job_agg    ja ON ja.user_id = t.user_id
  JOIN timing_agg ta ON ta.user_id = t.user_id
  JOIN repeat_agg rpa ON rpa.user_id = t.user_id
  JOIN cred_agg   ca ON ca.user_id = t.user_id;
$function$;

-- 6. The reporter's outcome notice names it "a review".
CREATE OR REPLACE FUNCTION public.notify_reporter_report_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_noun text;
  v_case text;
BEGIN
  BEGIN
    IF NEW.reporter_id IS NULL OR NEW.reported_type = 'support' THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.reporter_id)
       OR public.is_test_subject(NEW.reporter_id)
       OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.reporter_id AND p.is_seed IS TRUE) THEN
      RETURN NULL;
    END IF;
    -- Dismissed because the member or job is gone: no one reviewed it.
    IF NEW.status = 'dismissed' AND NEW.reported_id IS NOT NULL AND (
         -- The profile, not auth.users: account deletion removes the profile first and that delete is what
         -- dismisses the report, while the auth row may still exist inside the same transaction.
         (NEW.reported_type = 'user'
           AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.reported_id))
         OR (NEW.reported_type = 'job' AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.reported_id))
       ) THEN
      RETURN NULL;
    END IF;

    v_noun := CASE NEW.reported_type
      WHEN 'job' THEN 'a job'
      WHEN 'user' THEN 'a member'
      WHEN 'message' THEN 'a message'
      WHEN 'review' THEN 'a review'
      WHEN 'application' THEN 'an application'
      WHEN 'declutter_item' THEN 'a listing'
      WHEN 'declutter_wanted' THEN 'a Wanted post'
      WHEN 'declutter_question' THEN 'a question'
      WHEN 'declutter_answer' THEN 'an answer'
      WHEN 'declutter_review' THEN 'a review'
      ELSE 'a post'
    END;
    v_case := 'HLP-' || upper(left(replace(NEW.id::text, '-', ''), 8));

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      NEW.reporter_id,
      'We looked into your report',
      'Thanks for your report about ' || v_noun || ' (case ' || v_case || '). '
        || CASE WHEN NEW.status = 'resolved'
             THEN 'We looked into it and took action.'
             ELSE 'We looked into it and didn''t find a rule broken. If it keeps happening, report it again or contact support.'
           END,
      'system_alert',
      CASE WHEN NEW.status = 'resolved' THEN NULL ELSE '/support?topic=message' END
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES ('error', 'report outcome notice could not be sent',
            jsonb_build_object('source', 'notify_reporter_report_outcome'),
            jsonb_build_object('report_id', NEW.id::text, 'error', SQLERRM));
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.notify_reporter_report_outcome() FROM PUBLIC, anon, authenticated;

-- 7. An admin removes a reported review (members stop seeing it; it leaves the star rating). The report resolves and
--    the step is logged with the removed words. Not an admin who wrote the review or is its subject.
CREATE OR REPLACE FUNCTION public.declutter_admin_remove_review(p_review_id uuid, p_note text, p_report_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  r public.declutter_reviews%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.declutter_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND OR r.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'review_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r.reviewer_id = v_uid OR r.reviewee_id = v_uid THEN
    RAISE EXCEPTION 'own_review' USING ERRCODE = '42501';
  END IF;
  IF p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports rp
        WHERE rp.id = p_report_id AND rp.reported_type = 'declutter_review' AND rp.reported_id = p_review_id) THEN
    RAISE EXCEPTION 'report_not_for_review' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_reviews SET removed_at = now() WHERE id = p_review_id;
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved' WHERE id = p_report_id;
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_review_removed', 'declutter_review', p_review_id::text,
          jsonb_build_object('note', NULLIF(v_note, ''), 'report_id', p_report_id, 'order_id', r.order_id,
                             'stars', r.stars, 'comment', r.comment));
  RETURN 'removed';
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_remove_review(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_remove_review(uuid, text, uuid) TO authenticated, service_role;

-- 8. The reports queue's half: the reviews behind review reports, read as admin (members can't read the table).
--    is_seed (a test review or order, or a test reviewer or subject) lets the queue drop test data (owner rule).
CREATE OR REPLACE FUNCTION public.declutter_admin_reported_reviews(p_review_ids uuid[])
 RETURNS TABLE(review_id uuid, reviewer_id uuid, reviewee_id uuid, reviewer_side text, stars smallint, comment text,
               removed boolean, is_seed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.require_feature('declutter');
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.reviewer_id, r.reviewee_id, r.reviewer_side, r.stars, r.comment, r.removed_at IS NOT NULL,
           (COALESCE(r.is_seed, false) OR COALESCE(o.is_seed, false)
            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id IN (r.reviewer_id, r.reviewee_id) AND p.is_seed IS TRUE))
      FROM public.declutter_reviews r
      LEFT JOIN public.declutter_orders o ON o.id = r.order_id
     WHERE r.id = ANY (COALESCE(p_review_ids, ARRAY[]::uuid[]))
     LIMIT 500;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_reported_reviews(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_reported_reviews(uuid[]) TO authenticated, service_role;
