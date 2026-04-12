

## Problem: Jobs stuck on "unpaid" despite successful Stripe payments

### Root Cause
The Stripe webhook (`stripe-webhook` edge function) is **not receiving events** from Stripe. The edge function logs show zero webhook calls. This means when a customer completes checkout on Stripe, the `checkout.session.completed` event never reaches your backend, so the job's `payment_status` stays "unpaid" and `stripe_payment_intent_id` stays null.

Specifically for "Help Zander": Stripe confirms payment intent `pi_3TLBZCKp2H4b7tEC0pAdFzsk` for $5.50 succeeded, but the job record was never updated.

### Plan

#### 1. Fix the immediate data — Patch unpaid jobs that were actually paid
- Query Stripe for all checkout sessions with job metadata
- Update the "Help Zander" job (and any others) with the correct `stripe_payment_intent_id` and `payment_status: 'escrow'`
- This is a one-time data fix via database migration

#### 2. Verify and fix Stripe webhook configuration
- Check whether the webhook endpoint `https://steigdwrpkosbiycshwz.supabase.co/functions/v1/stripe-webhook` is properly registered in Stripe
- Ensure the `STRIPE_WEBHOOK_SECRET` matches the configured endpoint
- Test the webhook by sending a test event

#### 3. Add a client-side fallback for checkout completion
- After Stripe redirects the user back to the success URL, call a new verification step that checks the checkout session status and updates the job if the webhook was missed
- This acts as a safety net so jobs are never stuck on "unpaid" even if a webhook is delayed or lost

#### 4. Add a polling fallback edge function
- Create a scheduled function that finds jobs with `payment_status = 'unpaid'` that have a `stripe_session_id`, checks their status with Stripe, and updates accordingly
- Prevents future "stuck unpaid" scenarios

### Technical Details

**Step 1** — Database migration to fix existing data:
```sql
UPDATE jobs SET stripe_payment_intent_id = 'pi_3TLBZCKp2H4b7tEC0pAdFzsk', payment_status = 'escrow'
WHERE id = '4061f951-eb84-49bd-ac43-5d25e3c2a0d7';
```

**Step 3** — In `PostJob.tsx` (or payment success page), after redirect from Stripe:
- Extract `session_id` from URL params
- Call an edge function to verify the session and update the job

**Step 4** — New `sync-unpaid-jobs` edge function that runs on a schedule, queries jobs with `payment_status = 'unpaid'` + non-null `stripe_session_id`, checks each session in Stripe, and updates payment status if paid.

