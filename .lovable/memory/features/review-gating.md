---
name: Review gating rules
description: All conditions a review insert must satisfy — enforced at DB level
type: feature
---

A review insert into `public.reviews` is allowed ONLY when all of the following are true (enforced by the `Users can create reviews for eligible jobs` RLS policy):

1. `auth.uid() = reviewer_id` (can't post on behalf of someone else)
2. Reviewer is the job's `customer_id` OR `helper_id`
3. Reviewee is the OTHER participant (poster reviews helpr, helpr reviews poster)
4. `jobs.status = 'completed'`
5. `jobs.payment_status = 'released'`
6. No open dispute (`dispute_status` IS NULL OR `dispute_status <> 'open'` OR `dispute_resolved_at` IS NOT NULL)
7. Within 30 days of completion (`COALESCE(poster_completed_at, helper_completed_at, updated_at) > now() - 30 days`)
8. Unique constraint `reviews_job_id_reviewer_id_key` blocks duplicates

UI buttons MUST mirror these gates — gate every "Review" button behind `payment_status === "released"` (status `"completed"` alone is not enough). Use the `can_review_job(job_id, reviewer_id)` RPC for centralized eligibility checks.

Suspicious reviews on low-budget ($<20) + fast-completed (<30 min) jobs are auto-flagged via the `flag_suspicious_review` trigger and appear in the AdminFraudDashboard.
