-- Fix: reporting a REVIEW has never been able to submit.
--
-- Exactly the same defect as 20260725141052_allow_support_reported_type.sql,
-- one value later. `src/components/ReportDialog.tsx` inserts into `reports`
-- with whatever `reportedType` its caller passes, and two live call sites pass
-- 'review':
--   * src/pages/userProfile/ReviewsSection.tsx  (reportedType="review")
--   * src/components/reviewPanel/ReviewList.tsx (reportedType="review")
-- but `reports_reported_type_check` only allows ('job','message','user',
-- 'support'). Every review report therefore fails with 23514 and the reporter
-- sees only the generic "We couldn't send your report — please try again."
-- toast; nothing is recorded anywhere, so the failure is invisible server-side
-- too.
--
-- The admin side already assumes these rows exist: 20260829085818's
-- `admin_delete_review` RPC is documented as the takedown path for "reports
-- with reported_type='review' [that] land in the AdminReports queue", and
-- AdminReports.tsx renders a Remove Review action for them. The queue was
-- built for a row the database refuses to accept.
--
-- Blast radius: none. Widening a CHECK cannot invalidate existing rows — every
-- currently-permitted value stays permitted.
--
-- REPLAY-SAFE: the DROP is IF EXISTS and the constraint is re-added under the
-- same name, so a from-scratch rebuild and an incremental deploy both end at
-- the same definition. No data rewrite.

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_reported_type_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text]));
