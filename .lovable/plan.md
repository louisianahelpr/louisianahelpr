

## Problem: Stripe Balance Shows $0

The payment intent for the completed test job was **never captured** — it still shows `requires_capture` in Stripe. The root cause is a chain of failures:

1. When the escrow checkout session is created, only `stripe_session_id` is saved on the job — **not** the `stripe_payment_intent_id`
2. When the job completes, `captureEscrowPayment` tries to retrieve the payment intent from the session but **silently fails** (logs confirm: "No payment intent found")
3. The Stripe webhook only handles subscription tier updates — it **ignores** escrow job payments entirely

So the payment is authorized but never captured, and Stripe balance stays at $0.

---

## Plan

### 1. Update Stripe webhook to store payment intent on escrow jobs
In `supabase/functions/stripe-webhook/index.ts`, add handling inside the `checkout.session.completed` case: when the session metadata contains a `job_id`, store `session.payment_intent` as `stripe_payment_intent_id` on the job record. This ensures the PI is always stored reliably.

### 2. Fix `captureEscrowPayment` to use `expand` parameter
In `supabase/functions/create-payment/index.ts`, update the session retrieval call to use `expand: ["payment_intent"]` so it reliably gets the PI even if the webhook hasn't fired yet. This is a safety net.

### 3. Fix the existing stuck job
Run a data update to set `stripe_payment_intent_id = 'pi_3TDuQyKp2H4b7tEC1L7jGZj1'` on job `7cbe65e1-...` and then manually trigger the `process-scheduled-payouts` function to capture and transfer the payment.

### 4. Redeploy affected edge functions
- `stripe-webhook`
- `create-payment`

---

### Technical Details

**Webhook change** (stripe-webhook/index.ts): Inside `checkout.session.completed`, after the existing tier logic, add:
```typescript
// Store payment intent for escrow jobs
const jobId = (session.metadata as any)?.job_id;
if (jobId && session.payment_intent) {
  await supabase.from("jobs").update({
    stripe_payment_intent_id: session.payment_intent as string,
  }).eq("id", jobId);
}
```

**captureEscrowPayment fix**: Change `stripe.checkout.sessions.retrieve(job.stripe_session_id)` to include expand parameter to reliably get the payment_intent string.

