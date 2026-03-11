

# Fraud Prevention Enhancements for Helpr

## What's Already Solid
Your platform already has the core building blocks: dual-party completion, 72-hour auto-release, before/after photos, GPS check-ins, ID verification, reviews, reports with auto-bans, and admin approval. That puts you ahead of most early marketplaces.

## What to Add (Priority Order)

### 1. Dispute Job Button (High Priority)
Add a "Dispute" option on active/completed jobs for customers. When disputed:
- Customer selects a reason (work not done, poor quality, no-show, other)
- Optional photo evidence upload (reuse existing proof-photos bucket)
- Job status changes to `disputed`
- Payment stays held in Stripe (no capture/transfer)
- Admin gets notified for review
- Add `disputed` to the `job_status` enum and add `dispute_reason`, `dispute_evidence_urls`, `disputed_at`, `disputed_by` columns to jobs table

### 2. Minimum Job Time Before Completion (High Priority)
Block the "Complete" button until at least 30 minutes after the job was accepted/started. This prevents instant fake completions.
- Check `helper_confirmed_at` or job `start_time` vs current time in the `create-payment` edge function (server-side enforcement)
- Show a disabled button with countdown in the UI

### 3. Automatic Fraud Flags (Medium Priority)
Add a `fraud_flags` table to track suspicious activity:
- Job completed in under 15 minutes
- Multiple disputes on same helpr
- Completion without any GPS check-in
- Run checks in the `create-payment` function when marking complete
- Flag triggers admin notification + optional auto-suspension

### 4. New Helpr Job Limits (Medium Priority)
Limit new helprs to 3 active jobs until they've completed 3 jobs with 4+ star ratings.
- Add a check in the application/acceptance flow
- Query completed jobs count and average rating
- Enforce in both UI and backend

### 5. GPS Proximity Validation (Lower Priority)
When helpr marks "Arrived" or "Start Job", validate their GPS coordinates are within 500ft of the job address.
- Requires geocoding the job address (Google Maps or similar API)
- Compare against captured GPS coordinates
- Block status update if too far away

### 6. Payout Hold Period (Lower Priority)
After dual confirmation, delay the Stripe transfer by 24 hours instead of transferring immediately.
- Add `payout_scheduled_at` column to jobs
- Modify `create-payment` to schedule rather than transfer
- New edge function runs hourly to process scheduled payouts

## Database Changes
- Add `disputed` to `job_status` enum
- Add columns to `jobs`: `dispute_reason`, `dispute_evidence_urls`, `disputed_at`, `disputed_by`
- New `fraud_flags` table: `id`, `user_id`, `job_id`, `flag_type`, `details`, `resolved`, `created_at`

## Files to Create/Modify
- New: `src/components/DisputeDialog.tsx` — dispute form with reason + photo upload
- Edit: `src/pages/Activity.tsx` — add Dispute button alongside Complete/Revision
- Edit: `supabase/functions/create-payment/index.ts` — minimum time check, fraud flag checks, payout delay
- New: `supabase/functions/process-scheduled-payouts/index.ts` — delayed payout processor
- Edit: `src/pages/Admin.tsx` — dispute review queue
- Edit: `supabase/functions/auto-release-payment/index.ts` — skip disputed jobs

## Recommended Implementation Order
1. Dispute button + admin review (biggest gap right now)
2. Minimum job time enforcement (quick win, prevents obvious fraud)
3. Fraud flags (automated detection layer)
4. New helpr job limits (reduces exposure)
5. GPS proximity + payout delay (polish)

