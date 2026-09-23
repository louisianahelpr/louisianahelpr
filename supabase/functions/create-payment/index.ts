// seed-policy: pages for seed/E2E jobs too, on purpose. Every alert here is money
// that moved (or failed to move) in Stripe while the DB says otherwise, or a Stripe
// event that could not be settled: a platform failure whoever owns the job. The
// nightly money journeys on seed jobs are how this path is proven, so their failures
// are real signal (2026-09-22: "transfer failed" on seed jobs = the empty test
// balance, Q3). Seed-only noise is routed in the detectors, not here (docs/OPEN.md Q2).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getHelperFeePercent, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { stripeProcessingCostCents, actualOrEstimatedFeeCents, netUrgentFeeDollars } from "../_shared/stripeFees.ts";
import { posterFeePercentForTier, posterServiceFeeCents } from "../_shared/posterFees.ts";
import { isLaborTaxable } from "../_shared/salesTax.ts";
import { loadAdminIds } from "../_shared/adminIds.ts";
import { getAppUrl, buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { formatPayoutDollars } from "../_shared/money.ts";
import { arrivalEstablished, arrivalGateMessage } from "../_shared/arrivalRule.ts";
import { checkUnsettledDispute } from "../_shared/unsettledDispute.ts";
import { PublicError, publicErrorMessage } from "../_shared/publicError.ts";
import { jobBudgetOutOfRange, MAX_JOB_BUDGET_DOLLARS, MIN_JOB_BUDGET_DOLLARS, MAX_URGENT_FEE_DOLLARS } from "../_shared/jobBudgetLimits.ts";
import { threeDSecureOptions } from "../_shared/threeDSecure.ts";
import { standardPayoutAtIso, STANDARD_PAYOUT_PHRASE } from "../_shared/escrowTiming.ts";

/**
 * Tax is ADDED to `unit_amount`, never carved out of it — pinned rather than
 * inherited from the Stripe account's default tax behavior.
 *
 * This matters twice. The Post-a-Task summary quotes budget + service fee and
 * then "+ tax", so "inclusive" would charge the poster a total that doesn't
 * match what they were shown. And escrow derives the helper's payout from the
 * BUDGET line, so an inclusive labor line would quietly carve LA sales tax out
 * of the helper's earnings on assembly jobs — the one category where tax is
 * non-zero. Left unset, either outcome is one dashboard toggle away.
 */
const TAX_BEHAVIOR = "exclusive" as const;

/**
 * NOTIFICATION LINKS: `?job=<id>`, never a fixed `?filter=`.
 *
 * Every Activity notification this function writes carries the job id and lets
 * the page resolve the bucket at OPEN time (the deep-link effect in
 * src/pages/Activity.tsx). A fixed `?filter=` can never be right from the
 * producer side, for two independent reasons:
 *
 *  - The bucket a job belongs to is a question about its LIVE state ("whose
 *    move is it?"), and the answer changes while the notification sits unread.
 *    A job linked as `?filter=scheduled` is in "Needs you" the moment its day
 *    passes; one linked `?filter=cancelled` moves out of that bucket if a
 *    later direct offer revives the helper's application.
 *  - Most of the keys these links used are LEGACY: the chip strip is five
 *    buckets (needs_you / scheduled / waiting / done / cancelled,
 *    activityFilters.ts). `in_progress`, `completed`, `revision`,
 *    `not_selected`, `offered`, `open` still work as filter VALUES but have no
 *    chip, so the reader landed on a filtered list with nothing showing as
 *    selected and no way to tell what they were looking at. 66 rows in prod
 *    `notifications` are sitting on exactly that (measured 2026-08-31).
 *
 * And an explicit `?filter=` WINS over `?job=` resolution (`deepLinkHadFilter`
 * in Activity.tsx), so a stale filter actively defeats the fix — passing both
 * is worse than passing neither. Same rule, same reasons, as migration
 * 20260831232514_notification_links_land_on_the_right_spot.sql.
 */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Throttle abuse: 10 payment-creation attempts per IP per minute. The real
  // Stripe-side throttle is generous, but every call hits stripe.customers.list
  // and (often) stripe.customers.create, which costs us money + adds latency
  // for legit users if a script floods it.
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 10,
    keyPrefix: "create-payment",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
  );

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data, error: userErr } = await supabaseClient.auth.getUser(token);
    if (userErr) console.error("[create-payment] auth.getUser error:", userErr.message);
    const user = data.user;
    if (!user?.email) throw new PublicError("Not authenticated");

    const body = await req.json();
    const isNative = isNativeRequest(body);
    const { action } = body;

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Get or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      // Fetch user's profile name for the Stripe customer record
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .single();
      const newCustomer = await stripe.customers.create({
        email: user.email,
        name: profile?.full_name || user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = newCustomer.id;
    }

    // ─── ESCROW: Create checkout with manual capture ───
    if (action === "escrow") {
      const { jobId, saveCardForFuture, giftCardId } = body;
      if (!jobId) throw new PublicError("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");
      if (job.customer_id !== user.id) throw new PublicError("Not authorized");

      // ─── Re-mint gate: which payment_status may open a NEW checkout ───
      //
      // This used to be `job.stripe_session_id && payment_status !== "unpaid"`,
      // which refused every state that keeps a session id after the money did
      // NOT land — and both of them do:
      //   • 'abandoned' — void-cancelled-payments' Part B sweep marks an
      //     unpaid-at-Stripe checkout abandoned WITHOUT clearing
      //     stripe_session_id.
      //   • 'failed' — stripe-webhook's payment_intent.payment_failed stamps
      //     it on a job that is still unpaid (declined card), session id intact.
      // Those are exactly the two states UnfundedJobNotice offers "Finish
      // paying" for, so its one CTA 500'd forever — with a message naming a
      // "cancel the existing payment" control that does not exist anywhere in
      // the product. Reproduced live against prod job
      // b732b37d-20e7-4685-abba-50d8602fe6b1 ('abandoned', cs_test_b1V0Ji…).
      //
      // The gate is now the payment_status VOCABULARY (jobs_payment_status_check:
      // unpaid, escrow, payout_pending, released, refunded, cancelled,
      // abandoned, failed, chargeback, cancelling) rather than the presence of
      // a session id — a session id is evidence a checkout was opened, never
      // evidence money landed, and the seven other states all mean money moved
      // or the job is settled. Null is treated as 'unpaid' (the pre-checkout
      // default), matching the old guard's `&& job.payment_status`.
      const RE_MINTABLE_PAYMENT_STATUSES = new Set(["unpaid", "abandoned", "failed"]);
      const currentPaymentStatus = job.payment_status ?? "unpaid";
      if (!RE_MINTABLE_PAYMENT_STATUSES.has(currentPaymentStatus)) {
        throw new PublicError("This job's payment has already been processed. Open the job to see its payment status.");
      }

      // ─── Price cap, enforced where the money is taken (Q202) ───
      // The DB CHECK (jobs_budget_range) and validate_job_budget() refuse a new
      // or edited budget outside the range, but rows stored before a cap change
      // are not re-checked until their budget is written. This is the charge-time
      // twin: no checkout is opened for a budget outside the shared limits
      // (_shared/jobBudgetLimits.ts, the one constant client + server + DB share).
      if (jobBudgetOutOfRange(job.budget)) {
        throw new PublicError(
          `Job budgets run from $${MIN_JOB_BUDGET_DOLLARS.toLocaleString("en-US")} to $${MAX_JOB_BUDGET_DOLLARS.toLocaleString("en-US")}. Edit the budget, or split a bigger project into separate jobs.`,
        );
      }

      // ─── Retire the previous Checkout Session before minting another ───
      //
      // Two live sessions on one job is the double-funding shape, so the old
      // one must be gone (or provably dead) before a new one exists.
      //
      // The Stripe read is also the LAST word on whether money is in flight:
      // payment_status above is our copy, and a webhook that has not landed
      // yet (or was stamped 'failed' by an out-of-order event) makes it stale
      // in exactly the direction that would let a poster pay twice. If Stripe
      // says this session is complete/paid, or its PaymentIntent is anywhere
      // past `requires_payment_method`, we refuse and let the webhook settle it.
      const previousSessionId: string | null = job.stripe_session_id ?? null;
      if (previousSessionId) {
        const prior = await stripe.checkout.sessions.retrieve(previousSessionId, {
          expand: ["payment_intent"],
        });
        const priorPi = prior.payment_intent as Stripe.PaymentIntent | null;
        // `requires_action` on a still-OPEN session is a 3D Secure challenge the
        // poster walked away from (Q202 requests 3DS from $300): no money has
        // moved, and expiring the open session below cancels that
        // PaymentIntent. Treating it as live stranded "Finish paying" for up to
        // 24h (the session's own expiry) on exactly the large charges 3DS is for.
        const abandonedChallenge = prior.status === "open" && priorPi?.status === "requires_action";
        const priorPiLive = !!priorPi && !abandonedChallenge &&
          !["requires_payment_method", "canceled"].includes(priorPi.status);
        if (prior.status === "complete" || prior.payment_status === "paid" || priorPiLive) {
          console.error(
            `[create-payment] refusing re-mint for job ${jobId}: prior session ${previousSessionId} is live (status=${prior.status}, payment_status=${prior.payment_status}, pi=${priorPi?.id ?? "none"}/${priorPi?.status ?? "none"}) while jobs.payment_status='${currentPaymentStatus}'`,
          );
          throw new PublicError("A payment for this job is still being processed. Give it a moment and refresh before trying again.");
        }
        if (prior.status === "open") {
          // Expire rather than leave it: an abandoned-but-open session stays
          // payable, and the poster may still have that tab.
          //
          // `expire` is NOT idempotent — a second call raises "Only Checkout
          // Sessions with a status in [open] can be expired". The Checkout
          // Session CREATE below is deduped by its idempotency key, so a
          // double-tap survives that, but nothing dedupes this call: measured
          // 2026-09-07 with two concurrent "Finish paying" taps, the winner
          // got 200 + a session and the loser got a 500 carrying Stripe's raw
          // error — reintroducing the exact dead end this fix removes, one race
          // narrower. Re-read instead of trusting the error text: if the
          // session has left `open`, someone else retired it and that is the
          // outcome we wanted.
          try {
            await stripe.checkout.sessions.expire(previousSessionId);
          } catch (expireErr) {
            const recheck = await stripe.checkout.sessions.retrieve(previousSessionId);
            if (recheck.status === "open") throw expireErr;
            if (recheck.status === "complete" || recheck.payment_status === "paid") {
              // It was paid out from under us between the two reads. Never mint
              // a second checkout on top of a real charge.
              console.error(`[create-payment] prior session ${previousSessionId} completed mid-re-mint for job ${jobId}`);
              throw new PublicError("A payment for this job is still being processed. Give it a moment and refresh before trying again.");
            }
            console.log(`[create-payment] prior session ${previousSessionId} was already retired by a concurrent re-mint (status=${recheck.status})`);
          }
          // An abandoned 3D Secure challenge: do not rely on the expiry alone to
          // cancel its PaymentIntent. Cancel it explicitly; if it can no longer
          // be canceled, the challenge was completed meanwhile, so refuse
          // rather than open a second payable checkout (money-escrow review
          // 2026-09-23).
          if (abandonedChallenge && priorPi) {
            try {
              await stripe.paymentIntents.cancel(priorPi.id);
            } catch (cancelErr) {
              const again = await stripe.paymentIntents.retrieve(priorPi.id);
              if (again.status !== "canceled") {
                console.error(`[create-payment] abandoned-challenge PI ${priorPi.id} could not be canceled (status=${again.status}) for job ${jobId}:`, cancelErr);
                throw new PublicError("A payment for this job is still being processed. Give it a moment and refresh before trying again.");
              }
            }
          }
        }
      }

      /**
       * Idempotency key suffix — why the key cannot be `escrow-${jobId}` alone.
       *
       * That key is what makes a double-tap safe: two rapid requests get the
       * SAME Checkout Session instead of two escrow charges. But Stripe keeps
       * a key for 24h and replays the ORIGINAL response, so a poster retrying
       * a genuinely dead checkout inside that window would be handed back the
       * session we just expired — a `url` that leads nowhere, i.e. the same
       * dead end this fix exists to remove, wearing a 200.
       *
       * Keying on the session being REPLACED keeps both properties: concurrent
       * taps read the same `previousSessionId` and therefore share a key, while
       * a later retry reads the session id we are about to write and gets a
       * fresh one. A job that never had a session keeps the original key
       * exactly as before.
       */
      const remintKeySuffix = previousSessionId ? `-after-${previousSessionId}` : "";

      /**
       * Record a newly-minted session on the job, tolerating the double-tap.
       *
       * The write is guarded on the session id we READ, so a concurrent request
       * that already re-stamped the job cannot be clobbered. A zero-row match
       * is therefore ambiguous — it means either that race or a genuinely lost
       * write — so re-read and treat "the job already carries this session" as
       * success. Under Stripe's idempotency key both callers hold the same
       * session id, so this is the normal double-tap outcome, not an error.
       *
       * `payment_status` returns to 'unpaid' because that is the money-in-flight
       * state every downstream sweep keys on: checkout.session.expired only
       * clears a session hold `.eq("payment_status","unpaid")`, void-cancelled-
       * payments' abandoned sweep only selects 'unpaid', and payment_failed only
       * stamps over null-or-'unpaid'. Leaving it 'abandoned'/'failed' would mint
       * a live checkout that none of those three can ever clean up again.
       *
       * The write is ALSO guarded on the re-mintable payment_status set read
       * above (race-class audit 2026-09-14). The session-id guard cannot see
       * the one funding path that leaves stripe_session_id alone:
       * redeem_gift_card locks the job, checks 'unpaid' and flips it to
       * 'escrow' without touching the session column. A gift tap racing a card
       * tap on the same job let this stamp write that funded job back to
       * 'unpaid' with a live Checkout URL on it — pay that and the job is
       * funded twice. Zero rows then falls to the re-check below, which does
       * not find our session and fails the request before a URL is returned.
       */
      const stampSession = async (newSessionId: string, extra: Record<string, unknown>) => {
        let q = supabaseAdmin
          .from("jobs")
          .update({ stripe_session_id: newSessionId, payment_status: "unpaid", ...extra })
          .eq("id", jobId)
          .or("payment_status.is.null,payment_status.in.(unpaid,abandoned,failed)");
        q = previousSessionId
          ? q.eq("stripe_session_id", previousSessionId)
          : q.is("stripe_session_id", null);
        const { data: updated, error: updateErr } = await q.select("id");
        if (updateErr) return { ok: false as const, reason: updateErr.message };
        if (updated && updated.length > 0) return { ok: true as const };
        const { data: recheck } = await supabaseAdmin
          .from("jobs").select("stripe_session_id").eq("id", jobId).maybeSingle();
        if (recheck?.stripe_session_id === newSessionId) return { ok: true as const };
        return { ok: false as const, reason: `matched 0 rows; job now holds ${recheck?.stripe_session_id ?? "null"}` };
      };

      // ─── Gift card redemption ───
      // A recipient redeeming a directed gift funds the job from the
      // prepaid donation (already captured into the platform balance at
      // donate time), so the recipient is charged $0 when the gift covers
      // the budget — and only the shortfall via Stripe when it doesn't.
      // The atomic RPC validates ownership + funding + expiry and moves
      // the money server-side; the client is never trusted with any of it.
      // A gift-card job carries NO recipient service fee, so this short-circuits
      // before the tier/fee/tax pricing below.
      if (giftCardId) {
        const { data: redeem, error: redeemErr } = await supabaseAdmin.rpc("redeem_gift_card", {
          p_credit_id: giftCardId,
          p_job_id: jobId,
          p_user_id: user.id,
        });
        if (redeemErr) {
          console.error(`[create-payment] redeem_gift_card failed for credit ${giftCardId}, job ${jobId}:`, redeemErr);
          throw new PublicError(
            // A RAISE from our own redeem RPC (P0001) is a sentence we wrote; any
            // other code is raw PostgREST/Postgres detail and must not reach the caller.
            (redeemErr as { code?: string }).code === "P0001" && redeemErr.message
              ? redeemErr.message
              : "Could not redeem this gift — please try again",
          );
        }

        if (redeem?.outcome === "settled") {
          // Gift fully covered the budget — job is funded, nothing to charge.
          return new Response(JSON.stringify({ url: buildRedirectUrl(`/payment-success?job_id=${jobId}`, isNative) }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
          });
        }

        // Partial: the gift is reserved against the job; collect only the
        // shortfall. No service fee on a gift-card job. The difference session's
        // webhook (metadata.gift_card_id) consumes the reservation + funds
        // the job. Retry is safe: the RPC re-entry returns the same
        // difference and Stripe dedupes on the per-job idempotency key.
        const differenceCents = Number(redeem?.difference_cents ?? 0);
        if (!Number.isFinite(differenceCents) || differenceCents <= 0) {
          throw new PublicError("Could not determine the remaining balance for this gift — please try again");
        }
        const diffSession = await stripe.checkout.sessions.create({
          customer: customerId,
          customer_update: { address: "auto" },
          line_items: [{
            price_data: {
              currency: "usd",
              tax_behavior: TAX_BEHAVIOR,
              product_data: {
                name: `Helpr Job: ${job.title}`,
                description: "Remaining balance after applying your gift card. Funds release once both parties confirm completion.",
                tax_code: "txcd_00000000",
              },
              unit_amount: differenceCents,
            },
            quantity: 1,
          }],
          mode: "payment",
          automatic_tax: { enabled: true },
          // 3D Secure from $300 (Q202): the hosted page runs the challenge.
          payment_method_options: threeDSecureOptions(differenceCents),
          payment_intent_data: {
            metadata: { job_id: jobId, customer_id: user.id, gift_card_id: giftCardId },
          },
          success_url: buildRedirectUrl(`/payment-success?job_id=${jobId}`, isNative),
          // Carry the credit back with them. A bare `/post-job` cancel_url
          // dropped the `gift_card` query param that PostJob reads
          // (usePostJobForm: searchParams.get("gift_card")), so a recipient
          // who backed out of the shortfall checkout landed on a plain
          // post-a-task form — and their next submit created a SECOND job at
          // FULL price while the gift sat 'reserved' against the abandoned
          // one, unusable on anything else until the session expired.
          cancel_url: buildRedirectUrl(`/post-job?gift_card=${encodeURIComponent(giftCardId)}`, isNative),
          metadata: { job_id: jobId, customer_id: user.id, gift_card_id: giftCardId },
        }, {
          idempotencyKey: `gift-card-diff-${jobId}${remintKeySuffix}`,
        });

        // Record the session on the job, exactly as the full-escrow path below
        // does. Two things depend on it and BOTH were blind on this branch:
        // the double-payment guard at the top of this action (which requires a
        // stripe_session_id before it will refuse a second checkout, so an
        // already-gift-card-funded job could be charged again at full price), and
        // void-cancelled-payments' abandoned-checkout sweep (Part B selects on
        // `.not("stripe_session_id","is",null)`) — without it an abandoned gift card
        // shortfall left the job open+unpaid forever, permanently consuming one
        // of the poster's open-job slots in enforce_open_job_limit.
        // .select("id") because a zero-row match returns error === null.
        const diffStamp = await stampSession(diffSession.id, {});
        if (!diffStamp.ok) {
          console.error(`[create-payment] gift card difference session ${diffSession.id} created for job ${jobId} but jobs.update failed:`, diffStamp.reason);
          // Safe to fail loudly: the credit is still 'reserved' against THIS
          // job, and redeem_gift_card treats re-entry for the same job as a
          // retry, so the user can simply try again.
          throw new PublicError("Could not record the payment session — please try again");
        }

        return new Response(JSON.stringify({ url: diffSession.url }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
        });
      }

      // Fail LOUD if platform_settings can't be read — a silent default
      // here misprices every escrow created during a config outage.
      const { data: settings, error: settingsErr } = await supabaseAdmin
        .from("platform_settings")
        // platform_fee_percent is deliberately NOT selected: nothing below
        // binds it, and the stored value (15) matches no rate in the tier
        // ladder, so reading it here only invites someone to start trusting it.
        // The poster-side rate comes from the poster's own tier below.
        .select("customer_fee_percent, helper_fee_percent, onboarding_fee_cents")
        .limit(1).single();
      if (settingsErr || settings?.customer_fee_percent == null || settings?.helper_fee_percent == null) {
        console.error(`[create-payment] platform_settings read failed — refusing to price escrow with default fees:`, settingsErr);
        throw new PublicError("Pricing configuration is temporarily unavailable — please try again in a moment");
      }
      // customer_fee_percent is READ but deliberately NOT BOUND. It is still
      // selected and null-checked above because an unreadable/incomplete
      // settings row means the pricing config is broken and this function must
      // fail loud rather than price escrow on guesses — but its VALUE no longer
      // reaches any charge (see the fee fallback below for why).
      const helperFeePercent = settings.helper_fee_percent;
      const onboardingFeeCents = settings.onboarding_fee_cents; // NOT NULL DEFAULT 200 in schema

      // Check if the poster owes the one-time onboarding fee (first job post) and
      // resolve their OWN subscription tier so the service fee follows the
      // 12/11/10/9/8 ladder — one user, one tier, one percent, whichever side of
      // the job they are on.
      // If that read fails, the fee falls back to the FREE-tier rate — see the
      // fallback expression below for why it is not the global setting.
      const { data: posterProfile, error: posterProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("onboarding_fee_paid, subscription_tier, subscription_expires_at")
        .eq("user_id", user.id)
        .single();
      if (posterProfileErr) {
        // Don't fail the charge — fall back to the free-tier rate — but make the
        // failure findable, never silent. Critically, only bill the one-time
        // onboarding fee when we can PROVE it's unpaid: a read failure leaves
        // posterProfile null, so guarding on `!!posterProfile` prevents
        // re-charging onboarding to someone who already paid it.
        console.error(`[create-payment] poster profile read failed — using the free-tier fee fallback, skipping onboarding charge:`, posterProfileErr);
      }
      const owesOnboardingFee = !!posterProfile && !posterProfile.onboarding_fee_paid && onboardingFeeCents > 0;
      // FALLBACK = DEFAULT_TIER_FEE_PERCENT (the free rate), never
      // `platform_settings.customer_fee_percent` and never a bare literal.
      //
      // This used to be `globalCustomerFeePercent`. The stored global is 10 and
      // the free ladder rung is 12, so an unreadable poster profile quietly
      // billed a free-tier poster 10% — two points of budget under their real
      // rate, on the ONE path where the number is charged to a card. The helper
      // side had the identical bug on its payout fallbacks and was fixed the
      // same way; this is its charge-side twin, and it matters more, because a
      // payout re-resolves the rate later (process-scheduled-payouts) while a
      // capture does not: the shortfall is never clawed back.
      //
      // Direction is the whole argument. An unexpected value must never
      // UNDER-charge the platform — over-charging a discounted poster is
      // refundable, a discount already given is not recoverable — and
      // DEFAULT_TIER_FEE_PERCENT is deliberately the free (highest) rung, so it
      // is the safe end of the ladder in both roles.
      //
      // Deriving it from DEFAULT_TIER_FEE_PERCENT rather than writing 12 keeps
      // this pinned to the ladder: retune TIER_FEE_PERCENT.free and both the
      // poster and helper fallbacks move with it, automatically and together.
      const customerFeePercent = posterProfile
        ? posterFeePercentForTier(posterProfile.subscription_tier, posterProfile.subscription_expires_at)
        : DEFAULT_TIER_FEE_PERCENT;

      // Customer service fee (added as a line item — taxable, platform revenue).
      // Floored at Stripe's real processing cost on the WHOLE transaction (budget
      // + fee + urgent tip + onboarding) so a tiny job can never leave the
      // platform underwater on Stripe fees.
      // SERVER-AUTHORITATIVE URGENT FEE — never trust jobs.urgent_fee.
      //
      // is_urgent / urgent_fee are client-set at INSERT and the jobs INSERT
      // column-lock trigger (enforce_jobs_insert_column_lock) deliberately
      // leaves them writable, so a poster can POST /rest/v1/jobs directly with
      // is_urgent=true and urgent_fee=NULL/0 and reach the urgent notification
      // fan-out for free — silent. (HISTORICAL: instant-job-match keyed off
      // is_urgent alone when this was written. Verified 2026-09-22 against
      // DEPLOYED v73: it now requires payment_status IN
      // ('escrow','payout_pending','released') BEFORE it reads urgency, and
      // returns {notified: 0, skipped: 'job_not_matchable'} on an unfunded
      // job. Four independent gates verified live that day — this comment is
      // kept for the reasoning, not as a current description.)
      // hole H-001. The jobs_urgent_fee_required constraint
      // (20260915055413) now rejects that at INSERT; this recompute is the
      // defence-in-depth twin at charge time and the authority for rows already
      // stored: an urgent job is charged the stored fee but never below the
      // floor, a non-urgent job is never charged an urgent tip regardless of
      // what the column holds. Floor/ceiling mirror URGENT_FEE_FLOOR_DOLLARS
      // ($5) and MAX_URGENT_FEE_DOLLARS (the budget ceiling, $1,000 since Q202)
      // in _shared/jobBudgetLimits.ts, which src/lib/moneyLimits.ts re-exports.
      const URGENT_FEE_FLOOR_CENTS = 500;
      const URGENT_FEE_CEILING_CENTS = MAX_URGENT_FEE_DOLLARS * 100;
      const storedUrgentFeeCents = Math.round((job.urgent_fee ?? 0) * 100);
      const urgentFeeCents = job.is_urgent
        ? Math.min(
            Math.max(storedUrgentFeeCents, URGENT_FEE_FLOOR_CENTS),
            URGENT_FEE_CEILING_CENTS,
          )
        : 0;
      const onboardingChargeCents = owesOnboardingFee ? onboardingFeeCents : 0;
      const customerFeeCents = posterServiceFeeCents(
        Math.round(job.budget * 100),
        customerFeePercent,
        urgentFeeCents + onboardingChargeCents,
      );
      const customerFeeAmount = customerFeeCents / 100;
      // Helper commission is deducted at payout time, not charged to poster
      const helperFeeAmount = (job.budget * helperFeePercent) / 100;

      // ─── Louisiana sales-tax classification ───
      // The category list now lives in `_shared/salesTax.ts` so the Post-a-Task
      // checkout screen quotes tax off the SAME rule this charge uses. It used
      // to be an inline Set here while the screen guessed "about 9-11% of
      // everything", which overstated the total by ~10% on every exempt
      // category — i.e. nearly every job. See that module for the LA R.S.
      // 47:301(14) reasoning.
      const laborTaxable = isLaborTaxable(job.category);

      const lineItems: any[] = [
        {
          price_data: {
            currency: "usd",
            tax_behavior: TAX_BEHAVIOR,
            product_data: {
              name: `Helpr Job: ${job.title}`,
              description: laborTaxable
                ? `Secure escrow payment for taxable labor (${job.category}). Funds release once both parties confirm completion.`
                : `Secure escrow payment for exempt service (${job.category}). Funds release once both parties confirm completion.`,
              // Assembly/installation of tangible personal property: LA repair/install code.
              // All other categories: pass-through (no LA state tax on the labor).
              tax_code: laborTaxable ? "txcd_20030000" : "txcd_00000000",
            },
            unit_amount: Math.round(job.budget * 100),
          },
          quantity: 1,
        },
      ];

      // Poster service fee — treated as a non-taxable platform commission
      // until LA Dept. of Revenue clarifies B2C SaaS treatment post-Act 470.
      // (Switch tax_code to "txcd_10103001" if a CPA confirms it should be
      // taxed as a digital service.)
      if (customerFeeAmount > 0) {
        lineItems.push({
          price_data: {
            currency: "usd",
            tax_behavior: TAX_BEHAVIOR,
            product_data: {
              name: "Service fee",
              description: `${customerFeePercent}% platform service fee`,
              tax_code: "txcd_00000000", // Non-taxable until LDR clarifies
            },
            unit_amount: customerFeeCents,
          },
          quantity: 1,
        });
      }

      // Urgent tip — non-taxable (passes through to helper). Uses the
      // server-recomputed urgentFeeCents (see above), never the stored column:
      // present and >= the floor whenever the job is urgent, absent otherwise.
      if (urgentFeeCents > 0) {
        lineItems.push({
          price_data: {
            currency: "usd",
            tax_behavior: TAX_BEHAVIOR,
            product_data: {
              name: "Urgent tip",
              description: "Urgent tip — goes directly to the helpr",
              tax_code: "txcd_00000000", // Non-taxable: passes through to helper
            },
            unit_amount: urgentFeeCents,
          },
          quantity: 1,
        });
      }

      // One-time onboarding fee — first job post only. Treated as a non-taxable
      // platform setup fee (matching the service-fee treatment above).
      if (owesOnboardingFee) {
        lineItems.push({
          price_data: {
            currency: "usd",
            tax_behavior: TAX_BEHAVIOR,
            product_data: {
              name: "One-time account setup",
              description: "One-time identity verification & account setup fee. Charged once per account.",
              tax_code: "txcd_00000000",
            },
            unit_amount: onboardingFeeCents,
          },
          quantity: 1,
        });
      }

      // When the poster opts in to "Save card for next time", ask Stripe
      // to save the card via off_session setup_future_usage on the
      // resulting PaymentIntent. Doesn't change the user flow — Stripe
      // shows a tiny "Save my info" disclosure inside Checkout — but lets
      // them one-tap the next post via a saved card.
      const paymentIntentExtras: Record<string, any> = {
        metadata: {
          job_id: jobId,
          customer_id: user.id,
          customer_fee_percent: String(customerFeePercent),
          helper_fee_percent: String(helperFeePercent),
          onboarding_fee_charged: owesOnboardingFee ? "true" : "false",
        },
      };
      if (saveCardForFuture === true) {
        paymentIntentExtras.setup_future_usage = "off_session";
      }
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_update: { address: 'auto' },
        line_items: lineItems,
        mode: "payment",
        automatic_tax: { enabled: true },
        // 3D Secure from $300 (Q202), on the pre-tax total of the line items
        // (tax is only known once Checkout has the address; it can only add).
        payment_method_options: threeDSecureOptions(
          lineItems.reduce((sum: number, li: any) => sum + Number(li?.price_data?.unit_amount ?? 0) * Number(li?.quantity ?? 1), 0),
        ),
        payment_intent_data: paymentIntentExtras,
        success_url: buildRedirectUrl(`/payment-success?job_id=${jobId}`, isNative),
        cancel_url: buildRedirectUrl(`/post-job`, isNative),
        metadata: { job_id: jobId, customer_id: user.id, onboarding_fee_charged: owesOnboardingFee ? "true" : "false", onboarding_fee_cents: String(onboardingFeeCents) },
      }, {
        // Idempotency: a double-submit (double-tap, retried request) for the same
        // job reuses the existing Checkout Session instead of creating a second
        // escrow charge. Scoped per job; Stripe expires the key after 24h.
        idempotencyKey: `escrow-${jobId}${remintKeySuffix}`,
      });

      // Store both fee structures on the job. Fail the request if this write
      // fails: without stripe_session_id the double-payment guard is blind and
      // the frozen fee percents are lost — the unused Checkout Session is
      // harmless, so failing loudly here costs nothing.
      // stampSession carries the .select("id") zero-row guard: a zero-row match
      // (error === null) would otherwise look identical to success here,
      // leaving stripe_session_id unset — the double-payment guard goes blind
      // and the frozen fee percents are lost.
      const escrowStamp = await stampSession(session.id, {
        platform_fee_percent: customerFeePercent,
        platform_fee_amount: helperFeeAmount,
        customer_fee_amount: customerFeeAmount,
        helper_fee_percent: helperFeePercent,
      });
      if (!escrowStamp.ok) {
        console.error(`[create-payment] escrow session ${session.id} created for job ${jobId} but jobs.update failed:`, escrowStamp.reason);
        throw new PublicError("Could not record the payment session — please try again");
      }

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // (repay_escrow action removed — immediate capture eliminates expiry risk)

    // ─── RELEASE: Both parties confirm → capture + transfer ───
    if (action === "release") {
      const { jobId } = body;
      if (!jobId) throw new PublicError("Missing jobId");

      const { data: firstRead, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !firstRead) throw new PublicError("Job not found");
      // `let`: the conditional write below re-reads on a lost race.
      let job = firstRead;

      const isPoster = job.customer_id === user.id;
      const isHelper = job.helper_id === user.id;
      if (!isPoster && !isHelper) throw new PublicError("Not authorized");
      // A duplicate release (double tap, two devices, a retry after a lost
      // response) answers cleanly BEFORE the status gate, which would otherwise
      // call an already-completed job "not in progress".
      const LIVE_RELEASE_STATUSES = ["in_progress", "revision_requested", "accepted"];
      const alreadyDone = (row: typeof job) => {
        const mine = !!((isPoster && row.poster_completed_at) || (isHelper && row.helper_completed_at));
        const released = row.status === "completed" && !!row.poster_completed_at && !!row.helper_completed_at;
        // Both stamps on a still-live job is the stuck state the old race left
        // behind: NOT "waiting" — fall through so this tap completes it.
        const bothStampedLive = !!row.poster_completed_at && !!row.helper_completed_at;
        const waiting = mine && !bothStampedLive && LIVE_RELEASE_STATUSES.includes(row.status);
        if (!released && !waiting) return null;
        return new Response(JSON.stringify({
          success: true,
          bothDone: released,
          alreadyReleased: released,
          alreadyConfirmed: waiting,
          message: released
            ? "This job was already released — nothing more to do."
            : "You already confirmed completion — waiting on the other party.",
          helperPayout: 0,
          platformFee: 0,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      };
      {
        const early = alreadyDone(job);
        if (early) return early;
      }
      // Excludes "disputed" (and every other terminal state): a disputed job
      // can only be resolved through the admin dispute actions below, never the
      // normal two-party release path.
      if (!["in_progress", "revision_requested", "accepted"].includes(job.status)) {
        throw new PublicError(
          job.status === "disputed"
            ? "This job is currently under dispute. Payment cannot be released until the dispute is resolved."
            : "Job is not in progress",
        );
      }

      // ─── Completion gates (server-side mirror of the DB trigger) ───
      //
      // `enforce_helper_completion_gates` (20260828011057_verified_arrival_gate.sql)
      // returns early on `auth.uid() IS NULL`, and every write in this function
      // goes out on the SERVICE-ROLE client — so on THIS path the trigger never
      // fires and its three gates (arrival established, proof photos, 30-minute
      // floor) would be enforced nowhere but the client. The tracker's own Done
      // step writes with the user's JWT and DOES hit the trigger, so without
      // this block one action has two doors, only one of which is locked — and
      // the unlocked one is the one that schedules the payout.
      //
      // The conditions below are transcribed from that trigger body rather than
      // re-derived, so the two doors cannot drift. Same scoping as the trigger:
      // helper-only, and only on the NULL → NOT NULL transition of
      // helper_completed_at (a poster acting on their own job is not gated, and
      // neither is a re-confirmation of an already-stamped completion).
      // `select("*")` above already returns every column read here.
      const isNewHelperCompletion = isHelper && !isPoster && !job.helper_completed_at;
      if (isNewHelperCompletion) {
        // 1. ARRIVAL MUST BE ESTABLISHED — and that takes BOTH (owner,
        //    2026-09-14, VN-33): the server verified the helper within 500ft
        //    when they marked arrived, AND the poster tapped "Confirm They
        //    Arrived". Either one alone used to be enough, plus a grandfather
        //    cutoff for pre-2026-08-28 arrivals; both are gone, matching the
        //    trigger (20260915044137). The predicate and the sentence are the
        //    shared ones the app uses (_shared/arrivalRule.ts), so the two
        //    doors cannot drift.
        if (!arrivalEstablished(job)) {
          throw new PublicError(arrivalGateMessage(job, "wrap-up"));
        }

        // 2. PROOF PHOTOS — before AND after, on every job regardless of size.
        //    They are the evidence that releases an escrowed payment. Same rule
        //    as src/lib/photoProofPolicy.ts and the trigger's array_length check.
        const hasBeforeProof = Array.isArray(job.proof_before_urls) && job.proof_before_urls.length > 0;
        const hasAfterProof = Array.isArray(job.proof_after_urls) && job.proof_after_urls.length > 0;
        if (!hasBeforeProof || !hasAfterProof) {
          throw new PublicError("Before & after photos are required — they're the proof that releases your payment.");
        }
      }

      // 3. MINIMUM JOB TIME — 30 minutes measured from when work actually
      //    started. The anchor was `helper_confirmed_at || updated_at`, which
      //    measured neither the trigger's rule nor the client's: `jobs` carries
      //    an `update_updated_at_column` trigger (20260311000404), so with
      //    `helper_confirmed_at` NULL the fallback was rewritten by EVERY write
      //    to the row — the arrival stamp, each proof-photo save, the poster's
      //    working confirmation. The window restarted continuously and could
      //    never elapse: the helper saw a fully-enabled "I'm Done — Request
      //    Payout" button, tapped it, and got a "N minutes remaining" error
      //    where N never shrank on retry. The poster's Approve inherited the
      //    same stuck clock. This is now the one expression all three surfaces
      //    use: COALESCE(poster_confirmed_working_at, helper_arrived_at).
      //
      //    NULL ANCHOR ⇒ ALLOW, deliberately. Both stamps NULL means there is
      //    no recorded start to measure from, and the trigger's own shape
      //    (`COALESCE(...) IS NOT NULL AND now() - ... < 30 min`) plus both
      //    client gates (`workStart ? ... : false`) already resolve that to
      //    "no floor". Blocking instead would be unclearable: nothing later
      //    back-fills those stamps, so a poster-vouched arrival with no
      //    `helper_arrived_at` would be frozen out of its own payout forever.
      //    The helper's door is not left open by this — the arrival and photo
      //    gates above still stand between them and the completion write.
      //    Applies to BOTH parties: the floor is a property of the job, not of
      //    who taps first.
      const workStartMs = job.poster_confirmed_working_at
        ? Date.parse(job.poster_confirmed_working_at)
        : job.helper_arrived_at
          ? Date.parse(job.helper_arrived_at)
          : NaN;
      if (Number.isFinite(workStartMs)) {
        const elapsed = Date.now() - workStartMs;
        const MIN_JOB_TIME_MS = 30 * 60 * 1000; // 30 minutes
        if (elapsed < MIN_JOB_TIME_MS) {
          const minutesLeft = Math.ceil((MIN_JOB_TIME_MS - elapsed) / 60000);
          throw new PublicError(`Job must be active for at least 30 minutes before completion. ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""} remaining.`);
        }
      }

      // ─── The write is CONDITIONAL on the row we decided from ───────────────
      //
      // This used to read the job, decide, then UPDATE ... WHERE id = jobId.
      // Proven on prod (scripts/probes/release-race.prod.mjs): two releases in
      // flight together both passed the status check and both wrote —
      //   double tap (helper already done): both calls stamped
      //     poster_completed_at + payout_scheduled_at and both inserted the
      //     "Job completed!" notices;
      //   crossed (poster and helper at once): each read the other as not done,
      //     each wrote only its own stamp, and the job was left in_progress with
      //     BOTH stamps — a completion nobody could finish.
      // Now the UPDATE carries the exact state it was decided from (status and
      // both *_completed_at as read). Under READ COMMITTED the second writer
      // blocks on the row lock, re-checks that predicate against the committed
      // row, and matches 0 rows. It then re-reads and decides again: a crossed
      // release completes the job on the retry; a duplicate finds its own stamp
      // already there and returns alreadyReleased / alreadyConfirmed with NO
      // write, NO notification and NO second payout scheduling.

      let updateFields: Record<string, any> = {};
      let posterDone = false;
      let helperDone = false;
      let bothDone = false;
      let jobUpdated: { id: string }[] | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          const { data: reread, error: rereadErr } = await supabaseAdmin
            .from("jobs").select("*").eq("id", jobId).single();
          if (rereadErr || !reread) throw new PublicError("Job not found");
          job = reread;
          const done = alreadyDone(job);
          if (done) return done;
          if (!LIVE_RELEASE_STATUSES.includes(job.status)) {
            throw new PublicError(
              job.status === "disputed"
                ? "This job is currently under dispute. Payment cannot be released until the dispute is resolved."
                : "Job is not in progress",
            );
          }
        }

        updateFields = {};
        if (isPoster) updateFields.poster_completed_at = new Date().toISOString();
        if (isHelper) updateFields.helper_completed_at = new Date().toISOString();

        posterDone = isPoster ? true : !!job.poster_completed_at;
        helperDone = isHelper ? true : !!job.helper_completed_at;
        bothDone = posterDone && helperDone;

        if (bothDone) {
          // Payment was already captured at checkout (immediate capture).
          // Verify the charge succeeded before scheduling payout.
          let paymentIntentId = job.stripe_payment_intent_id;
          if (!paymentIntentId && job.stripe_session_id) {
            const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
            paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
            if (paymentIntentId) {
              // Cache-only write (not lifecycle): zero rows is harmless.
              const { error: piCacheErr } = await supabaseAdmin.from("jobs").update({ stripe_payment_intent_id: paymentIntentId }).eq("id", job.id);
              if (piCacheErr) console.error(`[create-payment] PI cache write failed for job ${job.id} (release):`, piCacheErr.message);
            }
          }
          if (paymentIntentId) {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
            if (pi.status !== "succeeded") {
              // pi.status is Stripe text; the release caller is a poster/Helpr, not an admin.
              console.error("[create-payment] release: PI not captured", { status: pi.status });
              throw new PublicError("Payment not captured yet, so the payout can't be released. Refresh and try again in a moment.");
            }
          }

          // Charge confirmed — schedule payout
          // STANDARD PAY: 3 days after the job was marked done (Q202, was now + 24h).
          const payoutTime = standardPayoutAtIso(isHelper ? null : job.helper_completed_at);
          updateFields.payout_scheduled_at = payoutTime;
          updateFields.status = "completed";
          updateFields.payment_status = "payout_pending";
        } else if (job.status === "accepted") {
          // If job was still in accepted, move to in_progress when one party marks complete
          updateFields.status = "in_progress";
        }

        let conditional = supabaseAdmin.from("jobs").update(updateFields)
          .eq("id", jobId)
          .eq("status", job.status);
        conditional = job.poster_completed_at
          ? conditional.eq("poster_completed_at", job.poster_completed_at)
          : conditional.is("poster_completed_at", null);
        conditional = job.helper_completed_at
          ? conditional.eq("helper_completed_at", job.helper_completed_at)
          : conditional.is("helper_completed_at", null);
        // .select("id"): this is the write that flips status to "completed" and
        // schedules the payout. Zero rows is now EXPECTED on a lost race and is
        // answered by the re-read above — never by falling through.
        const { data, error: updateError } = await conditional.select("id");
        if (updateError) {
          console.error("Failed to update job:", updateError);
          throw new PublicError("Failed to update the job status — please try again");
        }
        if (data && data.length > 0) {
          jobUpdated = data;
          break;
        }
        console.log(`[create-payment] release for job ${jobId} lost a concurrent write (attempt ${attempt + 1}); re-reading`);
      }
      if (!jobUpdated) {
        throw new PublicError("This job changed while we were saving. Refresh and try again.");
      }
      console.log("Job updated successfully:", jobId, updateFields);

      // Calculate helper payout: budget/helpers - helperCommission + urgent_fee
      // Commission tax is already collected at checkout — no deduction here
      const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
      const perHelperBudget = job.budget / helpersCount;
      // Resolve the helper's live tier for an accurate payout estimate; the real
      // transfer in process-scheduled-payouts re-resolves it at payout time.
      const jobHelperFeePercent = await getHelperFeePercent(
        supabaseAdmin,
        job.helper_id,
        job.helper_fee_percent ?? DEFAULT_TIER_FEE_PERCENT,
      );
      const helperCommission = (perHelperBudget * jobHelperFeePercent) / 100;
      // Urgent fee is collected from the poster ONCE, so on a group job it is
      // split across the roster like the budget — else N helpers each get the
      // full urgent bonus against a single fee collected, over-paying N×.
      const helperPayout = perHelperBudget - helperCommission + netUrgentFeeDollars(job.urgent_fee) / helpersCount;
      if (isPoster && job.helper_id && !helperDone) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Job marked complete",
          message: `The person who posted "${job.title}" marked it complete. Please confirm completion to release payment.`,
          // `?job=` — see the note on the shared rule at the top of this file.
          type: "info", link: `/my-jobs?job=${job.id}`,
        });
      }
      if (isHelper && !posterDone) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Helpr marked the job complete",
          message: `The helpr marked "${job.title}" as complete. Please confirm completion to release payment.`,
          type: "info", link: `/my-posts?job=${job.id}`,
        });
      }

      if (bothDone) {
        if (job.helper_id) {
          await supabaseAdmin.from("notifications").insert({
            user_id: job.helper_id,
            title: "Job completed!",
            message: `"${job.title}" is complete. $${formatPayoutDollars(helperPayout)} will be sent to your account ${STANDARD_PAYOUT_PHRASE}.`,
            type: "payment", link: "/profile?tab=earnings",
          });
        }
        await supabaseAdmin.from("notifications").insert({
          user_id: job.customer_id,
          title: "Job completed!",
          message: `"${job.title}" is complete. Payment has been captured. The Helpr is paid ${STANDARD_PAYOUT_PHRASE}.`,
          type: "payment", link: `/my-posts?job=${job.id}`,
        });
      }

      return new Response(JSON.stringify({
        success: true, bothDone,
        helperPayout: bothDone ? helperPayout : 0,
        platformFee: bothDone ? (job.platform_fee_amount || 0) : 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── REQUEST REVISION ───
    if (action === "request_revision") {
      const { jobId, note } = body;
      if (!jobId) throw new PublicError("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");
      if (job.customer_id !== user.id) throw new PublicError("Not authorized");
      if (job.status !== "in_progress") throw new PublicError("Job must be in progress to request revision");

      // Conditional on the status just read (race-class audit 2026-09-14).
      // enforce_job_status_transition already refuses completed/disputed/
      // cancelled → revision_requested, but a same-status write passes it: a
      // double-tap re-stamped revision_requested_at and the note and sent the
      // Helpr a second "Revision requested", and a request queued behind the
      // Helpr's resolve_revision would have rewritten the note on a revision
      // they had just delivered.
      const { data: revisionUpdated, error: revisionUpdateErr } = await supabaseAdmin.from("jobs").update({
        status: "revision_requested",
        revision_note: note || "The person who posted this job has requested revisions.",
        revision_requested_at: new Date().toISOString(),
      }).eq("id", jobId).eq("status", "in_progress").select("id");
      if (revisionUpdateErr) {
        console.error("[create-payment] request_revision update failed:", revisionUpdateErr);
        throw new PublicError("Failed to record revision request — please try again");
      }
      if (!revisionUpdated || revisionUpdated.length === 0) {
        // Zero rows: the job left in_progress between the read and the write.
        // Re-read to tell "a concurrent request already did this" (a clean,
        // notification-free success) from "the job moved somewhere else".
        const { data: nowJob, error: nowErr } = await supabaseAdmin
          .from("jobs").select("status").eq("id", jobId).maybeSingle();
        if (!nowErr && nowJob?.status === "revision_requested") {
          return new Response(JSON.stringify({ success: true, alreadyRequested: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
          });
        }
        console.error("[create-payment] request_revision matched 0 rows; job now:", nowErr ?? nowJob?.status);
        if (nowErr) throw new PublicError("Failed to record revision request — please try again");
        throw new PublicError("This job is no longer in progress, so a revision can't be requested. Refresh to see its current state.");
      }

      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Revision requested",
          message: `The person who posted "${job.title}" has requested revisions: ${note || "Please check the details."}`,
          type: "warning", link: `/my-jobs?job=${job.id}`,
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── RESOLVE REVISION ───
    if (action === "resolve_revision") {
      const { jobId } = body;
      if (!jobId) throw new PublicError("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");
      if (job.helper_id !== user.id) throw new PublicError("Not authorized");
      if (job.status !== "revision_requested") throw new PublicError("No revision pending");

      const now = new Date();
      const acceptanceDeadline = new Date(now.getTime() + 72 * 60 * 60 * 1000);

      // Conditional on a revision still open and not yet delivered (race-class
      // audit 2026-09-14). Matched on id alone, the stamp landed on whatever the
      // job had become: auto-release-payment's undelivered-revision sweep or the
      // poster opening a dispute flips revision_requested → disputed, and the
      // Helpr's queued stamp then wrote a 72h acceptance deadline onto a disputed
      // job and told the poster "If you do nothing, payment auto-releases" about
      // money an admin now decides. `revision_completed_at IS NULL` is the
      // double-tap guard: set_revision_deadline clears it on every new request,
      // so it is null exactly while a delivery is owed.
      const { data: resolveUpdated, error: resolveUpdateErr } = await supabaseAdmin.from("jobs").update({
        revision_completed_at: now.toISOString(),
        revision_acceptance_deadline: acceptanceDeadline.toISOString(),
      }).eq("id", jobId).eq("status", "revision_requested").is("revision_completed_at", null).select("id");
      if (resolveUpdateErr) {
        console.error("[create-payment] resolve_revision update failed:", resolveUpdateErr);
        throw new PublicError("Failed to record revision completion — please try again");
      }
      if (!resolveUpdated || resolveUpdated.length === 0) {
        const { data: nowJob, error: nowErr } = await supabaseAdmin
          .from("jobs").select("status, revision_completed_at").eq("id", jobId).maybeSingle();
        if (!nowErr && nowJob?.status === "revision_requested" && nowJob?.revision_completed_at) {
          // A concurrent tap already delivered it — no second deadline, no second notice.
          return new Response(JSON.stringify({ success: true, alreadyResolved: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
          });
        }
        console.error("[create-payment] resolve_revision matched 0 rows; job now:", nowErr ?? nowJob?.status);
        if (nowErr) throw new PublicError("Failed to record revision completion — please try again");
        throw new PublicError("No revision pending — this job has moved on. Refresh to see its current state.");
      }

      await supabaseAdmin.from("notifications").insert({
        user_id: job.customer_id,
        title: "Revision completed — review needed",
        message: `The helpr has fixed the revision for "${job.title}". You have 72 hours to accept (mark complete) or dispute. If you do nothing, payment auto-releases.`,
        type: "warning", link: `/my-posts?job=${job.id}`,
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── TIP ───
    if (action === "tip") {
      const { jobId, amount } = body;
      if (!jobId) throw new PublicError("Missing jobId");
      // Client-supplied idempotency salt — treat as untrusted input. Accept
      // ONLY a canonical UUID: the value is concatenated into a Stripe
      // idempotency key, so an attacker-chosen string could otherwise be used
      // to collide with (and replay) another attempt's key. Anything malformed
      // is dropped, falling back to the time-bucket key below.
      const rawTipAttemptId = (body as { tipAttemptId?: unknown }).tipAttemptId;
      const tipAttemptId =
        typeof rawTipAttemptId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawTipAttemptId)
          ? rawTipAttemptId
          : null;
      // `amount` is raw client JSON — validate it as a finite, bounded number
      // BEFORE any money math. A $1 floor keeps the tip safely above both
      // Stripe's 50¢ charge minimum AND the fee-crossover (a sub-32¢ tip would
      // have an application_fee_amount ≥ the charge, which Stripe rejects); the
      // $1,000 ceiling bounds a fat-finger / abusive charge.
      if (typeof amount !== "number" || !Number.isFinite(amount)) {
        throw new PublicError("Invalid tip amount");
      }
      const tipCents = Math.round(amount * 100);
      if (tipCents < 100 || tipCents > 100_000) {
        throw new PublicError("Tips must be between $1 and $1,000");
      }

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");
      if (job.status !== "completed") throw new PublicError("Job must be completed to tip");
      if (user.id !== job.customer_id) throw new PublicError("Only the person who posted this job can tip the Helpr");
      if (!job.helper_id) throw new PublicError("No Helpr assigned to this job");

      const helperId = job.helper_id;

      // Check if helper has a connected Stripe account for direct tip transfer.
      // A read ERROR must fail the request — treating it as "no Connect account"
      // would silently reroute the tip to the platform balance instead of the
      // helper. Only a genuine missing row (PGRST116) may fall through.
      const { data: helperProfile, error: helperProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", helperId)
        .maybeSingle();
      if (helperProfileErr) {
        console.error(`[create-payment] tip — helper profile read failed for ${helperId}:`, helperProfileErr);
        throw new PublicError("Could not verify the Helpr's payout account — please try again");
      }
      if (!helperProfile?.stripe_account_id) {
        return new Response(
          JSON.stringify({ error: "This Helpr hasn't set up their payout account yet and cannot receive tips at this time." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        );
      }

      // The tip covers its OWN Stripe processing fee — the platform never eats
      // it. On a destination charge the Stripe fee is debited from the platform
      // balance, so we retain exactly that many cents as the application fee;
      // the helper's transfer nets tip-minus-fee and the platform breaks even.
      // (`tipCents` is validated + bounded above; the $1 floor guarantees
      // tipFeeCents < tipCents so Stripe never rejects the fee.)
      const tipFeeCents = stripeProcessingCostCents(tipCents);

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        line_items: [{
          price_data: {
            currency: "usd",
            tax_behavior: TAX_BEHAVIOR,
            product_data: { name: `Tip — ${job.title}`, description: "Thank you tip. The small card-processing fee is deducted so the platform never subsidizes it." },
            unit_amount: tipCents,
          },
          quantity: 1,
        }],
        mode: "payment",
        // 3D Secure from $300 (Q202), same rule as the job charge.
        payment_method_options: threeDSecureOptions(tipCents),
        payment_intent_data: {
          transfer_data: {
            destination: helperProfile.stripe_account_id,
          },
          application_fee_amount: tipFeeCents,
        },
        success_url: buildRedirectUrl(`/my-posts?tip=success`, isNative),
        cancel_url: buildRedirectUrl(`/my-posts`, isNative),
        metadata: { job_id: jobId, tipper_id: user.id, helper_id: helperId, type: "tip" },
      }, {
        // Dedupe client retries (double-tap, network retry) without blocking a
        // deliberate repeat tip later. Salted with the CLIENT'S per-attempt id
        // rather than a wall-clock bucket: the previous
        // `Math.floor(Date.now() / 600_000)` meant a retry that straddled the
        // 10-minute boundary produced a SECOND checkout session and a second
        // pending `tips` row for one user intent. The attempt id is stable for
        // as long as the tip prompt is open, so every retry of that intent
        // collapses onto one session regardless of elapsed time.
        // Falls back to the old bucket only for a client that predates this
        // field, so an older app build still gets partial protection.
        idempotencyKey: tipAttemptId
          ? `tip-${jobId}-${user.id}-${tipCents}-${tipAttemptId}`
          : `tip-${jobId}-${user.id}-${tipCents}-${Math.floor(Date.now() / 600_000)}`,
      });

      // Ledger row for the webhook to reconcile against. The idempotency key
      // above can return an EXISTING session on a retry, so dedupe on
      // stripe_session_id — never a second pending row for the same session.
      // Both the lookup and the insert must fail the request: a paid tip with
      // no ledger row silently pools on the platform balance.
      const { data: existingTip, error: tipLookupErr } = await supabaseAdmin
        .from("tips")
        .select("id")
        .eq("stripe_session_id", session.id)
        .maybeSingle();
      if (tipLookupErr) {
        console.error(`[create-payment] tip — ledger lookup failed for session ${session.id}:`, tipLookupErr);
        throw new PublicError("Could not record the tip — please try again");
      }
      if (!existingTip) {
        const { error: tipInsertErr } = await supabaseAdmin.from("tips").insert({
          job_id: jobId, tipper_id: user.id, helper_id: helperId,
          // Persist the canonical charged value (tipCents/100), NOT the raw
          // float, so the ledger can never disagree with what Stripe charged.
          amount: tipCents / 100, stripe_session_id: session.id, payment_status: "pending",
        });
        if (tipInsertErr) {
          console.error(`[create-payment] tip — ledger insert failed for session ${session.id} (job ${jobId}):`, tipInsertErr);
          throw new PublicError("Could not record the tip — please try again");
        }
      }

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── CANCEL ESCROW ───
    if (action === "cancel_escrow") {
      const { jobId } = body;
      if (!jobId) throw new PublicError("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");
      if (job.customer_id !== user.id) throw new PublicError("Not authorized");

      // ── Only an unhired, undisputed job is the poster's to refund here ──
      // This door checked `payment_status` alone, and it is reachable by any
      // poster with a JWT (no UI calls it; the prod test sweepers do). So:
      //   * on a DISPUTED job the poster — the side that filed, or the side
      //     losing — took the escrow back out of a live dispute, and racing an
      //     admin Quick Release it was a double spend (disjoint idempotency keys);
      //   * on a job with a DECIDED dispute whose split has not executed
      //     (rpc_decide_dispute moves status to completed/cancelled and leaves
      //     the escrow held — live example on prod, is_seed job bb2c3732) it
      //     overrode the admin's decision (lh-authz-rls review, HIGH);
      //   * on a HIRED job it skipped the cancellation-fee ladder that
      //     poster_cancel_job + void-cancelled-payments charge, so the Helpr's
      //     late-cancel share simply vanished.
      // An ALLOWLIST, not a denylist, so the next state nobody thought of is
      // refused by default: `open` with no Helpr assigned — the one state where
      // no fee is owed and no dispute can exist. Everything else goes through
      // the Cancel button (poster_cancel_job), which owns those rules.
      // The same predicates ride on the atomic claim below, so a hire or a
      // filing that lands between this read and the claim still wins.
      // The decided-but-unexecuted read is release-payout's own shared check
      // (_shared/unsettledDispute.ts), fail-closed on a read error.
      const settlement = await checkUnsettledDispute(supabaseAdmin, jobId);
      if (settlement.readError) {
        console.error(`[create-payment] cancel_escrow dispute check failed for job ${jobId}: ${settlement.readError}`);
        return new Response(JSON.stringify({
          error: "Couldn't check this job's dispute state. No money was moved — try again.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
      }
      if (job.status !== "open" || job.helper_id || settlement.blocked) {
        const disputed = job.status === "disputed" || settlement.blocked;
        console.error(
          `[create-payment] cancel_escrow REFUSED on job ${jobId} (caller ${user.id}): status=${job.status}, helper=${job.helper_id ?? "none"}, unsettled dispute=${settlement.dispute?.id ?? "none"}`,
        );
        return new Response(JSON.stringify({
          error: disputed
            ? "This job is under dispute, so its payment can't be cancelled or refunded here. An admin will decide where the payment goes. No money was moved."
            : "This job has a Helpr or has already started, so it has to be cancelled with Cancel job — that applies the cancellation rules and refunds you. No money was moved.",
          ...(disputed ? { disputed: true } : { useCancelJob: true }),
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
      }

      // Atomic state claim: only an escrow-held job may be refunded.
      // Without this, a cancel racing the payout release could refund a
      // PI whose funds were already transferred to the helper — the
      // platform pays twice. 'cancelling' stays claimable so a run that
      // failed after the claim can be retried (the Stripe idempotency
      // key below makes the refund itself single-shot either way).
      //
      // The claim is also pinned to the status just read (race-class audit
      // 2026-09-14), so the final flip below can carry the same predicate: a
      // job that moved (a dispute opened, a completion landed) between the read
      // and here is refused BEFORE the refund, not discovered after it.
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from("jobs")
        .update({ payment_status: "cancelling" })
        .eq("id", jobId)
        .eq("status", job.status)
        .in("payment_status", ["escrow", "cancelling"])
        // The allowlist above, inside the atomic write: `job.status` is 'open'
        // here, and a hire landing since the read sets helper_id.
        .is("helper_id", null)
        .select("id");
      if (claimErr) {
        console.error(`[create-payment] cancel_escrow state claim failed for job ${jobId}:`, claimErr);
        throw new PublicError("Could not cancel — please try again");
      }
      if (!claimed || claimed.length === 0) {
        return new Response(JSON.stringify({
          error: "This payment can no longer be cancelled — it has already been released, refunded, or was never held in escrow.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
      }

      // With immediate capture, we need to refund instead of cancel.
      // Errors propagate to the outer catch so the job is NOT silently
      // marked "cancelled" when the refund fails — the customer would
      // lose their money with no indication anything went wrong.
      //
      // Resolve the PI from the session if it's not already stored.
      // Mirrors the same fallback in `release`, `admin_release_dispute`,
      // and `process-scheduled-payouts`: all four payout/refund paths
      // must handle the narrow race window between checkout completion
      // and the webhook setting stripe_payment_intent_id, so none of
      // them should skip the refund just because the column is blank.
      let cancelPaymentIntentId = job.stripe_payment_intent_id;
      if (!cancelPaymentIntentId && job.stripe_session_id) {
        try {
          const cancelSession = await stripe.checkout.sessions.retrieve(
            job.stripe_session_id,
            { expand: ["payment_intent"] },
          );
          cancelPaymentIntentId =
            typeof cancelSession.payment_intent === "string"
              ? cancelSession.payment_intent
              : (cancelSession.payment_intent as any)?.id ?? null;
          if (cancelPaymentIntentId) {
            await supabaseAdmin
              .from("jobs")
              .update({ stripe_payment_intent_id: cancelPaymentIntentId })
              .eq("id", job.id);
          }
        } catch (sessionErr) {
          console.warn(
            `[create-payment] cancel_escrow: could not retrieve session for PI (job ${jobId}):`,
            sessionErr,
          );
        }
      }

      if (cancelPaymentIntentId) {
        const pi = await stripe.paymentIntents.retrieve(cancelPaymentIntentId, {
          expand: ["latest_charge.balance_transaction"],
        });
        if (pi.status === "succeeded") {
          // Service fee is non-refundable: Stripe already took its cut on the
          // full capture and does NOT return it on a refund, so a full refund
          // leaves the platform out-of-pocket by that processing cost on every
          // free cancellation. Withhold the poster's service fee, floored at
          // Stripe's ACTUAL processing cost for this specific charge (read from
          // the balance transaction, not assumed) so the platform never loses
          // money to fees regardless of payment method — cards, Klarna/Affirm/
          // Afterpay, and ACH all carry different real rates.
          const capturedCents = pi.amount_received ?? pi.amount;
          const serviceFeeCents = Math.round(Number(job.customer_fee_amount ?? 0) * 100);
          const nonRefundableCents = Math.max(serviceFeeCents, actualOrEstimatedFeeCents(pi, capturedCents));
          const refundAmount = capturedCents - nonRefundableCents;
          // Idempotency key prevents a double-refund on concurrent cancel
          // requests (double-tap, network retry) from both succeeding before
          // the payment_status flip below makes the second 409 out.
          // Skip the refund entirely if the withholding consumes the whole
          // capture (Stripe rejects a $0 refund); the job still flips cancelled.
          if (refundAmount > 0) {
            const refund = await stripe.refunds.create(
              { payment_intent: cancelPaymentIntentId, amount: refundAmount },
              { idempotencyKey: `cancel-escrow-${jobId}` },
            );
            await recordRefund(supabaseAdmin, {
              refund,
              jobId,
              customerId: job.customer_id,
              paymentIntentId: cancelPaymentIntentId,
              source: "cancel_escrow",
              isPartial: nonRefundableCents > 0,
              reason: "escrow cancellation refund (minus non-refundable service fee)",
              initiatedByUserId: user.id,
            });
          } else {
            // The withholding consumed the whole capture, so the poster gets $0
            // back while the job still flips to cancelled. That can be legitimate
            // (a tiny capture entirely eaten by the non-refundable fee) but it can
            // also mean bad data (a stale/oversized customer_fee_amount, or a
            // degenerate/NaN capturedCents). Either way it must NEVER pass
            // silently — no ledger row is written in this branch, so ops is the
            // only trace. Alert with the inputs so a human can reconcile.
            console.error(
              `[create-payment] cancel_escrow: refundAmount<=0 for job ${jobId} ` +
                `(capturedCents=${capturedCents}, serviceFeeCents=${serviceFeeCents}, ` +
                `nonRefundableCents=${nonRefundableCents}) — poster refunded $0.`,
            );
            const suspicious =
              !Number.isFinite(capturedCents) || (capturedCents as number) <= 0;
            postSlackOpsAlert({
              kind: "custom",
              severity: suspicious ? "warning" : "info",
              title: "Escrow cancellation resolved with $0 refund",
              message:
                "A cancellation flipped the job to cancelled but returned nothing to the poster. Verify this was intended.",
              fields: {
                job_id: jobId,
                payment_intent: cancelPaymentIntentId,
                captured_cents: capturedCents,
                service_fee_cents: serviceFeeCents,
                non_refundable_cents: nonRefundableCents,
                refund_amount: refundAmount,
              },
            });
          }
        }
      }

      // The refund is already out — a failed status flip here must be LOUD,
      // or the job stays "in progress" on a refunded payment (helper still
      // sees it, auto-release could treat it as payable).
      //
      // Conditional on OUR claim (race-class audit 2026-09-14): payment_status
      // still 'cancelling' and status still what the claim pinned. Matched on id
      // alone this overwrote whatever landed during the Stripe round-trips —
      // open_dispute_as's in_progress → disputed (the transition matrix allows
      // disputed → cancelled, leaving an open dispute on a cancelled, refunded
      // job) or a chargeback's payment_status — with cancelled/cancelled.
      let { data: cancelUpdated, error: cancelUpdateErr } = await supabaseAdmin.from("jobs").update({
        payment_status: "cancelled",
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.id,
      }).eq("id", jobId).eq("status", job.status).eq("payment_status", "cancelling").select("id");
      if (!cancelUpdateErr && (!cancelUpdated || cancelUpdated.length === 0)) {
        // A concurrent retry of this same cancel (the claim re-admits
        // 'cancelling', the refund key dedupes) may have flipped it first.
        // That is this request's outcome too, not a divergence.
        const { data: nowJob } = await supabaseAdmin
          .from("jobs").select("id, status, payment_status").eq("id", jobId).maybeSingle();
        if (nowJob?.status === "cancelled" && nowJob?.payment_status === "cancelled") {
          cancelUpdated = [{ id: nowJob.id }];
        } else if (nowJob?.payment_status === "cancelling") {
          // Our claim still holds but the STATUS moved during the refund — in
          // practice open_dispute_as (it does not look at payment_status). The
          // refund is what actually happened, so cancelled must still win:
          // leaving the job `disputed` on a refunded charge lets Quick Release
          // (which gates on status alone) pay the Helpr out of money already
          // returned. Forced on the claim alone — never over a chargeback or
          // anything else that moved payment_status — and paged, because the
          // dispute record it overrode needs a human to close it.
          const { data: forced, error: forceErr } = await supabaseAdmin.from("jobs").update({
            payment_status: "cancelled",
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            cancelled_by: user.id,
          }).eq("id", jobId).eq("payment_status", "cancelling").select("id");
          cancelUpdated = forced;
          cancelUpdateErr = forceErr;
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "critical",
            title: "Escrow cancellation refunded a job whose status moved mid-refund",
            message:
              `cancel_escrow refunded job ${jobId} while its status moved ${job.status} → ${nowJob.status}. ` +
              `${!forceErr && forced && forced.length > 0 ? "The job was forced to cancelled" : "The forced cancel ALSO failed"}; ` +
              "close any open dispute on it and confirm no payout is queued.",
            fields: { job_id: jobId, read_status: job.status, status_at_flip: nowJob.status, forced: String(!forceErr && !!forced?.length) },
          });
        }
      }
      // .select("id"): a zero-row match here (error === null) is exactly the
      // "refund issued but status never flipped" case the comment above warns
      // about — must be caught the same as a real error, not silently passed.
      if (cancelUpdateErr || !cancelUpdated || cancelUpdated.length === 0) {
        console.error(`CRITICAL: refund issued for job ${jobId} (pi ${job.stripe_payment_intent_id}) but jobs.update to cancelled failed — manual reconciliation needed:`, cancelUpdateErr ?? "matched 0 rows");
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "Escrow cancellation refunded but the job did not flip to cancelled",
          message: `cancel_escrow issued the refund for job ${jobId} but the jobs update did not land. The job may still look payable — reconcile by hand.`,
          fields: { job_id: jobId, payment_intent: job.stripe_payment_intent_id ?? "—", reason: (cancelUpdateErr?.message ?? "matched 0 rows").slice(0, 200) },
        });
        return new Response(JSON.stringify({
          error: "refund issued but job status update failed — contact support",
          stripe_payment_intent_id: job.stripe_payment_intent_id,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── ADMIN: Release disputed payment to helpr ───
    if (action === "admin_release_dispute") {
      const { jobId } = body;
      if (!jobId) throw new PublicError("Missing jobId");

      // Verify admin
      const { data: isAdmin, error: adminRoleErr } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (adminRoleErr) console.error("[create-payment] admin_release_dispute has_role check failed:", adminRoleErr.message);
      if (!isAdmin) throw new PublicError("Not authorized — admin only");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");

      // Only a job that is actually under dispute may be resolved here. Without
      // this guard an admin call could release escrow on an already-completed,
      // cancelled, or never-disputed job (double-pay / out-of-band release).
      if (job.status !== "disputed") {
        throw new PublicError(`Job is not under dispute (status: ${job.status}). Cannot resolve a dispute that doesn't exist.`);
      }

      // ─── Group jobs: refuse. This path can only pay ONE helper. ───────────
      //
      // A group job holds ONE escrow for the whole budget and splits it across
      // the roster (20260804122000). This action transfers to `job.helper_id`
      // — which `accept_group_application` sets to the FIRST accepted helper
      // and never updates — and then flips the job to completed/released. On a
      // 3-person crew that paid the lead their correct 1/N, paid the other two
      // NOTHING, and marked the job settled: `release-payout` refuses a
      // released job, `process-scheduled-payouts` only sweeps
      // `payout_pending`, and there is no retry anywhere. The other two shares
      // stay on the platform balance permanently, and the people owed them
      // have a job that says it was paid.
      //
      // This is the same refusal `release-payout:160` and
      // `execute-dispute-split:226` already make, for the same reason, and it
      // is the LAST money path that did not. It cannot route to the fan-out
      // path the way release-payout does: `process-scheduled-payouts` filters
      // `.is("disputed_at", null)` as defense-in-depth (index.ts:87), so a job
      // that has ever been disputed is invisible to it. So the honest options
      // here are "pay everyone" (needs a fan-out this function does not have)
      // or "move no money" — and an under-paid roster is unrecoverable while a
      // job left `disputed` is not. `admin_refund_dispute` (full refund to the
      // poster) is unaffected and remains available to close this dispute.
      if (job.is_group_job && (job.helpers_needed ?? 1) > 1) {
        const { data: dpRoster, error: dpRosterError } = await supabaseAdmin
          .from("group_job_helpers")
          .select("helper_id")
          .eq("job_id", job.id);

        // Fail CLOSED on a failed lookup. Dropping this error would make the
        // guard vanish exactly when it is needed: roster === null → length 0 →
        // the `> 1` test is false → we pay the lead off a roster we could not
        // read. We already know from the job row that this is a multi-helper
        // group job; the roster read is a detail check, not the thing that
        // decides group-ness.
        if (dpRosterError) {
          console.error(
            `[create-payment] admin_release_dispute: roster read failed for group job ${job.id}:`,
            dpRosterError.message,
          );
          return new Response(
            JSON.stringify({
              error: "Could not verify the Helpr roster for this group job. No money was moved.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
          );
        }

        const dpRosterSize = (dpRoster ?? []).length;
        if (dpRosterSize > 1) {
          console.error(
            `[create-payment] admin_release_dispute: refusing group job ${job.id} — ${dpRosterSize} roster members cannot be paid by a single-helper release.`,
          );
          await postSlackOpsAlert({
            kind: "payout_failed",
            severity: "critical",
            title: "Group job sent to the single-helper dispute release",
            message:
              "admin_release_dispute was invoked for a multi-helper group job. It can only transfer to jobs.helper_id, which would have paid the lead their 1/N share and flipped the job to released while the rest of the roster went unpaid with no retry. The release was REFUSED — no money moved. Resolve this dispute with the full refund action, or pay the roster manually.",
            fields: {
              "Job ID": job.id,
              "Roster size": String(dpRosterSize),
              "Helpers needed": String(job.helpers_needed ?? 1),
            },
            // `?view=` is the ONLY query param /admin routes on (src/pages/Admin.tsx
            // resolves `searchParams.get("view")` against VIEW_LABELS). This link
            // read `?tab=disputes` for as long as it has existed, which Admin.tsx
            // never looked at — every one of these alerts opened the dashboard home.
            link: "https://www.louisianahelpr.com/admin?view=disputes",
          });
          return new Response(
            JSON.stringify({
              error:
                "This is a group job with more than one Helpr on the roster. Releasing here would pay only the lead Helpr and mark the job settled, stranding everyone else's share. No money was moved — use the full refund action, or pay the roster manually.",
              is_group_job: true,
              roster_size: dpRosterSize,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
          );
        }
      }

      // Verify payment is captured (immediate capture — should already be succeeded)
      let paymentIntentId = job.stripe_payment_intent_id;
      if (!paymentIntentId && job.stripe_session_id) {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
        paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      }
      if (!paymentIntentId) throw new PublicError("No payment intent found for this job");
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== "succeeded") throw new PublicError(`Payment not captured (status: ${pi.status})`);
      const captureResult = { paymentIntentId };

      // Transfer to helpr. Resolve the platform fee from the helper's live
      // subscription tier at release time; fall back to the amount frozen on the
      // job at checkout if the profile read fails.
      const disputeFeePercent = await getHelperFeePercent(
        supabaseAdmin,
        job.helper_id,
        job.helper_fee_percent ?? DEFAULT_TIER_FEE_PERCENT,
      );
      const feeAmt = Math.round(Number(job.budget) * disputeFeePercent) / 100 || (job.platform_fee_amount || 0);
      const dpHelpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
      // Urgent fee collected from the poster ONCE → split across the roster like
      // budget and fee, else each of N helpers gets the full urgent bonus and
      // the platform over-pays N× what it collected.
      const helperPayout = (job.budget / dpHelpersCount) - (feeAmt / dpHelpersCount) + netUrgentFeeDollars(job.urgent_fee) / dpHelpersCount;
      // ── Take the settlement claim, then move the money ──────────────────
      // Here and not earlier: everything above this line can refuse (the group
      // roster, a missing or uncaptured PaymentIntent) without moving a cent,
      // and a claim held across those refusals would lock the counterpart
      // action out of a dispute nothing had touched.
      const releaseClaim = await claimDisputeSettlement(
        supabaseAdmin, jobId, "release", user.id, "completed", "released",
      );
      if ("refusal" in releaseClaim) return releaseClaim.refusal;

      // ── Stripe, inside the claim: has this charge already been refunded? ──
      // The ledger check ran before the claim, and `recordRefund` swallows its
      // own write failure, so an empty `payment_refunds` is not proof. The
      // charge's `amount_refunded` is — the same check the 72h sweep makes
      // (lh-money-escrow review round 2). Fails closed.
      try {
        const chargePi = await stripe.paymentIntents.retrieve(captureResult.paymentIntentId, { expand: ["latest_charge"] });
        const charge = (chargePi as { latest_charge?: unknown }).latest_charge;
        const refundedCents = charge && typeof charge === "object"
          ? Number((charge as { amount_refunded?: number }).amount_refunded ?? 0)
          : 0;
        if (refundedCents > 0) {
          await releaseDisputeSettlementClaim(supabaseAdmin, jobId, releaseClaim.claim);
          console.error(`[create-payment] admin_release_dispute REFUSED for job ${jobId}: Stripe shows ${refundedCents}¢ already refunded`);
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "critical",
            title: "Quick Release refused — the charge was already refunded",
            message: `Job ${jobId} is disputed with its escrow reading held, but Stripe shows ${refundedCents}¢ refunded on its charge and no refund ledger row blocked the release. Nothing was transferred; reconcile by hand.`,
            fields: { job_id: jobId, refunded_cents: refundedCents, payment_intent: captureResult.paymentIntentId },
          });
          return new Response(JSON.stringify({
            error: "Stripe shows this charge was already refunded, so it can't also be released to the Helpr. Nothing was moved; this dispute needs manual reconciliation.",
            alreadyMoved: true,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
        }
      } catch (chargeErr) {
        await releaseDisputeSettlementClaim(supabaseAdmin, jobId, releaseClaim.claim);
        console.error(`[create-payment] admin_release_dispute: charge refund check failed for job ${jobId}:`, chargeErr);
        return new Response(JSON.stringify({
          error: "Couldn't confirm with Stripe that this charge hasn't been refunded. No money was moved — try again.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
      }

      // ── Stripe, inside the claim: a transfer for this job with no ledger row? ──
      // transferToHelper's duplicate guard reads payout_transfers only. A
      // transfer that left Stripe without its row — a split leg whose ledger
      // write failed, an earlier release killed after Stripe answered — is
      // invisible to it, and this action's own idempotency key then made a
      // SECOND transfer. Reachable once a person clears a stuck claim or
      // supersedes a decision (round 4 review of H2/M1). Every transfer for a
      // job carries `transfer_group: job_<id>`; a live one the ledger does not
      // record refuses. One the ledger DOES record is the idempotent re-run
      // (transferToHelper skips it). Fails closed.
      try {
        const prior = await stripe.transfers.list({ transfer_group: `job_${jobId}`, limit: 100 });
        const live = ((prior?.data ?? []) as Array<{ id: string; amount?: number; amount_reversed?: number }>)
          .filter((t) => Number(t.amount ?? 0) - Number(t.amount_reversed ?? 0) > 0);
        if (live.length > 0) {
          const { data: ledgerRows, error: ledgerErr } = await supabaseAdmin
            .from("payout_transfers")
            .select("stripe_transfer_id, status")
            .eq("job_id", jobId)
            .in("status", ["pending", "paid"]);
          if (ledgerErr) throw ledgerErr;
          const known = new Set(((ledgerRows ?? []) as Array<{ stripe_transfer_id: string | null }>).map((r) => r.stripe_transfer_id));
          const ghost = live.find((t) => !known.has(t.id));
          if (ghost) {
            await releaseDisputeSettlementClaim(supabaseAdmin, jobId, releaseClaim.claim);
            console.error(`[create-payment] admin_release_dispute REFUSED for job ${jobId}: Stripe shows transfer ${ghost.id} with no ledger row`);
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "critical",
              title: "Quick Release refused — a transfer for this job is at Stripe with no ledger row",
              message: `Job ${jobId} is disputed with its escrow reading held, but Stripe shows transfer ${ghost.id} in its transfer group and payout_transfers does not record it. Nothing was transferred; reconcile by hand.`,
              fields: { job_id: jobId, transfer_id: ghost.id, amount_cents: Number(ghost.amount ?? 0) },
            });
            return new Response(JSON.stringify({
              error: "Stripe shows a payout for this job that our ledger doesn't record, so another one can't be sent. Nothing was moved; this dispute needs manual reconciliation.",
              alreadyMoved: true,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
          }
        }
      } catch (transferListErr) {
        await releaseDisputeSettlementClaim(supabaseAdmin, jobId, releaseClaim.claim);
        console.error(`[create-payment] admin_release_dispute: prior-transfer check failed for job ${jobId}:`, transferListErr);
        return new Response(JSON.stringify({
          error: "Couldn't confirm with Stripe that no payout already left for this job. No money was moved — try again.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
      }

      if (job.helper_id && helperPayout > 0) {
        try {
          // Throws on transfer/ledger failure → outer catch returns 500 and the
          // job stays disputed (never silently flipped to released below).
          await transferToHelper(
            stripe, supabaseAdmin, job.helper_id, helperPayout, captureResult.paymentIntentId, job.id,
            feeAmt / dpHelpersCount, user.id,
            () => stampDisputeSettlementClaim(supabaseAdmin, jobId, releaseClaim.claim),
          );
        } catch (transferErr) {
          // Hand the claim back ONLY when no money left. transferToHelper also
          // throws AFTER a transfer went out (its ledger write failed), and
          // releasing then was the double spend the claim exists to stop: no
          // ledger row, a free claim, and the admin's follow-up Quick Refund
          // walked straight in (found building on the review round). A
          // money-moved failure keeps the claim, which — stamped at its money
          // step — never expires into another caller (claim_dispute_settlement:
          // stuck_release) and pages ops with the statement to clear it once
          // reconciled.
          if (!(transferErr as { moneyMoved?: boolean } | null)?.moneyMoved) {
            await releaseDisputeSettlementClaim(supabaseAdmin, jobId, releaseClaim.claim);
          }
          throw transferErr;
        }
      }

      // Transfer already sent — a failed flip would leave the job "disputed"
      // (permanently blocked by release-payout's dispute guard) while the
      // notifications below assert it was resolved. Fail loudly instead.
      //
      // dispute_status + dispute_resolved_at are written HERE, not left behind.
      // Without them `trg_sync_has_active_dispute` (20260831010000) keeps
      // deriving has_active_dispute = true — its predicate is
      // "dispute_status is neither 'resolved' nor 'auto_resolved'" — and
      // can_review_job's `(has_active_dispute = false OR dispute_resolved_at IS
      // NOT NULL)` clause then never passes. A Quick Release used to leave the
      // job PERMANENTLY un-reviewable by both parties: the one job in the whole
      // app where a review matters most, and neither side could ever leave one.
      const disputeResolvedAt = new Date().toISOString();
      const { data: releaseUpdated, error: releaseUpdateErr } = await supabaseAdmin.from("jobs").update({
        status: "completed",
        payment_status: "released",
        helper_fee_percent: disputeFeePercent,
        platform_fee_amount: feeAmt,
        dispute_status: "resolved",
        dispute_resolved_at: disputeResolvedAt,
      // .eq("status","disputed"): two Quick Release calls in flight together
      // both passed the read-time status check above. The transfer is
      // idempotent (payout_transfers guard + Stripe key dispute-release-<job>),
      // but the flip, the dispute-record close, the audit row and both notices
      // were not. Only the call whose UPDATE flips the row does those; the
      // other gets a clean alreadyResolved with no further side effects.
      }).eq("id", jobId).eq("status", "disputed").select("id");
      if (!releaseUpdateErr && releaseUpdated && releaseUpdated.length === 0) {
        const settled = await alreadyResolvedDispute(supabaseAdmin, jobId, "completed", "released");
        if (settled) return settled;
      }
      if (releaseUpdateErr || !releaseUpdated || releaseUpdated.length === 0) {
        console.error(`CRITICAL: dispute transfer sent for job ${jobId} but jobs.update to released failed — manual reconciliation needed:`, releaseUpdateErr ?? "matched 0 rows");
        return new Response(JSON.stringify({
          error: "transfer sent but job status update failed — manual reconciliation needed",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
      }

      // Close the formal dispute record too, with the real Stripe transfer id
      // and the real amount. Left open — as it was — the row keeps the job
      // trapped under `disputes_one_open_per_job_idx` (every future filing
      // merges into a settled dispute, and rpc_open_dispute's existing-dispute
      // branch re-freezes an already-paid job), and it stays one
      // `rpc_decide_dispute` call away from being handed to
      // execute-dispute-split. Marking it executed is what makes that executor
      // refuse instead of trying to move money that has already gone.
      //
      // The recorded amount comes from the LEDGER, not from `helperPayout`.
      // The transfer above is conditional (`job.helper_id && helperPayout > 0`),
      // so on the no-transfer path nothing moved — and writing a computed
      // `Math.round(helperPayout * 100)` there would record a "received" figure
      // against escrow that never left. `null` means "not recorded here", which
      // is the truth; a number would be a claim.
      const settledTransfer = await lookupSettledTransfer(supabaseAdmin, jobId, job.helper_id);
      await closeDisputeRecordForJob(supabaseAdmin, {
        jobId,
        outcome: "helper",
        decidedBy: user.id,
        decisionText: "Resolved by admin Quick Release: the full escrow was released to the helpr.",
        helperCents: settledTransfer.amountCents,
        transferId: settledTransfer.transferId,
      });

      // An admin moving money leaves a trail. `admin_refund_general` already
      // writes one for its (less consequential) refunds; the two dispute
      // actions — the ones that decide who keeps the escrow — wrote nothing at
      // all, so /admin?view=audit showed no record of a resolved dispute.
      await logAdminMoneyAction(supabaseAdmin, {
        adminId: user.id,
        action: "dispute_admin_release",
        jobId,
        details: {
          job_title: job.title,
          customer_id: job.customer_id,
          helper_id: job.helper_id,
          budget: job.budget,
          // Both figures: what this call computed, and what the ledger says
          // actually moved. They agree on the normal path; when they don't
          // (a re-run hitting transferToHelper's idempotency guard after the
          // helper's tier changed) the audit trail shows the discrepancy
          // instead of quietly picking one.
          helper_payout_cents: settledTransfer.amountCents,
          computed_helper_payout_cents: Math.round(helperPayout * 100),
          platform_fee_cents: Math.round((feeAmt / dpHelpersCount) * 100),
          helper_fee_percent: disputeFeePercent,
          payment_intent_id: captureResult.paymentIntentId,
          stripe_transfer_id: settledTransfer.transferId,
          dispute_resolved_at: disputeResolvedAt,
        },
      });

      // Notify both parties
      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Dispute resolved — payment released!",
          message: `The dispute on "${job.title}" has been resolved in your favor. $${formatPayoutDollars(helperPayout)} has been transferred.`,
          type: "payment", link: "/profile?tab=earnings",
        });
      }
      await supabaseAdmin.from("notifications").insert({
        user_id: job.customer_id,
        title: "Dispute resolved",
        message: `The dispute on "${job.title}" has been resolved. Payment was released to the helpr.`,
        type: "info", link: `/my-posts?job=${job.id}`,
      });

      // Settled. The claim would expire on its own and the job is no longer
      // `disputed` so nothing could take it anyway, but leaving rows behind for
      // a lock that is finished with is how a lock table turns into a mystery.
      await releaseDisputeSettlementClaim(supabaseAdmin, jobId, releaseClaim.claim);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── ADMIN: Refund disputed payment to customer ───
    if (action === "admin_refund_dispute") {
      const { jobId } = body;
      if (!jobId) throw new PublicError("Missing jobId");

      const { data: isAdmin, error: adminRoleErr } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (adminRoleErr) console.error("[create-payment] admin_refund_dispute has_role check failed:", adminRoleErr.message);
      if (!isAdmin) throw new PublicError("Not authorized — admin only");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");

      // Same guard as admin_release_dispute: only a genuinely disputed job may
      // be resolved via this path. Non-dispute refunds go through
      // admin_refund_general (which intentionally accepts any state).
      if (job.status !== "disputed") {
        throw new PublicError(`Job is not under dispute (status: ${job.status}). Use a general refund for non-dispute cases.`);
      }

      // Refund the captured payment
      let paymentIntentId = job.stripe_payment_intent_id;
      if (!paymentIntentId && job.stripe_session_id) {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
        paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      }
      // A disputed job's escrow was always captured, so a missing payment intent
      // here is bad data. Without this guard the refund block is silently skipped
      // but the job is still flipped to payment_status="refunded" and the customer
      // receives a "Refund issued" notification — data corruption with $0 returned.
      // admin_release_dispute has this same guard (line ~816); keep them in sync.
      if (!paymentIntentId) throw new PublicError("No payment intent found for this job — cannot issue refund");
      // Hoisted so the dispute-record close below can record what actually went
      // back to the poster. 0 with a null id is the legitimate "the Stripe fee
      // consumed the whole capture" outcome, which the branch below alerts on.
      let disputeRefundId: string | null = null;
      let disputeRefundCents = 0;
      // Hoisted so the success path below can hand the claim back by token. It
      // is TAKEN inside the try (immediately before the Stripe call, after every
      // refusal that moves no money), but RELEASED after the flip, which is out
      // there.
      let refundClaimHeld: SettlementClaim | null = null;
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: ["latest_charge.balance_transaction"],
        });
        if (pi.status === "succeeded") {
            // The poster WON the dispute, so they get the budget + service fee
            // back — but Stripe's cut on the original capture is NOT returned on
            // a refund, so a full refund would leave the platform out-of-pocket
            // by that processing cost. Withhold ONLY that unavoidable Stripe fee
            // (never the service fee — the poster won the dispute), read from
            // the charge's own balance transaction so it's correct regardless of
            // payment method (card vs. Klarna/Affirm/Afterpay vs. ACH).
            const capturedCents = pi.amount_received ?? pi.amount;

            // A disputed job's escrow was always captured, so a non-positive or
            // NaN captured amount here is bad data — NEVER silently flip the job
            // to refunded on it. Abort loudly (awaited alert + throw) so the job
            // stays disputed for manual reconciliation instead of the poster
            // being marked refunded for $0 with no ledger trace.
            if (!Number.isFinite(capturedCents) || (capturedCents as number) <= 0) {
              await postSlackOpsAlert({
                kind: "money_at_risk",
                severity: "warning",
                title: "Dispute refund aborted — invalid captured amount",
                message:
                  "admin_refund_dispute could not compute a refund: the PaymentIntent's captured amount was missing or non-positive. No refund issued; job left disputed for manual review.",
                fields: {
                  job_id: jobId,
                  payment_intent: paymentIntentId,
                  captured_cents: String(capturedCents),
                },
              });
              throw new PublicError(
                `admin_refund_dispute: invalid captured amount (${capturedCents}) for job ${jobId} — aborting, no refund issued.`,
              );
            }

            const nonRefundableCents = actualOrEstimatedFeeCents(pi, capturedCents);
            const refundAmount = capturedCents - nonRefundableCents;
            // A retried/double-clicked call within Stripe's ~24h key lifetime
            // returns the original refund. After key expiry, a repeat attempt
            // is rejected by Stripe with charge_already_refunded — still loud.
            // Skip entirely if withholding consumes the whole capture (Stripe
            // rejects a $0 refund); the job still flips to refunded below.
            // Same claim as the release path, in the same place: immediately
            // before the Stripe call and after every refusal that moves no
            // money. OUTSIDE the `refundAmount > 0` test on purpose — the
            // `else` branch below moves no money but still flips the job to
            // cancelled/refunded, and a flip with no claim is exactly the state
            // a concurrent Quick Release cannot see.
            //
            // `return`, not `throw`: this sits inside the refund try/catch, and
            // a Response thrown here would be caught at the bottom of this
            // block, rethrown, and rendered by the generic handler as an opaque
            // 500 — turning "another admin is refunding this right now" into a
            // mystery over a dispute where money may already be moving. The
            // return exits `serve` and bypasses the catch entirely.
            const refundClaim = await claimDisputeSettlement(
              supabaseAdmin, jobId, "refund", user.id, "cancelled", "refunded",
            );
            if ("refusal" in refundClaim) return refundClaim.refusal;
            refundClaimHeld = refundClaim.claim;

            // ── Stripe, inside the claim: did a transfer for this job leave? ──
            // The pre-claim ledger check reads payout_transfers, and a Quick
            // Release whose transfer went out but whose ledger write failed —
            // or whose holder died after Stripe answered — left no row there.
            // Its claim sticks and pages, but once a person clears it this
            // refund walked in over a paid Helpr (lh-money-escrow round 3, H2).
            // Every transfer for a job carries `transfer_group: job_<id>`, so
            // ask Stripe. Before BOTH branches: the zero-refund branch below
            // still flips the job to refunded. Fails CLOSED.
            let liveTransfer: { id: string; amount?: number; amount_reversed?: number } | undefined;
            try {
              const prior = await stripe.transfers.list({ transfer_group: `job_${jobId}`, limit: 100 });
              liveTransfer = ((prior?.data ?? []) as Array<{ id: string; amount?: number; amount_reversed?: number }>)
                .find((t) => Number(t.amount ?? 0) - Number(t.amount_reversed ?? 0) > 0);
            } catch (listErr) {
              await releaseDisputeSettlementClaim(supabaseAdmin, jobId, refundClaim.claim);
              console.error(`[create-payment] admin_refund_dispute: transfers.list failed for job ${jobId}:`, listErr);
              return new Response(JSON.stringify({
                error: "Couldn't confirm with Stripe that no payout left for this job. No money was moved — try again.",
              }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
            }
            if (liveTransfer) {
              await releaseDisputeSettlementClaim(supabaseAdmin, jobId, refundClaim.claim);
              console.error(`[create-payment] admin_refund_dispute REFUSED for job ${jobId}: Stripe shows transfer ${liveTransfer.id} for this job`);
              await postSlackOpsAlert({
                kind: "money_at_risk",
                severity: "critical",
                title: "Quick Refund refused — a transfer for this job already left Stripe",
                message: `Job ${jobId} is disputed with its escrow reading held, but Stripe shows transfer ${liveTransfer.id} in its transfer group and no payout ledger row blocked the refund. Nothing was refunded; reconcile by hand.`,
                fields: { job_id: jobId, transfer_id: liveTransfer.id, amount_cents: Number(liveTransfer.amount ?? 0) },
              });
              return new Response(JSON.stringify({
                error: "Stripe shows a payout to the Helpr already left for this job, so it can't also be refunded. Nothing was moved; this dispute needs manual reconciliation.",
                alreadyMoved: true,
              }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
            }

            if (refundAmount > 0) {
              // Stamp at the money step (round 3, M2): only a claim that
              // reached its Stripe call may stick; refund nothing without it.
              if (!(await stampDisputeSettlementClaim(supabaseAdmin, jobId, refundClaim.claim))) {
                await releaseDisputeSettlementClaim(supabaseAdmin, jobId, refundClaim.claim);
                return new Response(JSON.stringify({
                  error: "The settlement lock on this dispute was lost before the refund — no money was moved. Refresh and try again.",
                }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
              }
              let refund;
              try {
                refund = await stripe.refunds.create(
                  { payment_intent: paymentIntentId, amount: refundAmount },
                  { idempotencyKey: `refund-dispute-${jobId}` },
                );
              } catch (refundErr) {
                // Give the claim back ONLY when Stripe DEFINITELY refused. A
                // timeout, a dropped connection or a Stripe 5xx may have created
                // the refund anyway (round-4 review, the mirror of the transfer
                // rule in transferToHelper): the stamped claim then sticks and
                // pages, instead of handing a Quick Release a clean claim.
                // NOT StripeIdempotencyError (round-5 review, LOW-2): it means a
                // request with this key already reached Stripe, so the refund
                // may exist.
                const type = String((refundErr as { type?: string } | null)?.type ?? "");
                const definite = [
                  "StripeInvalidRequestError",
                  "StripeCardError",
                  "StripePermissionError",
                  "StripeAuthenticationError",
                ].includes(type);
                if (definite) await releaseDisputeSettlementClaim(supabaseAdmin, jobId, refundClaim.claim);
                throw refundErr;
              }
              disputeRefundId = refund.id;
              disputeRefundCents = Math.round(Number(refund.amount ?? refundAmount));
              await recordRefund(supabaseAdmin, {
                refund,
                jobId,
                customerId: job.customer_id,
                paymentIntentId,
                source: "admin_refund_dispute",
                isPartial: nonRefundableCents > 0,
                reason: "dispute refund (minus non-refundable Stripe processing fee)",
                initiatedByUserId: user.id,
              });
            } else {
              // Legitimate tiny capture fully consumed by the flat Stripe fee:
              // the poster genuinely gets $0 back and the job still flips to
              // refunded. No ledger row is written, so AWAIT the alert (a
              // fire-and-forget can be killed when the request returns) — it is
              // this money-relevant event's only durable trace.
              console.error(
                `[create-payment] admin_refund_dispute: refundAmount<=0 for job ${jobId} ` +
                  `(capturedCents=${capturedCents}, nonRefundableCents=${nonRefundableCents}) ` +
                  `— poster refunded $0.`,
              );
              await postSlackOpsAlert({
                kind: "custom",
                severity: "info",
                title: "Dispute resolved with $0 refund to poster",
                message:
                  "A dispute was resolved in the poster's favor but the Stripe processing fee consumed the whole capture, so nothing was returned. Verify this was intended.",
                fields: {
                  job_id: jobId,
                  payment_intent: paymentIntentId,
                  captured_cents: capturedCents,
                  non_refundable_cents: nonRefundableCents,
                  refund_amount: refundAmount,
                },
              });
            }
          } else {
            // A disputed job's escrow was captured, so a PaymentIntent that is
            // not "succeeded" here is an anomaly — don't silently mark the job
            // refunded (poster would get nothing with no signal). Abort loudly
            // (awaited alert + throw) and leave it disputed for manual review.
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "warning",
              title: "Dispute refund aborted — PaymentIntent not succeeded",
              message:
                `admin_refund_dispute found the PaymentIntent in status "${pi.status}" (expected "succeeded"). No refund issued; job left disputed for manual review.`,
              fields: {
                job_id: jobId,
                payment_intent: paymentIntentId,
                pi_status: pi.status,
              },
            });
            throw new PublicError(
              `admin_refund_dispute: PaymentIntent ${paymentIntentId} status is "${pi.status}", not "succeeded" — aborting, no refund for job ${jobId}.`,
            );
          }
        } catch (e) {
          console.error("[create-payment] admin_refund_dispute — refund error:", e);
          throw e;
        }

      // Refund is out — same fail-loud rule as admin_release_dispute above.
      // dispute_status/dispute_resolved_at for the same reason: without them
      // trg_sync_has_active_dispute keeps has_active_dispute = true on a job
      // whose dispute is over, which is a permanently-live dispute as far as
      // money-reconciliation's dispute checks and can_review_job are concerned.
      const refundResolvedAt = new Date().toISOString();
      const { data: refundUpdated, error: refundUpdateErr } = await supabaseAdmin.from("jobs").update({
        status: "cancelled",
        payment_status: "refunded",
        dispute_status: "resolved",
        dispute_resolved_at: refundResolvedAt,
      // .eq("status","disputed"): same race as admin_release_dispute. The refund
      // itself is idempotent (Stripe key refund-dispute-<job>, ledger upsert on
      // stripe_refund_id); the flip and everything after it run once.
      }).eq("id", jobId).eq("status", "disputed").select("id");
      if (!refundUpdateErr && refundUpdated && refundUpdated.length === 0) {
        const settled = await alreadyResolvedDispute(supabaseAdmin, jobId, "cancelled", "refunded");
        if (settled) return settled;
      }
      if (refundUpdateErr || !refundUpdated || refundUpdated.length === 0) {
        console.error(`CRITICAL: refund issued for disputed job ${jobId} but jobs.update to refunded failed — manual reconciliation needed:`, refundUpdateErr ?? "matched 0 rows");
        return new Response(JSON.stringify({
          error: "refund issued but job status update failed — manual reconciliation needed",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
      }

      // Same two closing writes as the release path: the formal dispute record,
      // and the audit trail.
      await closeDisputeRecordForJob(supabaseAdmin, {
        jobId,
        outcome: "poster",
        decidedBy: user.id,
        decisionText: "Resolved by admin Quick Refund: the escrow was refunded to the person who posted this job, less the non-refundable Stripe processing fee.",
        refundCents: disputeRefundCents,
        refundId: disputeRefundId,
      });

      await logAdminMoneyAction(supabaseAdmin, {
        adminId: user.id,
        action: "dispute_admin_refund",
        jobId,
        details: {
          job_title: job.title,
          customer_id: job.customer_id,
          helper_id: job.helper_id,
          budget: job.budget,
          refund_cents: disputeRefundCents,
          payment_intent_id: paymentIntentId,
          stripe_refund_id: disputeRefundId,
          dispute_resolved_at: refundResolvedAt,
        },
      });

      // Notify both parties
      await supabaseAdmin.from("notifications").insert({
        user_id: job.customer_id,
        title: "Dispute resolved — refund issued",
        message: `The dispute on "${job.title}" has been resolved in your favor. A refund has been issued.`,
        type: "payment", link: `/my-posts?job=${job.id}`,
      });
      if (job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Dispute resolved",
          message: `The dispute on "${job.title}" has been resolved. The person who posted it has been refunded.`,
          type: "info", link: `/my-jobs?job=${job.id}`,
        });
      }

      // Settled — same tidy-up as the release path.
      await releaseDisputeSettlementClaim(supabaseAdmin, jobId, refundClaimHeld);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── ADMIN: General refund (non-dispute) — admin discretion ───
    // Mirrors admin_refund_dispute but with neutral notification copy
    // for refunds outside of an active dispute (e.g., goodwill refund,
    // chargeback prevention, customer support resolution).
    if (action === "admin_refund_general") {
      // Accepts an optional `amountCents` for partial refunds. When omitted,
      // refunds the full captured amount and cancels the job (existing
      // behavior). When provided + less than the total, issues a partial
      // refund and leaves the job state untouched — useful for goodwill
      // adjustments, partial-completion settlements, etc.
      const { jobId, reason, amountCents } = body;
      if (!jobId) throw new PublicError("Missing jobId");

      const { data: isAdmin, error: adminRoleErr } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (adminRoleErr) console.error("[create-payment] admin_refund_general has_role check failed:", adminRoleErr.message);
      if (!isAdmin) throw new PublicError("Not authorized — admin only");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");

      // ── A disputed job is NOT a general refund ──────────────────────────
      // This action deliberately accepts any job state (goodwill refunds on
      // completed, released jobs are legitimate) and its flip below matches on
      // id alone. On a DISPUTED job that combination is the third door into the
      // release-vs-refund double spend: admin A's Quick Release transfers to the
      // Helpr under `dispute-release-<job>`, admin B fires a general refund
      // under `refund-general-<job>-full`, the keys are disjoint, both move, and
      // the unguarded flip overwrites completed/released with cancelled/refunded
      // — so the job row then disagrees with `payout_transfers` and the Helpr's
      // Earnings screen.
      //
      // Refused rather than claimed: the dispute actions exist for this, they
      // close the dispute record and write the audit row, and this one does
      // neither. An admin who genuinely wants the poster refunded out of a
      // dispute has a button for it.
      if (job.status === "disputed") {
        console.error(`[create-payment] admin_refund_general REFUSED on disputed job ${jobId} — use admin_refund_dispute`);
        return new Response(
          JSON.stringify({
            error: "This job is under dispute. Use Quick Refund on the dispute instead — it closes the dispute record and writes the audit trail, and a general refund would race it. No money was moved.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
        );
      }

      // Nor over a decided dispute whose split has not executed: that escrow is
      // the decision's, and a full refund here followed by "Retry settlement"
      // paid the split's legs on top (lh-money-escrow round 2). Fail closed.
      const generalSettlement = await checkUnsettledDispute(supabaseAdmin, jobId);
      if (generalSettlement.blocked) {
        return new Response(
          JSON.stringify({
            error: generalSettlement.readError
              ? "Couldn't check this job's dispute decision. No money was moved — try again."
              : "An admin decision on this job's dispute hasn't executed yet. Settle it with Retry settlement instead. No money was moved.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: generalSettlement.readError ? 503 : 409 },
        );
      }

      // Nor while the poster's cancel_escrow refund is in flight: two refunds
      // under disjoint keys on one charge, then two flips racing each other.
      if (job.payment_status === "cancelling") {
        return new Response(
          JSON.stringify({
            error: "This job's cancellation is refunding it right now. No money was moved — refresh in a minute.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
        );
      }

      // And whatever the job's state, a full refund may not follow a payout.
      // `payout_transfers` is the ledger of money that has already left to the
      // Helpr; refunding the poster in full on top of it spends the escrow
      // twice. A PARTIAL goodwill refund is still allowed — that is the
      // platform choosing to eat a cost, not the escrow moving twice.
      const wantsFullRefund = typeof amountCents !== "number";
      if (wantsFullRefund) {
        const alreadyPaidOut = await escrowAlreadyMovedTheOtherWay(supabaseAdmin, jobId, "refund");
        if (alreadyPaidOut) return alreadyPaidOut;
      }

      // MS-6: a provided `amountCents` is ALWAYS a partial refund that leaves
      // the job running; a full refund + cancellation happens ONLY when
      // `amountCents` is omitted — the same condition as `wantsFullRefund`
      // above, and the two must agree. The old `isPartial` compared the request
      // against `job.budget`, so a request for EXACTLY the budget was neither
      // refused (`> totalCents` was false) nor treated as partial (`< totalCents`
      // was false): it fell through to the full-refund branch, refunded the
      // WHOLE capture (budget + poster service fee + urgent fee + tax) AND
      // cancelled the job — and, because `wantsFullRefund` was also false there,
      // even skipped the escrow-already-moved guard. There was no amount an
      // admin could pass to refund exactly the budget as a partial. `isPartial`
      // is now the exact negation of `wantsFullRefund`, and the upper bound is
      // the ACTUAL captured amount (checked below, once the PaymentIntent is
      // retrieved), never `job.budget`.
      const requestedCents = typeof amountCents === "number" ? Math.round(amountCents) : null;
      if (requestedCents !== null && requestedCents <= 0) {
        throw new PublicError(`Invalid partial amount: ${requestedCents} cents (must be > 0)`);
      }
      const isPartial = requestedCents !== null;

      let paymentIntentId = job.stripe_payment_intent_id;
      if (!paymentIntentId && job.stripe_session_id) {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
        paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      }
      // Fail hard when no payment intent exists: the subsequent code marks the job
      // refunded and notifies the customer even if no Stripe refund was issued.
      // `admin_refund_dispute` already guards this way — align both paths.
      if (!paymentIntentId) {
        throw new PublicError("No payment intent found for this job — cannot issue refund. If the job was never paid, no Stripe refund is needed.");
      }
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.status === "succeeded") {
          // MS-6: bound a partial refund against what Stripe ACTUALLY captured
          // (budget + poster service fee + urgent fee + tax), not `job.budget`.
          // A partial can be up to the full capture; anything beyond it is an
          // over-refund and is refused. A partial EQUAL to the capture is still
          // a partial for a job whose escrow has NOT moved — it never cancels
          // the job (only an omitted `amountCents` does that).
          // capturedCents is only consulted for a PARTIAL (it is the ceiling and
          // the full-capture test below). A full refund sends no `amount` and
          // refunds the whole charge on Stripe's side, so it neither needs nor
          // reads this — keep these checks partial-only so a full refund on a PI
          // whose amount fields are absent stays unaffected.
          const capturedCents = Math.round(Number(pi.amount_received ?? pi.amount ?? 0));
          if (isPartial) {
            // Degenerate capture: a non-finite or non-positive captured amount
            // makes the ceiling test meaningless (`x > NaN` is always false, so
            // any partial would pass). `admin_refund_dispute` aborts on exactly
            // this (see its `Number.isFinite` guard); align both paths so a
            // garbage PaymentIntent never issues an unbounded partial refund.
            if (!Number.isFinite(capturedCents) || capturedCents <= 0) {
              await postSlackOpsAlert({
                kind: "money_at_risk",
                severity: "critical",
                title: "General refund aborted — captured amount unreadable",
                message: `admin_refund_general could not read a valid captured amount for job ${jobId} (captured=${String(capturedCents)}). No partial refund issued.`,
                fields: { job_id: jobId, payment_intent: paymentIntentId, captured_cents: String(capturedCents) },
              });
              throw new PublicError(`admin_refund_general: invalid captured amount (${capturedCents}) for job ${jobId} — aborting, no refund issued.`);
            }
            if (requestedCents! > capturedCents) {
              throw new PublicError(`Invalid partial amount: ${requestedCents} cents (captured ${capturedCents} cents)`);
            }
            // A partial equal to the FULL capture is a full refund in disguise:
            // it returns the entire charge to the poster. The full-refund branch
            // above refuses that whenever the Helpr has already been paid
            // (`escrowAlreadyMovedTheOtherWay` gated on `wantsFullRefund`),
            // because refunding the whole capture on top of a settled payout
            // spends the escrow twice. Raising the partial ceiling to the
            // capture (MS-6) must not open a door around that guard — so re-run
            // it here for the full-capture partial. Smaller goodwill partials
            // stay allowed (the platform choosing to eat a cost), as before.
            if (requestedCents! === capturedCents) {
              const partialAlreadyPaidOut = await escrowAlreadyMovedTheOtherWay(supabaseAdmin, jobId, "refund");
              if (partialAlreadyPaidOut) return partialAlreadyPaidOut;
            }
          }
          // Sequence number for the partial-refund idempotency key, derived
          // from Stripe's OWN refund history for this PaymentIntent.
          //
          // The key used to be salted with `Math.floor(Date.now()/600_000)`,
          // so a double-click that straddled the 10-minute boundary issued
          // TWO refunds against one charge. Counting existing refunds instead
          // removes wall-clock from the key entirely: a retry of the same
          // intent sees the same count and collapses onto one refund, while a
          // deliberate later partial sees an incremented count and correctly
          // gets its own key.
          const priorRefunds = await stripe.refunds.list({
            payment_intent: paymentIntentId,
            limit: 100,
          });
          const refundSeq = priorRefunds.data.length;

          const refund = await stripe.refunds.create({
            payment_intent: paymentIntentId,
            ...(isPartial ? { amount: requestedCents } : {}),
            metadata: {
              reason: reason || (isPartial ? "admin_partial_refund" : "admin_general_refund"),
              admin_user_id: user.id,
              partial: String(isPartial),
            },
          }, {
            // Full refund: deduped within Stripe's ~24h key lifetime; after
            // expiry a repeat is rejected with charge_already_refunded.
            // Partial: keyed on the refund sequence (see refundSeq above) so
            // retries collapse regardless of elapsed time, with no wall-clock
            // component that a slow retry can cross.
            idempotencyKey: isPartial
              ? `refund-general-${jobId}-${requestedCents}-seq${refundSeq}`
              : `refund-general-${jobId}-full`,
          });
          await recordRefund(supabaseAdmin, {
            refund,
            jobId,
            customerId: job.customer_id,
            paymentIntentId,
            source: "admin_refund_general",
            isPartial,
            reason: reason || null,
            initiatedByUserId: user.id,
          });
        } else {
          // PI not succeeded — no money was captured, so marking the job
          // "refunded" with no actual refund would notify the customer of
          // money they'll never receive. Abort loudly; mirrors
          // admin_refund_dispute's PI-status guard above.
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "warning",
            title: "General refund aborted — PaymentIntent not succeeded",
            message: `admin_refund_general found the PaymentIntent in status "${pi.status}" (expected "succeeded"). No refund issued; job left unchanged for manual review.`,
            fields: { job_id: jobId, payment_intent: paymentIntentId, pi_status: pi.status },
          });
          throw new PublicError(
            `admin_refund_general: PaymentIntent ${paymentIntentId} status is "${pi.status}", not "succeeded" — aborting, no refund for job ${jobId}.`,
          );
        }
      } catch (e) {
        console.error("[create-payment] admin_refund_general — refund error:", e);
        throw e;
      }

      // Only cancel the job + flip payment_status on a FULL refund. Partial
      // refunds leave the job state intact — the customer still owes the
      // remaining work or the helper still earned the unrefunded portion.
      if (!isPartial) {
        // Conditional on the state this call READ (race-class audit 2026-09-14,
        // deferred here from fa107a92f). Matched on id alone, this flip wrote
        // cancelled/refunded over whatever landed during the Stripe round-trips
        // — a dispute filed (open_dispute_as), a Quick Release that flipped the
        // job completed/released, a payout that settled — so the job row then
        // contradicted payout_transfers and the dispute record. Pinned to the
        // read status AND payment_status, zero rows is re-read: a concurrent
        // copy of this same full refund (one Stripe key, one refund) is this
        // call's outcome too; anything else is money that moved while the job
        // moved, and pages.
        let generalFlip = supabaseAdmin.from("jobs").update({
          status: "cancelled",
          payment_status: "refunded",
          cancellation_reason: reason ? `[ADMIN REFUND] ${reason}` : "[ADMIN REFUND] Issued by support",
          cancelled_at: new Date().toISOString(),
          cancelled_by: user.id,
        }).eq("id", jobId).eq("status", job.status);
        generalFlip = job.payment_status == null
          ? generalFlip.is("payment_status", null)
          : generalFlip.eq("payment_status", job.payment_status);
        let { data: generalRefundUpdated, error: generalRefundUpdateErr } = await generalFlip.select("id");
        if (!generalRefundUpdateErr && (!generalRefundUpdated || generalRefundUpdated.length === 0)) {
          const { data: nowJob } = await supabaseAdmin
            .from("jobs").select("id, status, payment_status").eq("id", jobId).maybeSingle();
          if (nowJob?.status === "cancelled" && nowJob?.payment_status === "refunded") {
            generalRefundUpdated = [{ id: nowJob.id }];
          } else {
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "critical",
              title: "General refund issued while the job changed state",
              message:
                `admin_refund_general refunded job ${jobId} in full, but the job moved ${job.status}/${job.payment_status ?? "null"} → ` +
                `${nowJob?.status ?? "?"}/${nowJob?.payment_status ?? "?"} during the refund, so it was NOT flipped to refunded. ` +
                "Check for a dispute or payout on it and reconcile by hand.",
              fields: { job_id: jobId, read: `${job.status}/${job.payment_status ?? "null"}`, now: `${nowJob?.status ?? "?"}/${nowJob?.payment_status ?? "?"}` },
            });
          }
        }
        if (generalRefundUpdateErr || !generalRefundUpdated || generalRefundUpdated.length === 0) {
          console.error(`CRITICAL: general refund issued for job ${jobId} but jobs.update to refunded failed — manual reconciliation needed:`, generalRefundUpdateErr ?? "matched 0 rows (state moved)");
          return new Response(JSON.stringify({
            error: "refund issued but job status update failed — manual reconciliation needed",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
        }
      }

      // Q76: this row used to be a bare insert whose error was dropped — a
      // refund that moved real money could leave no trail and nobody would
      // know. logAdminMoneyAction reads the row count and alerts on a miss.
      await logAdminMoneyAction(supabaseAdmin, {
        adminId: user.id,
        action: isPartial ? "job_admin_refund_partial" : "job_admin_refund",
        jobId,
        details: {
          reason: reason || null,
          job_title: job.title,
          customer_id: job.customer_id,
          helper_id: job.helper_id,
          budget: job.budget,
          partial_amount_cents: isPartial ? requestedCents : null,
          partial_amount_dollars: isPartial ? (requestedCents! / 100).toFixed(2) : null,
          payment_intent_id: paymentIntentId,
        },
      });

      const dollarAmount = isPartial
        ? `$${(requestedCents! / 100).toFixed(2)}`
        : `$${Number(job.budget).toFixed(2)}`;
      const customerMessage = isPartial
        ? `A partial refund of ${dollarAmount} has been issued for "${job.title}".${reason ? ` Reason: ${reason}` : ""} It should appear on your card in 5-10 business days.`
        : `A refund has been issued for "${job.title}".${reason ? ` Reason: ${reason}` : ""} It should appear on your card in 5-10 business days.`;

      await supabaseAdmin.from("notifications").insert({
        user_id: job.customer_id,
        title: isPartial ? "Partial refund issued" : "Refund issued",
        message: customerMessage,
        type: "payment",
        // A partial refund leaves the job running, so it has no single fixed
        // bucket — link the job and let Activity place it. (The full-refund
        // branch cancels the job, so `cancelled` is safe there, but `?job=`
        // says the same thing more directly.)
        link: `/my-posts?job=${job.id}`,
      });

      // Helper notification — only on full refund (job is cancelled). Partial
      // refunds don't change the helper's stake; if a partial-refund scenario
      // ever needs helper notification, send a separate manual message.
      if (!isPartial && job.helper_id) {
        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Job cancelled",
          message: `"${job.title}" was cancelled by support and refunded to the person who posted it.${reason ? ` Reason: ${reason}` : ""}`,
          // `?job=` — same shape as the poster half above, and as every
          // producer converted in migration
          // 20260831232514_notification_links_land_on_the_right_spot.sql.
          //
          // This was `/my-jobs?filter=not_selected`. Two things were wrong
          // with it. `not_selected` is a LEGACY filter key: the Activity strip
          // is five buckets now (needs_you / scheduled / waiting / done /
          // cancelled, activityFilters.ts), and legacy enum keys still work as
          // filter VALUES but have no chip — so the helper landed on a filter
          // that no chip showed as selected, on a list filtered by it. And an
          // explicit `?filter=` WINS over `?job=` resolution in Activity's
          // deep-link effect (`deepLinkHadFilter`), so it could not even be
          // rescued by also passing the job.
          //
          // A fixed `?filter=` can never be right from the producer side
          // anyway: which bucket a job sits in is a question about its LIVE
          // state, and the answer changes while the notification sits unread.
          // `?job=` lets Activity resolve the bucket at open time.
          type: "info", link: `/my-jobs?job=${job.id}`,
        });
      }

      return new Response(JSON.stringify({ success: true, refunded: true, partial: isPartial }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    throw new PublicError("Invalid action");
  } catch (error) {
    // Defensive logging: Supabase log API only surfaces status codes, not
    // response bodies. Without console.error, every 500 here would be
    // diagnosable only by reproducing the call. Same pattern shipped in
    // stripe-connect after that function had hours of opaque 500s.
    const err = error as Error & { type?: string; code?: string; statusCode?: number };
    console.error("[create-payment] 500 — full error:", {
      message: err.message,
      stripe_type: err.type,
      stripe_code: err.code,
      stripe_status: err.statusCode,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
    });
    // Client-safe fixed sentence — the raw Stripe/PostgREST text is in the
    // console.error above. Echoing err.message handed Stripe ids and schema
    // detail to the caller (EF-5; stripe-connect fixed the same on 2026-09-15).
    // It reaches people now: the clients read this body via
    // functionErrorMessage instead of supabase-js's "non-2xx" wrapper.
    return new Response(JSON.stringify({ error: publicErrorMessage(err, "We couldn't complete that payment step. Please try again in a moment.") }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});

// captureEscrowPayment and handleExpiredEscrow removed — immediate capture eliminates expiry risk

/**
 * Transfer funds to the helper's connected Stripe account.
 */
/**
 * Read back the settled payout for a job from the `payout_transfers` ledger —
 * the transfer id AND the amount that actually moved.
 *
 * Both halves matter. `transferToHelper` returns nothing, and it has two
 * success paths: a fresh `stripe.transfers.create`, and an early return when a
 * `payout_transfers` row already exists (its DB-level idempotency guard). On
 * that second path the caller's freshly-recomputed `helperPayout` is NOT what
 * moved — the fee is resolved from the helper's LIVE subscription tier, which
 * may have changed since the original transfer. Recording the computed figure
 * beside the real transfer id would put two disagreeing numbers on one row, so
 * the ledger's `amount_cents` wins whenever there is a row to read.
 *
 * Scoped to this helper and to transfers that are actually money: a `failed` or
 * `reversed` row, or another roster member's transfer on a group job, must
 * never be stamped onto the dispute record as its settlement.
 *
 * Best-effort: nulls cost the dispute record two reference fields and must
 * never turn a completed release into an error. The error is logged, not
 * dropped.
 */
async function lookupSettledTransfer(
  supabaseAdmin: any,
  jobId: string,
  helperId: string | null,
): Promise<{ transferId: string | null; amountCents: number | null }> {
  const empty = { transferId: null, amountCents: null };
  if (!helperId) return empty;
  const { data, error } = await supabaseAdmin
    .from("payout_transfers")
    .select("stripe_transfer_id, amount_cents, status")
    .eq("job_id", jobId)
    .eq("helper_id", helperId)
    .in("status", ["pending", "paid"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error(`[create-payment] lookupSettledTransfer — payout_transfers read failed for job ${jobId}:`, error);
    return empty;
  }
  const row = data?.[0];
  if (!row) return empty;
  const cents = Number(row.amount_cents);
  return {
    transferId: (row.stripe_transfer_id as string | undefined) ?? null,
    amountCents: Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : null,
  };
}

/**
 * Close the `public.disputes` record for a job whose escrow an admin has just
 * settled by hand, via the single writer `settle_dispute_record`
 * (20260901034758).
 *
 * Deliberately NON-FATAL. Every caller reaches this only AFTER the money has
 * moved and the job row is correct, so throwing here would turn a completed,
 * correct settlement into a 500 the admin reads as "it failed" — and they would
 * click again. The failure is loud instead (console + Slack), and
 * auto-resolve-disputes' orphan sweep closes the record on its next tick.
 */
async function closeDisputeRecordForJob(
  supabaseAdmin: any,
  args: {
    jobId: string;
    outcome: "helper" | "poster";
    decidedBy: string;
    decisionText: string;
    helperCents?: number | null;
    refundCents?: number | null;
    transferId?: string | null;
    refundId?: string | null;
  },
): Promise<void> {
  try {
    const { data: disputeId, error } = await supabaseAdmin.rpc("settle_dispute_record", {
      _job_id: args.jobId,
      _outcome: args.outcome,
      _decided_by: args.decidedBy,
      _decision_text: args.decisionText,
      _helper_cents: args.helperCents ?? null,
      _refund_cents: args.refundCents ?? null,
      _transfer_id: args.transferId ?? null,
      _refund_id: args.refundId ?? null,
    });
    if (error) {
      console.error(`[create-payment] settle_dispute_record failed for job ${args.jobId}:`, error);
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "warning",
        title: "Dispute settled but its record stayed open",
        message:
          "An admin resolved a dispute and the money moved, but the public.disputes row could not be closed. " +
          "The auto-resolve sweep will retry; until it does, the job cannot take a genuinely new dispute.",
        fields: {
          job_id: args.jobId,
          outcome: args.outcome,
          admin_id: args.decidedBy,
          db_error: error.message,
          db_error_code: (error as { code?: string }).code ?? "",
        },
      });
      return;
    }
    // A NULL id is legitimate: a dispute filed before `public.disputes` existed
    // has no record to close. It is not an error and not a silent no-op — it is
    // logged so a reader of the logs can tell the two apart.
    console.log(
      disputeId
        ? `[create-payment] closed dispute record ${disputeId} for job ${args.jobId} (${args.outcome})`
        : `[create-payment] job ${args.jobId} had no open disputes row to close`,
    );
  } catch (e) {
    console.error(`[create-payment] settle_dispute_record threw for job ${args.jobId}:`, e);
  }
}

/**
 * Write the `admin_audit_log` row for an admin action that moved escrow.
 *
 * Non-fatal for the same reason as above — the money is already gone, and a
 * 500 here would invite a second click — but never silent: a money movement
 * with no audit trail is exactly what an audit log exists to prevent, so a
 * failed write goes to Slack.
 */
async function logAdminMoneyAction(
  supabaseAdmin: any,
  args: { adminId: string; action: string; jobId: string; details: Record<string, unknown> },
): Promise<void> {
  try {
    // `.select("id")`: admin_audit_log HAS an id column, and an RLS refusal
    // returns `{ data: [], error: null }` — indistinguishable from success.
    const { data, error } = await supabaseAdmin
      .from("admin_audit_log")
      .insert({
        admin_id: args.adminId,
        action: args.action,
        target_type: "job",
        target_id: args.jobId,
        details: args.details,
      })
      .select("id");
    if (error || !data || data.length === 0) {
      console.error(
        `CRITICAL: admin_audit_log write failed for ${args.action} on job ${args.jobId}:`,
        error ?? "matched 0 rows",
      );
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "warning",
        title: "Admin money action left no audit trail",
        message: `An admin moved escrow (${args.action}) but the admin_audit_log row was not written.`,
        fields: {
          job_id: args.jobId,
          action: args.action,
          admin_id: args.adminId,
          db_error: error?.message ?? "insert matched 0 rows",
        },
      });
    }
  } catch (e) {
    console.error(`[create-payment] logAdminMoneyAction threw for job ${args.jobId}:`, e);
  }
}

/**
 * The losing side of a concurrent admin dispute resolution: its conditional
 * UPDATE matched 0 rows. If the committed row is already in the state THIS
 * action produces, answer 200 alreadyResolved — nothing else is written, no
 * notification, no audit row. Any other state returns null and the caller's
 * existing fail-loud path runs.
 */
/**
 * Has this job's escrow ALREADY moved, the other way?
 *
 * The claim is a mutex, not a settlement record: it says "no counterpart is in
 * flight right now", and says nothing about one that finished. That gap is
 * reachable. A Quick Release whose transfer succeeds and whose `jobs` flip then
 * fails deliberately leaves the job `disputed` and returns a CRITICAL 500 for
 * manual reconciliation; its stamped claim sticks and pages, and once a person
 * clears it the job still reads `disputed` and Quick Refund is handed a clean
 * claim on a charge whose escrow has already left. A handler killed between the
 * Stripe call and the flip leaves exactly the same evidence.
 *
 * So the durable invariant is the LEDGER, not the lock: a refund refuses on a
 * live payout row, a release refuses on a live refund row. This is the same
 * check `transferToHelper` already makes against `payout_transfers` before a
 * second transfer, generalised to the other direction.
 *
 * Fails CLOSED. A failed ledger read is indistinguishable from "nothing moved",
 * and that is the one guess that spends the escrow twice.
 */
async function escrowAlreadyMovedTheOtherWay(
  supabaseAdmin: any,
  jobId: string,
  action: "release" | "refund",
): Promise<Response | null> {
  const table = action === "release" ? "payment_refunds" : "payout_transfers";
  // `payment_refunds` has NO status column (20260704120000; verified live
  // 2026-09-14). A row there is written by recordRefund only AFTER Stripe
  // returned the refund, so its existence is the fact that matters. The first
  // draft of this filtered it `.in("status", …)`, which PostgREST answers with
  // a 400 — fail-closed below turned that into a 503 on EVERY Quick Release.
  // The mock store ignores filter columns, so no edge test could see it;
  // src/test/edgeFilterColumnContract.test.ts now checks every edge filter
  // column against the prod schema snapshot.
  let ledger = supabaseAdmin.from(table).select("id").eq("job_id", jobId);
  if (table === "payout_transfers") ledger = ledger.in("status", ["pending", "paid"]);
  const { data, error } = await ledger.limit(1);
  if (error) {
    console.error(`[create-payment] ${action}: ${table} ledger read failed for job ${jobId}:`, error.message);
    return new Response(
      JSON.stringify({ error: "Couldn't verify whether this escrow has already moved. No money was moved here — try again." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
    );
  }
  if (!data || data.length === 0) return null;
  console.error(
    `[create-payment] ${action} REFUSED for job ${jobId}: a ${action === "release" ? "refund" : "payout"} ledger row already exists — the escrow moved the other way.`,
  );
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "warning",
    title: "Dispute settlement refused — the escrow already moved the other way",
    message:
      `A ${action} was attempted on job ${jobId}, but ${table} already holds a live row for it. ` +
      "No money was moved. This job's dispute needs manual reconciliation: one side has already been paid.",
    fields: { job_id: jobId, attempted: action, ledger: table },
  });
  return new Response(
    JSON.stringify({
      error:
        action === "release"
          ? "This escrow was already refunded to the poster — it can't also be released. Nothing was moved; this dispute needs manual reconciliation."
          : "This escrow was already released to the Helpr — it can't also be refunded. Nothing was moved; this dispute needs manual reconciliation.",
      alreadyMoved: true,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
  );
}

/** What a successful claim hands back: the token that owns it. */
type SettlementClaim = { token: string | null };

/**
 * Win the right to move this job's escrow, or be told who already has it.
 *
 * Quick Release and Quick Refund on the SAME job at once was the last hole in
 * the dispute money paths (docs/OPEN.md, open since 2026-09-14). Both handlers
 * end in a conditional `UPDATE jobs … WHERE status = 'disputed'`, and that is
 * what made release-vs-release and refund-vs-refund safe — but it cannot make
 * release-vs-REFUND safe, because the Stripe step runs FIRST in both. The two
 * steps are a `transfers.create` and a `refunds.create` under different
 * idempotency keys, so neither one's guard can see the other: both moved real
 * money, then one won the flip and the other returned `alreadyResolved` over a
 * job that had paid the Helpr AND refunded the poster.
 *
 * `claim_dispute_settlement` is a primary-key INSERT, so exactly one concurrent
 * caller can win it and there is no read-then-write window to lose. It is taken
 * immediately before the Stripe call and released if that call throws — never
 * before, because the claim must not outlive an abort that moved no money.
 *
 * The TOKEN is what makes the release safe. A re-entrant same-action caller is
 * let through (`joined`) but gets no token, so its own cleanup cannot delete
 * the claim a different call's live Stripe request is standing on.
 *
 * Fails CLOSED. A claim RPC that errors is indistinguishable from "somebody
 * else holds it", and guessing wrong here spends money twice.
 *
 * Returns a Response to send back, or the claim to carry to the release.
 */
async function claimDisputeSettlement(
  supabaseAdmin: any,
  jobId: string,
  action: "release" | "refund",
  adminId: string,
  finalStatus: string,
  finalPaymentStatus: string,
): Promise<{ refusal: Response } | { claim: SettlementClaim }> {
  // The ledger check comes FIRST: a claim taken on a job whose escrow has
  // already gone the other way would be a lock held over a refusal.
  const alreadyMoved = await escrowAlreadyMovedTheOtherWay(supabaseAdmin, jobId, action);
  if (alreadyMoved) return { refusal: alreadyMoved };

  const { data: verdictRow, error } = await supabaseAdmin.rpc("claim_dispute_settlement", {
    _job_id: jobId,
    _action: action,
    _admin_id: adminId,
  });
  if (error) {
    // PGRST202 = the RPC is not deployed yet. Edge functions and migrations
    // deploy on separate workflows, so this function CAN reach prod first, and
    // for that gap both admin dispute buttons return 503. That is deliberate:
    // there is no fallback that still protects the money, and the honest answer
    // is to refuse rather than run unguarded. The other routes out of a dispute
    // (rpc_decide_dispute + execute-dispute-split, or the 72h sweep) still work.
    const code = (error as { code?: string }).code;
    console.error(`[create-payment] claim_dispute_settlement failed for job ${jobId} (${action}):`, error.message);
    return {
      refusal: new Response(
        JSON.stringify({
          error:
            code === "PGRST202"
              ? "The settlement lock isn't deployed yet — this dispute can't be resolved safely until it is. No money was moved."
              : "Couldn't take the settlement lock on this dispute. No money was moved — try again.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      ),
    };
  }

  const verdict = (verdictRow as { verdict?: string; token?: string } | null)?.verdict;
  const token = (verdictRow as { token?: string } | null)?.token ?? null;

  if (verdict === "claimed") return { claim: { token } };
  // Re-entrant same action (a double-click, two admins on the same button).
  // It used to be let through with no token: one Stripe key and one guarded
  // flip made the pair safe while the holder lived. But the joiner moved money
  // with no claim row of its own, so if the holder then died before its money
  // step its unstamped claim expired (round 4, M2) with the joiner's Stripe
  // call still in flight and nothing standing behind it (lh-money-escrow
  // round 3, M3). The holder settles; the joiner is told so and moves nothing.
  if (verdict === "joined") {
    return {
      refusal: new Response(
        JSON.stringify({
          error: action === "release"
            ? "This dispute is already being released to the Helpr — nothing more was done. Refresh to see the result."
            : "This dispute is already being refunded to the poster — nothing more was done. Refresh to see the result.",
          inProgress: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      ),
    };
  }

  if (verdict === "split_pending") {
    // A decided split has not executed. The admin's decision decides this
    // escrow; Quick Release / Quick Refund may not settle over it.
    return {
      refusal: new Response(
        JSON.stringify({
          error: "An admin has already decided this dispute and its split hasn't executed yet. Use Retry settlement on that decision instead. No money was moved.",
          splitPending: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      ),
    };
  }

  if (typeof verdict === "string" && verdict.startsWith("stuck_")) {
    // A dead holder's claim: it may have moved money with no ledger row. The
    // claim function has already paged ops with the reconcile-and-clear step.
    const holder = verdict.slice("stuck_".length);
    return {
      refusal: new Response(
        JSON.stringify({
          error: `An earlier ${holder === "split" ? "split execution" : holder} on this dispute stopped part-way and may have moved money. Ops has been paged; this dispute is locked until they reconcile it. No money was moved here.`,
          stuck: holder,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      ),
    };
  }

  if (verdict === "not_settleable") {
    // The job is disputed but its escrow is not held: cancel_escrow is
    // refunding it (`cancelling`), or it already went somewhere (cancelled,
    // refunded, released, chargeback). Moving money now is the double spend
    // the claim exists to stop, so refuse — loudly, because a disputed job in
    // that state needs a person to close its dispute record.
    const paymentStatus = String((verdictRow as { payment_status?: string } | null)?.payment_status ?? "unknown");
    console.error(`[create-payment] ${action} REFUSED for disputed job ${jobId}: payment_status=${paymentStatus} is not a held escrow`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Dispute action refused — the escrow is not held",
      message:
        `An admin ${action} on disputed job ${jobId} was refused: payment_status is ${paymentStatus}, so the escrow ` +
        "is being cancelled or has already moved. No money was moved; close this dispute by hand.",
      fields: { job_id: jobId, attempted: action, payment_status: paymentStatus },
    });
    return {
      refusal: new Response(
        JSON.stringify({
          error: paymentStatus === "cancelling"
            ? "The poster's cancellation is refunding this escrow right now, so it can't be released or refunded here. No money was moved — refresh in a minute."
            : `This escrow is no longer held (payment ${paymentStatus}), so it can't be released or refunded here. No money was moved — this dispute needs manual reconciliation.`,
          notSettleable: true,
          paymentStatus,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      ),
    };
  }

  if (verdict === "not_disputed") {
    // The 72h sweep got there first: completed / payout_pending /
    // auto_resolved. Correctly settled, just not by this admin — the first
    // draft read it as "left the queue unsettled" and paged money_at_risk over
    // a job that was fine (lh-money-escrow review, MEDIUM-3). A release reports
    // it resolved; a refund is told plainly the escrow went to the Helpr.
    const { data: nowJob, error: nowErr } = await supabaseAdmin
      .from("jobs").select("status, payment_status, dispute_status").eq("id", jobId).maybeSingle();
    if (!nowErr && nowJob?.dispute_status === "auto_resolved" && nowJob?.status === "completed" && nowJob?.payment_status === "payout_pending") {
      return {
        refusal: new Response(
          JSON.stringify(
            action === "release"
              ? { success: true, alreadyResolved: true, resolvedBy: "auto_resolve", message: "The 72-hour dispute timeout already released this escrow to the Helpr — nothing more was done." }
              : { error: "The 72-hour dispute timeout already settled this escrow to the Helpr (it pays out after the 24-hour hold), so it can't be refunded here. No money was moved.", resolvedBy: "auto_resolve" },
          ),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: action === "release" ? 200 : 409 },
        ),
      };
    }
    // NOT automatically a success. "Not disputed" also describes a job a
    // withdrawal just restored to `in_progress` with the escrow still held, and
    // telling the admin that was "already resolved" would retire it from the
    // queue with nobody paid. Defer to the verified check, which only says
    // resolved after re-reading the exact terminal pair.
    const settled = await alreadyResolvedDispute(supabaseAdmin, jobId, finalStatus, finalPaymentStatus);
    if (settled) return { refusal: settled };
    // Settled the OTHER way by the counterpart admin action (a Quick Release
    // landed before this Quick Refund, or vice versa). Correct and final, so a
    // clean 409 — not the "left the queue unsettled" money page, which would
    // fire on every crossed pair the claim just resolved correctly.
    const otherWay = action === "release"
      ? nowJob?.status === "cancelled" && nowJob?.payment_status === "refunded"
      : nowJob?.status === "completed" && nowJob?.payment_status === "released";
    if (!nowErr && otherWay) {
      return {
        refusal: new Response(
          JSON.stringify({
            error: action === "release"
              ? "This dispute was already settled by refunding the poster, so it can't also be released. No money was moved."
              : "This dispute was already settled by releasing the escrow to the Helpr, so it can't also be refunded. No money was moved.",
            settledOtherWay: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
        ),
      };
    }
    console.error(
      `[create-payment] ${action} on job ${jobId}: no longer disputed, but NOT settled either — the dispute left the queue with the escrow still held.`,
    );
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Dispute left the queue unsettled",
      message:
        `An admin ${action} on job ${jobId} found the job no longer disputed, but it has not settled to ` +
        `${finalStatus}/${finalPaymentStatus} either. The escrow may still be held with nobody paid.`,
      fields: { job_id: jobId, attempted: action },
    });
    return {
      refusal: new Response(
        JSON.stringify({
          error: "This job is no longer under dispute, but its payment hasn't settled either. No money was moved — refresh, and if it still looks wrong this one needs manual reconciliation.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      ),
    };
  }

  const other = String(verdict).replace("held_by_", "");
  console.log(`[create-payment] ${action} on job ${jobId} refused: a ${other} is already in flight`);
  // Every holder the claim table admits, by name. The first draft had two
  // branches, so a job held by the 72h sweep or by execute-dispute-split told
  // the admin "Another admin is refunding this escrow" — the wrong party AND
  // the wrong direction, on the one screen deciding which way money goes.
  const heldByCopy: Record<string, string> = {
    release: "Another admin is releasing this escrow to the Helpr right now.",
    refund: "Another admin is refunding this escrow to the poster right now.",
    split: "This dispute's decided split is being executed right now.",
    sweep: "The 72-hour dispute timeout is settling this job right now.",
  };
  return {
    refusal: new Response(
      JSON.stringify({
        error:
          `${heldByCopy[other] ?? "Another settlement is already moving this escrow."} ` +
          "No money was moved here — refresh to see the result.",
        heldBy: other,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
    ),
  };
}

/**
 * Hand the claim back. Release by TOKEN: a caller with no token owns nothing and
 * must free nothing, or a re-entrant loser's cleanup deletes the winner's claim
 * mid-transfer. Best-effort, retried once — an unstamped leftover expires after
 * the claim TTL; a stamped one sticks and pages, correctly.
 */
async function releaseDisputeSettlementClaim(
  supabaseAdmin: any,
  jobId: string,
  claim: SettlementClaim | null,
): Promise<void> {
  if (!claim?.token) return;
  // Retried once (round 3, M2). A claim left behind by one failed RPC locks
  // both admin buttons out of the dispute until it expires. An UNSTAMPED
  // leftover then expires quietly (it moved nothing); a stamped one pages,
  // correctly, because its holder reached a money step.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await supabaseAdmin.rpc("release_dispute_settlement_claim", {
      _job_id: jobId,
      _token: claim.token,
    });
    if (!error) return;
    console.error(`[create-payment] release_dispute_settlement_claim failed for job ${jobId} (attempt ${attempt}):`, error.message);
  }
}

/**
 * Stamp the claim at the money step (round 3, M2), immediately BEFORE the
 * Stripe call that moves money. Only a stamped claim sticks when its holder
 * dies (`stuck_*`, a critical page); an unstamped one moved nothing and
 * expires. Returns false when the stamp did not land — the claim is gone or
 * was never this caller's — and the caller must then move NO money.
 */
async function stampDisputeSettlementClaim(
  supabaseAdmin: any,
  jobId: string,
  claim: SettlementClaim | null,
): Promise<boolean> {
  if (!claim?.token) return false;
  const { data, error } = await supabaseAdmin.rpc("stamp_dispute_settlement_claim", {
    _job_id: jobId,
    _token: claim.token,
  });
  if (error) {
    console.error(`[create-payment] stamp_dispute_settlement_claim failed for job ${jobId}:`, error.message);
    return false;
  }
  return data === true;
}

async function alreadyResolvedDispute(
  supabaseAdmin: any,
  jobId: string,
  status: string,
  paymentStatus: string,
): Promise<Response | null> {
  const { data: current, error } = await supabaseAdmin
    .from("jobs").select("status, payment_status").eq("id", jobId).maybeSingle();
  if (error || !current) return null;
  if (current.status !== status || current.payment_status !== paymentStatus) return null;
  console.log(`[create-payment] dispute on job ${jobId} was already resolved (${status}/${paymentStatus}) by a concurrent call; no-op`);
  return new Response(JSON.stringify({
    success: true,
    alreadyResolved: true,
    message: "This dispute was already resolved — nothing more was done.",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
}

async function transferToHelper(
  stripe: any,
  supabaseAdmin: any,
  helperId: string,
  amount: number,
  paymentIntentId: string | null,
  jobId: string,
  platformFeeAmount = 0,
  initiatedByUserId: string | null = null,
  // Called immediately before `stripe.transfers.create`; the transfer is made
  // only if it resolves true. The dispute release stamps its settlement claim
  // here (round 3, M2), so every no-money exit above it — the profile read,
  // the ledger check, the charge link — leaves an unstamped claim.
  beforeTransfer?: () => Promise<boolean>,
) {
  // Get helper's connected account. Distinguish a READ ERROR from a missing
  // account so a transient failure doesn't send admins chasing "helper never
  // onboarded" when the truth is "the profiles read blipped".
  const { data: helperProfile, error: helperProfileErr } = await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id")
    .eq("user_id", helperId)
    .maybeSingle();
  if (helperProfileErr) {
    console.error(`[create-payment] transferToHelper — profile read failed for ${helperId}:`, helperProfileErr);
    throw new PublicError("Could not verify the helpr's payout account — please try again");
  }

  if (!helperProfile?.stripe_account_id) {
    throw new PublicError("Helpr must set up their payout account before payment can be released. Please ask the helpr to connect their payout account in their profile settings.");
  }

  // DB-level idempotency: if a payout ledger row already exists for this job
  // the money already went out — don't send a second transfer. A FAILED read
  // must fail closed: it is indistinguishable from "no prior transfer" and
  // proceeding could double-pay once the Stripe idempotency key expires.
  const { data: existingTransfer, error: existingTransferErr } = await supabaseAdmin
    .from("payout_transfers")
    .select("stripe_transfer_id, status")
    .eq("job_id", jobId)
    .in("status", ["pending", "paid"])
    .maybeSingle();
  if (existingTransferErr) {
    console.error(`[create-payment] transferToHelper — duplicate-transfer check failed for job ${jobId}:`, existingTransferErr);
    throw new PublicError("Could not verify payout status — please try again");
  }
  if (existingTransfer) {
    console.log(`Payout already exists for job ${jobId} (${existingTransfer.stripe_transfer_id}); skipping duplicate transfer.`);
    return;
  }

  try {
    const transferParams: any = {
      amount: Math.round(amount * 100), // Convert to cents
      currency: "usd",
      destination: helperProfile.stripe_account_id,
      metadata: { job_id: jobId, helper_id: helperId, initiated_by: "admin" },
      // The job's transfer group, the same `job_<id>` release-payout,
      // process-scheduled-payouts and the dispute split use. It is what lets a
      // Quick Refund ask Stripe, inside its claim, whether a transfer for this
      // job already left — the durable answer when this call's ledger write
      // failed or its holder died after Stripe answered (round 3, H2).
      transfer_group: `job_${jobId}`,
    };

    // Link the transfer to the source charge if we have one
    if (paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.latest_charge) {
          transferParams.source_transaction = pi.latest_charge;
        }
      } catch (e) {
        console.warn("Could not retrieve charge for transfer linking:", e);
      }
    }

    if (beforeTransfer && !(await beforeTransfer())) {
      // The settlement claim is no longer this caller's. No money moved, so
      // this is NOT moneyMoved: the caller hands back whatever it still holds.
      throw new PublicError("The settlement lock on this dispute was lost before the transfer — no money was moved. Refresh and try again.");
    }

    // Stripe-level idempotency: same dispute release = same transfer, so a
    // retry never double-pays even if the ledger write below failed first.
    let transfer;
    try {
      transfer = await stripe.transfers.create(transferParams, {
        idempotencyKey: `dispute-release-${jobId}`,
      });
    } catch (stripeErr) {
      // Only a DEFINITE refusal proves no transfer exists. A timeout, a dropped
      // connection or a Stripe 5xx may have created it anyway, and handing the
      // settlement claim back then let a Quick Refund take a clean claim over
      // an empty ledger and refund on top (lh-money-escrow review round 3, H2).
      // Anything not on this list keeps the claim: it sticks (stuck_release)
      // and pages ops to reconcile against Stripe.
      // NOT StripeIdempotencyError (round-5 review, LOW-5): it means a request
      // with this key already reached Stripe, so the transfer may exist.
      const type = String((stripeErr as { type?: string } | null)?.type ?? "");
      const definite = [
        "StripeInvalidRequestError",
        "StripeCardError",
        "StripePermissionError",
        "StripeAuthenticationError",
      ].includes(type);
      if (!definite) (stripeErr as { moneyMoved?: boolean }).moneyMoved = true;
      throw stripeErr;
    }
    console.log(`Transferred $${amount.toFixed(2)} to helper ${helperId} (transfer: ${transfer.id})`);

    // Insert as "paid" immediately — same pattern as release-payout and
    // process-scheduled-payouts. The transfer.created webhook fires within
    // milliseconds of stripe.transfers.create() returning. If the row is
    // inserted as "pending" and the webhook fires first, its UPDATE finds no
    // matching row and is a no-op; the row then lands as "pending" with no
    // future event ever re-firing to flip it to "paid", leaving it stuck in
    // the ledger indefinitely. Inserting "paid" upfront makes the webhook
    // UPDATE harmless — it overwrites the already-terminal value.
    const { error: ledgerErr } = await supabaseAdmin
      .from("payout_transfers")
      .insert({
        job_id: jobId,
        helper_id: helperId,
        stripe_transfer_id: transfer.id,
        stripe_account_id: helperProfile.stripe_account_id,
        amount_cents: Math.round(amount * 100),
        platform_fee_cents: Math.round(platformFeeAmount * 100),
        status: "paid",
        paid_at: new Date().toISOString(),
        initiated_by: "admin",
        initiated_by_user_id: initiatedByUserId,
        metadata: { source: "admin_release_dispute" },
      });
    if (ledgerErr && ledgerErr.code === "23505") {
      // A concurrent call for the same job may have got past the duplicate
      // check above at the same instant: Stripe's idempotency key hands both of
      // us the ONE transfer, and the other call's row records it. Quiet ONLY if
      // the live row is that very transfer. Anything else (a reversed row the
      // check above does not see, another payout path's different transfer)
      // means real money with no ledger row: fall through to the loud throw.
      const { data: liveRow, error: liveRowErr } = await supabaseAdmin
        .from("payout_transfers")
        .select("stripe_transfer_id")
        .eq("job_id", jobId)
        .eq("helper_id", helperId)
        .eq("stripe_transfer_id", transfer.id)
        .maybeSingle();
      if (!liveRowErr && liveRow?.stripe_transfer_id === transfer.id) {
        console.log(`[create-payment] transferToHelper — job ${jobId} ledger row for transfer ${transfer.id} already written by a concurrent call; not duplicating.`);
        return;
      }
    }
    if (ledgerErr) {
      // `moneyMoved`: the caller must NOT hand back its settlement claim — the
      // transfer is out and no ledger row says so.
      const sentErr = new Error(`transfer ${transfer.id} sent but ledger write failed — manual reconciliation needed: ${ledgerErr.message}`);
      (sentErr as Error & { moneyMoved?: boolean }).moneyMoved = true;
      throw sentErr;
    }
  } catch (e) {
    console.error(`Failed to transfer to helper ${helperId}:`, e);
    // Notify admin
    const { ids: transferAdminIds } = await loadAdminIds(supabaseAdmin, "create-payment.transferFailed");
    {
      for (const adminId of transferAdminIds) {
        await supabaseAdmin.from("notifications").insert({
          user_id: adminId,
          title: "Transfer failed",
          message: `Failed to transfer $${amount.toFixed(2)} to Helpr for job ${jobId}. Error: ${(e as Error).message}`,
          // admin_alert: the operator type the admin push->Slack mirror pages
          // on (docs/OPEN.md Q2 review, 2026-09-23). Was 'warning', which the
          // mirror no longer relays; the link names the job so a seed job's
          // failure goes to the digest.
          type: "admin_alert",
          link: `/admin?view=jobs&job=${jobId}`,
        });
      }
    }
    // Re-throw so the caller does NOT flip the job to 'released'. Fail closed:
    // the job stays disputed and an admin can retry once the cause is fixed.
    throw e;
  }
}

/**
 * Write a row to the payment_refunds ledger after a successful
 * stripe.refunds.create(). Best-effort by design: the refund has already left
 * Stripe and the job status has (or will) flip, so a ledger write failure must
 * NOT throw and turn a successful refund into a 500 the customer sees — it is
 * logged loudly instead so it can be reconciled. Upsert on stripe_refund_id so a
 * retried/replayed refund (same Stripe idempotency key → same refund id) updates
 * the one row rather than duplicating the ledger.
 */
async function recordRefund(
  supabaseAdmin: any,
  args: {
    refund: { id: string; amount?: number; currency?: string };
    jobId: string;
    customerId: string | null;
    paymentIntentId: string | null;
    source: string;
    isPartial?: boolean;
    reason?: string | null;
    initiatedByUserId: string | null;
  },
) {
  try {
    const { error } = await supabaseAdmin.from("payment_refunds").upsert({
      job_id: args.jobId,
      customer_id: args.customerId,
      stripe_refund_id: args.refund.id,
      stripe_payment_intent_id: args.paymentIntentId,
      amount_cents: Math.round(Number(args.refund.amount ?? 0)),
      currency: args.refund.currency ?? "usd",
      is_partial: args.isPartial ?? false,
      reason: args.reason ?? null,
      source: args.source,
      initiated_by_user_id: args.initiatedByUserId,
    }, { onConflict: "stripe_refund_id", ignoreDuplicates: true });
    if (error) {
      console.error(`[create-payment] recordRefund — ledger write failed for refund ${args.refund.id} (job ${args.jobId}); refund succeeded, reconcile manually:`, error);
      // The refund already left Stripe, so we never throw here — but a dropped
      // ledger row is a real Stripe↔ledger divergence that a human must
      // reconcile, so surface it to ops instead of leaving it in a Deno log.
      postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "warning",
        title: "Refund ledger write failed",
        message: `A Stripe refund succeeded but its payment_refunds row was not written. Reconcile manually.`,
        fields: {
          refund_id: args.refund.id,
          job_id: args.jobId,
          source: args.source,
          amount_cents: Math.round(Number(args.refund.amount ?? 0)),
          db_error: error.message,
        },
      });
    }
  } catch (e) {
    console.error(`[create-payment] recordRefund — unexpected error for refund ${args.refund.id} (job ${args.jobId}):`, e);
  }
}