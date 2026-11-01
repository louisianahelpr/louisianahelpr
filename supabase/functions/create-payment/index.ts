// seed-policy: pages for seed/E2E jobs too, on purpose. Every alert here is money
// that moved (or failed to move) in Stripe while the DB says otherwise, or a Stripe
// event that could not be settled: a platform failure whoever owns the job. The
// nightly money journeys on seed jobs are how this path is proven, so their failures
// are real signal (2026-09-22: "transfer failed" on seed jobs = the empty test
// balance, Q3). Seed-only noise is routed in the detectors, not here (docs/OPEN.md Q2).
import { serve } from "../_shared/buildStamp.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getHelperFeePercent, jobHelprCommissionDollars, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { HELPR_FLAT_FEE_CENTS, HELPR_FLAT_FEE_PERCENT, flatFeePercentOf, isGiveawayFixedPayJob } from "../_shared/helprFlatFee.ts";
import { actualOrEstimatedFeeCents, actualStripeFeeCents, netUrgentFeeDollars } from "../_shared/stripeFees.ts";
import { TIP_MAX_CENTS, TIP_MIN_CENTS, TIP_PAYMENT_METHOD_TYPES, tipChargeBreakdown } from "../_shared/tipFees.ts";
import { POSTER_SERVICE_FEE_PERCENT, setupFeeKeptCents, setupFeeKeptReason } from "../_shared/posterFees.ts";
import { cardCostFeeCents, chargeTaxCentsFor, checkoutChargeTaxCents, posterCancelKeptFeeCents, refundToPayerCents } from "../_shared/refundAmount.ts";
import { crewBlockFeeRefusal } from "../_shared/crewBlockFeeRead.ts";
import { jobFlatFeeTotalCents } from "../_shared/crewShares.ts";
import { POSTER_JOB_FEE_CENTS, POSTER_JOB_FEE_DESCRIPTION, isPosterFeeJob } from "../_shared/posterJobFee.ts";
import {
  JOBS_POSTER_FEE_SWITCH,
  JOB_CHECKOUT_PAYMENT_METHOD_TYPES,
  STALE_FEE_QUOTE_MESSAGE,
  feeQuoteRefusal,
  jobFeeModelFor,
  payInFourMethodsFor,
  posterFeePercentFor,
  serviceFeeCentsFor,
} from "../_shared/jobCheckout.ts";
import { featureEnabledForUser } from "../_shared/featureSwitch.ts";
import {
  CARD_HOLD_CHECKOUT_API_VERSION,
  CARD_HOLD_COPY,
  CARD_HOLD_SWITCH,
  captureCardHold,
  holdCheckoutPaymentMethodOptions,
  notifyHelprWaiting,
  readHold,
  refundInstantBookingWith,
  releaseCardHold,
} from "../_shared/cardHold.ts";
import { holdPlanFor, offSessionAllowed } from "../_shared/cardHoldPlan.ts";
import { endCapturedNotHired } from "../_shared/instantBookSweep.ts";

/**
 * Q1415 (b): what a release answers while an open ban settlement review holds
 * the job's money. Final (a retry cannot pass the review) and neutral (it
 * never says whose account is under review).
 */
const BAN_REVIEW_RELEASE_MESSAGE =
  "This job's payment is on hold while our team reviews it, so it can't be released right now. You don't need to do anything: we'll finish it once the review is done.";
import { isLaborTaxable, laborTaxCode, NONTAXABLE_TAX_CODE, salesTaxCeilingCents } from "../_shared/salesTax.ts";
import { loadAdminIds } from "../_shared/adminIds.ts";
import { getAppUrl, buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { formatExactDollars, payoutWithheldMetadata, roundPayoutDownCents } from "../_shared/money.ts";
import { payoutPromiseSentence, readPromisedPayout } from "../_shared/payoutPromise.ts";
import { helprFaultFeeCapCents, restoreHelprFaultFee, takeHelprFaultFee } from "../_shared/helprFaultFee.ts";
import { arrivalEstablished, arrivalGateMessage } from "../_shared/arrivalRule.ts";
import { checkUnsettledDispute } from "../_shared/unsettledDispute.ts";
import { COME_BACK_PENDING_MESSAGE, isRefundRequestHoldRefusal, refundComeBackPending, REFUND_REQUEST_RELEASE_MESSAGE } from "../_shared/refundRequestHold.ts";
import { PublicError, publicErrorMessage } from "../_shared/publicError.ts";
import { jobBudgetOutOfRange, urgentFeeOverCap, MAX_JOB_BUDGET_DOLLARS, MIN_JOB_BUDGET_DOLLARS, MAX_URGENT_FEE_DOLLARS } from "../_shared/jobBudgetLimits.ts";
import { threeDSecureOptions } from "../_shared/threeDSecure.ts";
import { payoutDayLabel, standardPayoutAtIso } from "../_shared/escrowTiming.ts";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import { louisianaToday } from "../_shared/louisianaDate.ts";
import { cancellationFeePercent, computeCancellationFee, helperIsCommitted, hoursUntilJob, jobLocalMidnightMs } from "../_shared/cancellationFee.ts";
import { posterCancelSplit } from "../_shared/posterCancelSplit.ts";
import { refundsSeriesVisitInFull } from "../_shared/seriesRefund.ts";
import { isTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts";
import { isDefinitiveStripeRefusal } from "../_shared/stripeRefusal.ts";
import { refundReasonWithKeptParts } from "../_shared/refundReason.ts";
import { TIP_WAITS_ON_ID_CODE, TIP_WAITS_ON_ID_MESSAGE, checkIdentityHold, checkPayoutHold, checkJobPayoutHold, IDENTITY_HOLD_MESSAGE, JOB_PAYOUT_HELD_MESSAGE, PAYOUT_HELD_CODE } from "../_shared/payoutHold.ts";
import { holdUnlessPayable, noteDestinationChargeRefused } from "../_shared/livePayoutHold.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { resolveStripeCustomer, StripeCustomerUnavailable } from "../_shared/stripeCustomer.ts";
import { clawBackReleasedPayout } from "../_shared/chargebackClawback.ts";
import { loadBanReviewUsers } from "../_shared/banReview.ts";
import { paymentMethodFromCharge, refundNoticeProblem, sendRefundNotice, type RefundNoticeInput } from "../_shared/refundNotice.ts";
import {
  giftCardStripeMode,
  jobMoneyMode,
  readJobParties,
  sessionIdMode,
  stripeModeForParties,
  stripeModeRefusedResponse,
  StripeModeRefused,
  stripeSecretKeyFor,
  type MoneyKind,
  type StripeMode,
} from "../_shared/stripeMode.ts";

/**
 * What each action does with a job's money (MoneyKind, _shared/stripeMode.ts).
 * NEW money needs every party in one mode. Money ALREADY taken runs where it
 * sits (the stored Checkout Session's mode): a payout also needs every payee
 * of that mode, a refund only ever returns it to the payer, so a real poster's
 * live escrow is refundable even with a test Helpr hired on it (lh-money-escrow
 * and lh-authz-rls reviews 2026-10-12, finding 1). An action not listed moves
 * no money on a job (revisions) and runs in the caller's own mode.
 */
const ACTION_MONEY_KIND: Record<string, MoneyKind> = {
  escrow: "new",
  tip: "new",
  recurring_visit: "new",
  release: "payout",
  admin_release_dispute: "payout",
  cancel_escrow: "refund",
  // Boards 66/172 slice 2: reads the job's own charge to quote a cancel (moves no money), so the charge's mode.
  cancel_quote: "refund",
  admin_refund_dispute: "refund",
  admin_refund_general: "refund",
  // Q2170: reads the fault refund on the job's own charge (moves no money), so the charge's mode.
  admin_bill_helpr_fault: "refund",
  // Q2399: the hire captures a hold already placed, where it sits (the stored
  // checkout's mode), and pays a Helpr later, so every payee shares that mode.
  capture_hold: "payout",
};
const STRIPE_MODE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which Stripe mode this request runs in (owner 2026-10-12; rules in
 * _shared/stripeMode.ts jobMoneyMode). The caller is the actor: a REAL caller
 * never counts beyond being a party (the owner, a real admin, settles a test
 * job in test mode); a TEST caller must be of the money's mode, so a test
 * account never moves live money (for the seed admin that holds while it is
 * enrolled: an admin can edit any profile, its own is_seed included).
 *
 * The job only counts for someone ON it (poster, Helpr, crew) or for an admin.
 * Anyone else naming a job id is answered in their OWN mode and then refused by
 * the action's own ownership check, so the answer never tells a stranger
 * whether a job belongs to a test account (no oracle).
 *
 * `jobId` is read exactly as the action reads it (the raw string): Postgres
 * accepts other spellings of a uuid, so a mode decided on a stricter parse than
 * the action's own read could be skipped (lh-authz-rls review, finding 2).
 * Throws StripeModeRefused; the top-level catch answers it.
 */
async function createPaymentStripeMode(
  // deno-lint-ignore no-explicit-any
  db: any,
  callerId: string,
  action: unknown,
  // deno-lint-ignore no-explicit-any
  body: any,
): Promise<StripeMode> {
  let jobId: string | null = typeof body?.jobId === "string" && body.jobId.length > 0 ? body.jobId : null;
  // recurring_visit's own handler refuses any paymentId that is not a
  // canonical uuid before it reads a row, so the same rule here reads the
  // same row it would. (A lookup, not an action dispatch: kept out of the
  // `if (action === …)` shape the handler's dispatch guard counts.)
  const visitPaymentId: string | null =
    action === "recurring_visit" && typeof body?.paymentId === "string" && STRIPE_MODE_UUID_RE.test(body.paymentId)
      ? body.paymentId
      : null;
  if (visitPaymentId) {
    const { data: visit, error: visitErr } = await db
      .from("recurring_visit_payments").select("parent_job_id, payer_id").eq("id", visitPaymentId).maybeSingle();
    if (visitErr) throw new StripeModeRefused("lookup_failed", `recurring_visit_payments read failed: ${visitErr.message}`);
    // Only the payer's own visit names a series; the action refuses anyone else's.
    jobId = visit?.payer_id === callerId && typeof visit?.parent_job_id === "string" ? visit.parent_job_id : null;
  }
  const kind = typeof action === "string" ? ACTION_MONEY_KIND[action] : undefined;
  if (!kind) return stripeModeForParties(db, [callerId]);
  let isAdmin = false;
  if (typeof action === "string" && action.startsWith("admin_")) {
    // A LOOKUP, not the gate: every admin_* action still checks has_role
    // itself before it moves money (and audits). Read as has_role's own body
    // reads it (user_roles, role 'admin'). Fail closed: an unreadable role must
    // not silently become "not an admin" (that admin would then be answered in
    // their own mode).
    const { data: roleRows, error: roleErr } = await db
      .from("user_roles").select("user_id").eq("user_id", callerId).eq("role", "admin");
    if (roleErr) throw new StripeModeRefused("lookup_failed", `admin role read failed: ${roleErr.message}`);
    isAdmin = Array.isArray(roleRows) && roleRows.some((r: { user_id?: string }) => r.user_id === callerId);
  }
  const job = await readJobParties(db, jobId);
  const jobCounts = isAdmin || job.partyIds.includes(callerId);
  if (!jobCounts) return stripeModeForParties(db, [callerId]);
  return jobMoneyMode(db, jobId, { kind, actorId: callerId, job });
}

/**
 * Q1324 (money review 2026-10-06): an account under an open ban settlement
 * review moves no money until an admin confirms or lifts it. Which side is
 * under review decides the answer, because the OTHER party must never learn a
 * review exists (lh-authz-rls review of fbdfa47c7):
 *   - the payer: refused with "contact support" (they know they are banned);
 *   - the Helpr being tipped: the exact payout-hold reply, which is what a
 *     held Helpr already gets (a Helpr under review also has a hold row).
 * Escrow funding does not check the Helpr: the money only reaches escrow, and
 * the database refuses its payout while the review is open.
 * A failed read refuses the payment (fail closed).
 */
async function underBanReview(
  // deno-lint-ignore no-explicit-any
  db: any,
  payerId: string,
  counterpartyId?: string | null,
): Promise<"payer" | "counterparty" | null> {
  const ids = [payerId, counterpartyId].filter((id): id is string => !!id);
  const lookup = await loadBanReviewUsers(db, ids);
  if (!lookup.ok) throw new Error(`ban review read failed: ${lookup.message}`);
  if (lookup.users.has(payerId)) return "payer";
  if (counterpartyId && lookup.users.has(counterpartyId)) return "counterparty";
  return null;
}
const PAYER_UNDER_REVIEW = "This payment can't go through right now. Please contact support.";

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

/** Job statuses that are settled: the escrow action never funds them (Q235 follow-up). */
const FUNDING_CLOSED_JOB_STATUSES = new Set(["completed", "cancelled"]);

/**
 * Q1862: where a cancelled escrow checkout returns. Post a Job is the default;
 * a quote checkout returns to its request page, /quotes/request/<uuid>. Any
 * other returnPath is refused (never used as a redirect). Returns the quote
 * request id, or null for the default; the caller spells each target as a
 * literal buildRedirectUrl path (src/test/deepLinkOneRouter.test.ts proves
 * every literal is a route App.tsx serves).
 */
const QUOTE_REQUEST_RETURN_PATH = /^\/quotes\/request\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function escrowCancelQuoteRequestId(returnPath: unknown): string | null {
  if (returnPath === undefined || returnPath === null) return null;
  const m = typeof returnPath === "string" ? QUOTE_REQUEST_RETURN_PATH.exec(returnPath) : null;
  if (m) return m[1];
  throw new PublicError("That page can't be used to come back from checkout.");
}

/**
 * Q1867: refuse to charge a job booked from an agreed quote at anything but
 * the accepted quote's price. Reads every quote request linked to the job and
 * its accepted quote; an unreadable table refuses the checkout.
 */
async function refuseQuoteJobPriceMismatch(
  // deno-lint-ignore no-explicit-any
  db: any,
  jobId: string,
  budget: unknown,
): Promise<void> {
  const { data: links, error: linkErr } = await db
    .from("job_quote_requests").select("id").eq("job_id", jobId).limit(5);
  if (linkErr) {
    console.error(`[create-payment] quote request read failed for job ${jobId}; refusing escrow:`, linkErr);
    throw new PublicError("Could not check this job's agreed quote. Please try again in a moment.");
  }
  const ids = ((links ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return;
  const { data: accepted, error: acceptedErr } = await db
    .from("job_quotes").select("price_cents").in("request_id", ids).eq("status", "accepted");
  if (acceptedErr) {
    console.error(`[create-payment] accepted quote read failed for job ${jobId}; refusing escrow:`, acceptedErr);
    throw new PublicError("Could not check this job's agreed quote. Please try again in a moment.");
  }
  const budgetCents = Math.round(Number(budget) * 100);
  const mismatch = ((accepted ?? []) as Array<{ price_cents: unknown }>).some((q) => Number(q.price_cents) !== budgetCents);
  if (mismatch) {
    console.error(`[create-payment] job ${jobId} budget ${budgetCents} != accepted quote price; refusing escrow`);
    throw new PublicError("This job's price doesn't match the quote you agreed, so it can't be paid for. Contact support.");
  }
}

/**
 * NOTIFICATION LINKS: `?job=<id>`, never a fixed `?filter=`.
 *
 * Every Activity notification this function writes carries the job id and lets
 * the page resolve the bucket at OPEN time (the deep-link effect in
 * src/components/job-card/JobListPage.tsx). A fixed `?filter=` can never be right from the
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
    // 401, not a thrown PublicError: the catch answers every PublicError 500,
    // which told an expired session "the charge broke" and to retry (Q255).
    if (!user?.email) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    // Q837: an unconfirmed-email caller is refused here, as Q807 refuses at
    // the table (that gate cannot see the caller behind a service-role write).
    const unconfirmedEmail = refuseUnconfirmedEmail(user, corsHeaders);
    if (unconfirmedEmail) return unconfirmedEmail;

    const body = await req.json();
    const isNative = isNativeRequest(body);
    const { action } = body;

    // Stripe mode (owner 2026-10-12, "Test mode for test accounts"): TEST when
    // every party to this payment is a test account, LIVE when none is, and
    // refused on a mix. Decided here from the database, never from the body:
    // the body only names WHICH job, and the job's own rows say who is on it.
    // See _shared/stripeMode.ts.
    const stripeMode = await createPaymentStripeMode(supabaseAdmin, user.id, action, body);
    const stripe = new Stripe(stripeSecretKeyFor(stripeMode), {
      apiVersion: "2025-08-27.basil",
    });

    // One wallet (Q2139): the payer's ONE stored Stripe customer in this mode
    // (_shared/stripeCustomer.ts), resolved only by the actions that open a
    // Checkout page for the caller (escrow, its shortfall, tip, recurring
    // visit). It used to be `customers.list({ email, limit: 1 })`: an
    // arbitrary customer on that address, which can belong to a deleted member
    // whose email was reused. A member who paid before the wallet existed has
    // their old customer adopted by its exact metadata.supabase_user_id tag
    // (create-payment always set it), never by email, so a card they saved
    // stays theirs.
    let walletCustomerId: string | null = null;
    const payerWalletCustomer = async (): Promise<string> =>
      walletCustomerId ??= await resolveStripeCustomer(supabaseAdmin, stripe, user, stripeMode, { adoptTagged: true });

    // ─── ESCROW: Create checkout with manual capture ───
    if (action === "escrow") {
      const { jobId, saveCardForFuture, giftCardId } = body;
      if (!jobId) throw new PublicError("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");
      if (job.customer_id !== user.id) throw new PublicError("Not authorized");
      if (await underBanReview(supabaseAdmin, user.id)) throw new PublicError(PAYER_UNDER_REVIEW);

      // ─── A settled job is never funded (Q235 follow-up) ───
      // Checked BEFORE the payment_status gate so a poster retrying a closed
      // job reads why, not "already processed". A completed or cancelled job,
      // or one whose dispute an admin has decided, is settled: rpc_settle_dispute_without_payment closes a
      // decided dispute on an unfunded job as moving nothing, and money taken
      // afterwards would sit in escrow that no sweep pages and no path pays.
      // The RPC also moves payment_status to 'cancelled', and stampSession's
      // conditional write carries the same status guard, so a checkout minted
      // just before the close is never recorded or returned. FAIL CLOSED on an
      // unreadable dispute table.
      if (FUNDING_CLOSED_JOB_STATUSES.has(String(job.status))) {
        throw new PublicError("This job is closed, so it can no longer be paid for.");
      }
      const { data: decidedDisputes, error: decidedErr } = await supabaseAdmin
        .from("disputes")
        .select("id")
        .eq("job_id", jobId)
        .eq("status", "decided")
        .limit(1);
      if (decidedErr) {
        console.error(`[create-payment] decided-dispute read failed for job ${jobId}; refusing escrow:`, decidedErr);
        throw new PublicError("Could not check this job's dispute status. Please try again in a moment.");
      }
      if (decidedDisputes && decidedDisputes.length > 0) {
        throw new PublicError("This job's dispute has been decided, so it can no longer be paid for.");
      }

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
      // Same for the urgent bonus ($250 since Q210(c)): the clamp below would
      // quietly charge less than the job says, so refuse instead.
      if (urgentFeeOverCap(job.is_urgent, job.urgent_fee)) {
        throw new PublicError(
          `The urgent bonus can be at most $${MAX_URGENT_FEE_DOLLARS.toLocaleString("en-US")}. Post the job again with a smaller bonus.`,
        );
      }

      // The server-authoritative urgent bonus (see "urgent fee is recomputed,
      // never trusted" in create-payment.test.ts); hoisted here so the fee-model
      // stamp below prices the flat fee on the same budget + bonus.
      const URGENT_FEE_FLOOR_CENTS = 500;
      const URGENT_FEE_CEILING_CENTS = MAX_URGENT_FEE_DOLLARS * 100;
      const storedUrgentFeeCents = Math.round((job.urgent_fee ?? 0) * 100);
      const urgentFeeCents = job.is_urgent
        ? Math.min(
            Math.max(storedUrgentFeeCents, URGENT_FEE_FLOOR_CENTS),
            URGENT_FEE_CEILING_CENTS,
          )
        : 0;

      // ─── Fee model of THIS checkout (owner 2026-10-18, behind the switch) ───
      // The poster-fee model (poster pays 5% + 70c, or 9% + 70c for Pay in 4;
      // the Helpr keeps 100%) applies when the jobs_poster_fee switch is on for
      // this poster, a gift-funded checkout included (the gift pays the job
      // price + fee first, redeem_gift_card 20261018031451) and a recurring
      // series (this checkout pays the first visit + its fee; every later
      // visit is charged its own fee by charge-recurring-visits).
      // A switch read error is OFF (featureEnabledForUser fails closed), so the
      // checkout stays on the flat model it charges today.
      //
      // Decided BEFORE the previous Checkout Session is retired below, so a
      // stale app's refused tap never expires the poster's live checkout
      // (lh-money-escrow review of slice 3a, #3).
      //
      // Stale-client protection: the request must carry the model and the
      // amounts the app showed (feeQuoteRefusal). An app built before the
      // change sends no quote and is refused on the poster-fee model, so no
      // poster is charged a total the app never showed them.
      const posterFeeSwitchOn = await featureEnabledForUser(supabaseAdmin, JOBS_POSTER_FEE_SWITCH, user);
      const feeModel = jobFeeModelFor({
        switchOn: posterFeeSwitchOn,
      });
      const isPosterFee = feeModel === "poster";
      const payInFour = body?.payInFour === true ||
        (typeof body?.feeQuote === "object" && body?.feeQuote !== null && body.feeQuote.payInFour === true);
      if (payInFour && !isPosterFee) throw new PublicError(STALE_FEE_QUOTE_MESSAGE);
      // A gift pays first and any rest is one card/bank checkout: Pay in 4
      // (9% + 70c) never prices a gift-funded job.
      if (payInFour && giftCardId) throw new PublicError("Pay in 4 can't be combined with a gift card. Choose card or bank instead.");
      // Q1905 (owner 2026-10-21): a gift bought with real money never pays
      // for a test job. A real buyer's gift stays LIVE even when its recipient
      // is a test account (Q1750), and a test job pays out on the TEST key, so
      // the live money would sit in the platform's balance with nobody paid.
      // Both ways (lh-money-escrow review of Q1905 #1): a sandbox gift never
      // pays for a real job either (a leftover or restored credit of an
      // account later un-enrolled would otherwise fund a live payout). Checked
      // before anything is stamped or redeemed; a gift whose mode cannot be
      // read is refused too.
      if (giftCardId) {
        const gift = await giftCardStripeMode(supabaseAdmin, String(giftCardId), user.id);
        if (!gift.ok || gift.mode !== stripeMode) {
          console.warn(`[create-payment] gift ${giftCardId} (${gift.ok ? gift.mode : gift.reason}) refused on ${stripeMode} job ${jobId}`);
          throw new PublicError(
            gift.ok
              ? gift.mode === "live"
                ? "A gift card bought with real money can't pay for a test job. Pay with a card instead."
                : "A test gift card can't pay for a real job. Pay with a card instead."
              : gift.reason === "unreadable"
                ? "Could not check this gift card. Please try again."
                : gift.reason === "not_yours"
                  // redeem_gift_card's own wording for someone else's gift.
                  ? "This gift is not yours to redeem"
                  : "This gift card can't be used here. Contact support.",
          );
        }
      }
      // A series charges every later visit to a saved card, and Pay in 4 saves
      // none (the same test charge-recurring-visits uses to find a series parent).
      if (payInFour && job.recurrence_days != null) throw new PublicError("Pay in 4 isn't available for a repeating job. Choose card or bank instead.");
      const jobPriceCents = Math.round(Number(job.budget) * 100) + urgentFeeCents;
      const quoteRefusal = feeQuoteRefusal(body?.feeQuote, { model: feeModel, payInFour, jobPriceCents });
      if (quoteRefusal) {
        console.warn(`[create-payment] refusing escrow for job ${jobId}: fee quote ${JSON.stringify(body?.feeQuote ?? null)} does not match model=${feeModel} payInFour=${payInFour} price=${jobPriceCents}`);
        throw new PublicError(quoteRefusal);
      }
      const posterFeePercent = posterFeePercentFor(payInFour);
      const posterFeeCents = serviceFeeCentsFor(feeModel, jobPriceCents, payInFour);
      // Pay in 4 only where a provider takes the whole charge (fee, $2 setup
      // and the tax ceiling included, so Checkout can never exceed it).
      const payInFourMethods = payInFour
        ? payInFourMethodsFor(jobPriceCents + posterFeeCents + 200 + salesTaxCeilingCents(jobPriceCents + posterFeeCents, job.category))
        : [];
      if (payInFour && payInFourMethods.length === 0) {
        throw new PublicError("Pay in 4 isn't available for this amount. Choose card or bank instead.");
      }

      // ─── A job booked from an agreed quote is charged the agreed price (Q1867) ───
      // The database already refuses a client change to a quote job's budget
      // (trg_lock_quote_booked_job_terms). This is the charge-time twin, for any
      // future server path that writes jobs.budget: when an accepted quote is
      // linked to this job, round(budget * 100) must equal its price_cents.
      // FAIL CLOSED on an unreadable quote table, as the dispute read above.
      await refuseQuoteJobPriceMismatch(supabaseAdmin, jobId, job.budget);

      // ─── Where a cancelled checkout lands (Q1862) ───
      // Post a Job by default; the quote screens send their own request page.
      // Only the allowlisted in-app path (a quote request page): anything else
      // is refused, never redirected to.
      const cancelQuoteRequestId = escrowCancelQuoteRequestId(body.returnPath);

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
      // A session minted under the TEST key (every job funded before prod went
      // live on 2026-09-27) is unreadable and unpayable under the live key: no
      // money can sit behind it, so there is nothing to inspect or expire and
      // a fresh one is minted. previousSessionId itself is KEPT: the stamp
      // below is guarded on it and the idempotency key is scoped to it.
      let prior: Stripe.Checkout.Session | null = null;
      // The same for a LIVE session left on a test account's job (minted before
      // test accounts moved to test mode, 2026-10-12): the test key cannot read
      // it. None of those was ever paid (measured 2026-10-12: 0 of 68), and a
      // Checkout Session expires on its own within 24 hours.
      const priorFromOtherMode = sessionIdMode(previousSessionId) === "live" && stripeMode === "test";
      if (priorFromOtherMode) {
        console.warn(`[create-payment] prior session on job ${jobId} is a live-mode session and this job runs in test mode; minting a fresh test-mode one`);
      }
      if (previousSessionId && !priorFromOtherMode) {
        try {
          prior = await stripe.checkout.sessions.retrieve(previousSessionId, {
            expand: ["payment_intent"],
          });
        } catch (priorErr) {
          if (!isTestObjectUnderLiveKey(priorErr)) throw priorErr;
          console.warn(`[create-payment] prior session ${previousSessionId} on job ${jobId} is a test-mode object under the live key; minting a fresh one`);
        }
      }
      if (previousSessionId && prior) {
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

      // ─── A PaymentIntent the row still carries from an earlier checkout ───
      //
      // lh-money-escrow review of a2f1618d0, #1. A bounced bank payment
      // (payment_intent.payment_failed on a completed ACH checkout) writes
      // 'failed' and nulls stripe_session_id but KEEPS stripe_payment_intent_id,
      // so the retire step above has no session to inspect. The stamp below
      // then wrote 'unpaid' + a new card session with the bank's PI still on
      // the row: the shape My Posts reads as "waiting for your bank"
      // (src/lib/pendingBankPayment.ts) while the poster is on a card checkout,
      // and the PI every refund and payment_intent.succeeded keys on is the
      // dead one. Stripe decides whether it is dead: one that can still move
      // money (anything past requires_payment_method, not canceled) refuses
      // the re-mint exactly like a live prior session; a dead one is cleared
      // by the fee-model stamp below, pinned to the id read here. A PI minted
      // under the TEST key is unreadable under the live key and holds no real
      // money, so it is dead too. Any other read error refuses (fail closed).
      const rowPaymentIntentId: string | null = job.stripe_payment_intent_id ?? null;
      if (rowPaymentIntentId) {
        let rowPi: Stripe.PaymentIntent | null = null;
        try {
          rowPi = await stripe.paymentIntents.retrieve(rowPaymentIntentId);
        } catch (rowPiErr) {
          if (!isTestObjectUnderLiveKey(rowPiErr)) throw rowPiErr;
          console.warn(`[create-payment] job ${jobId} carries test-mode PI ${rowPaymentIntentId} under the live key; clearing it on re-mint`);
        }
        if (rowPi && !["requires_payment_method", "canceled"].includes(rowPi.status)) {
          console.error(
            `[create-payment] refusing re-mint for job ${jobId}: the row's PaymentIntent ${rowPaymentIntentId} is ${rowPi.status} while jobs.payment_status='${currentPaymentStatus}'`,
          );
          throw new PublicError("A payment for this job is still being processed. Give it a moment and refresh before trying again.");
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
       * Checkout expiry (Q770). Without `expires_at` a job checkout stays open
       * for Stripe's default 24h, and a declined card only reaches the poster
       * when the session EXPIRES (Q769: a decline is retryable inside an open
       * session, so the notice waits for checkout.session.expired). An hour
       * bounds that wait and the abandoned-checkout sweep's wait with it.
       *
       * Taken from a 10-minute bucket, and the bucket is part of the
       * idempotency key, exactly as the recurring-visit checkout does: Stripe
       * refuses a reused key whose params changed (for 24h), so a double-tap
       * must send the SAME expires_at. bucket + 60 min is 50-60 min from now,
       * above Stripe's 30-minute minimum.
       */
      const checkoutBucketSec = Math.floor(Date.now() / 1000 / 600) * 600;
      const checkoutExpiresAt = checkoutBucketSec + 60 * 60;
      const checkoutKeySuffix = `${remintKeySuffix}-b${checkoutBucketSec}`;
      // Q1846 (lh-money-escrow review of 91927c016, #1): the price the session
      // is built for is part of its idempotency key. A stamp refused because
      // the poster edited the pay leaves a session at the OLD amount under the
      // old key; the retry, at the new amount, must not reuse that key, or
      // Stripe answers idempotency_error until the next 10-minute bucket. Same
      // price = same key, so a double-tap still gets one session.
      const priceKey = `-p${Math.round(Number(job.budget) * 100)}u${Math.round(Number(job.urgent_fee ?? 0) * 100)}`;

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
      /**
       * Q1846: every price this request charges and stamps was computed from
       * the job it read at the top (budget, the urgent bonus). A poster may
       * still edit both while the job is unpaid with no session stamped
       * (enforce_poster_jobs_money_lock locks them only once stripe_session_id
       * is set), so a write that lands after such an edit would record fees,
       * or open a checkout, for a price the job no longer has: raised in the
       * window, the Helpr would be paid on more than Stripe collected. Both
       * writes that commit this request's price (the fee-model stamp and the
       * session stamp) re-assert it, null-safe; zero rows refuses the checkout.
       */
      // deno-lint-ignore no-explicit-any
      const pinnedToReadPrice = (q: any) => {
        let pinned = q.eq("budget", job.budget);
        // A null bonus and a 0 bonus are the same price (nit 4 of the review).
        pinned = job.urgent_fee == null || Number(job.urgent_fee) === 0
          ? pinned.or("urgent_fee.is.null,urgent_fee.eq.0")
          : pinned.eq("urgent_fee", job.urgent_fee);
        pinned = job.is_urgent == null ? pinned.is("is_urgent", null) : pinned.eq("is_urgent", job.is_urgent);
        // The category picks the labor line's tax code. Once the session is
        // stamped, enforce_funded_category_tax_class refuses a switch between
        // taxed and untaxed categories; before that, this pin does (review of
        // 91927c016, #6).
        pinned = job.category == null ? pinned.is("category", null) : pinned.eq("category", job.category);
        return pinned;
      };

      // A Pay-in-4 model stamp (9%) also re-asserts the one-off shape this
      // request read: a job turned into a series between that read and the
      // stamp would carry a 9% series stamp that no saved card can charge
      // (recurring review #4). Once stamped, the schedule lock
      // (20261018024950) keeps the shape fixed.
      // deno-lint-ignore no-explicit-any
      const oneOffWhenPayInFour = (q: any) => payInFour ? q.is("recurrence_days", null) : q;

      const stampSession = async (newSessionId: string, extra: Record<string, unknown>) => {
        const guarded = () => pinnedToReadPrice(supabaseAdmin
          .from("jobs")
          .update({ stripe_session_id: newSessionId, payment_status: "unpaid", ...extra })
          .eq("id", jobId))
          .or("payment_status.is.null,payment_status.in.(unpaid,abandoned,failed)")
          // A job closed between the reads above and this write (a decided
          // dispute sets status 'completed') is never stamped: zero rows, so
          // the session URL is never returned (Q235 follow-up).
          .not("status", "in", `(${[...FUNDING_CLOSED_JOB_STATUSES].join(",")})`);
        const q = previousSessionId
          ? guarded().eq("stripe_session_id", previousSessionId)
          : guarded().is("stripe_session_id", null);
        const { data: updated, error: updateErr } = await q.select("id");
        if (updateErr) return { ok: false as const, reason: updateErr.message };
        if (updated && updated.length > 0) return { ok: true as const };
        // Expiring the previous session above fires checkout.session.expired,
        // and stripe-webhook releases the hold by nulling stripe_session_id.
        // When that lands first the compare-and-set on previousSessionId
        // matches nothing and a retapped Pay returned 500. A released hold is
        // still ours to take: retry once on null, with every other guard kept,
        // so a concurrent tap that already stamped its own session still wins.
        if (previousSessionId) {
          const { data: retried, error: retryErr } = await guarded()
            .is("stripe_session_id", null)
            .select("id");
          if (retryErr) return { ok: false as const, reason: retryErr.message };
          if (retried && retried.length > 0) return { ok: true as const };
        }
        const { data: recheck } = await supabaseAdmin
          .from("jobs").select("stripe_session_id").eq("id", jobId).maybeSingle();
        if (recheck?.stripe_session_id === newSessionId) return { ok: true as const };
        return { ok: false as const, reason: `matched 0 rows; job now holds ${recheck?.stripe_session_id ?? "null"}` };
      };

      // The whole job's flat Helpr fee, in cents (Q1845): each Helpr pays
      // 5% + 70c on THEIR OWN share of budget + bonus, so a crew of N records
      // the SUM of the N members' fees (the same largest-remainder split the
      // payout uses), not one 70c for the whole job.
      const escrowHelprCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
      const escrowFlatFeeCents = jobFlatFeeTotalCents(Math.round(job.budget * 100), urgentFeeCents, escrowHelprCount);


      // ─── Fee model stamp (roadmap F3, owner 2026-10-14/15) ───
      // Every job funded from here on is on the FLAT model: the poster pays
      // exactly the job price and the Helpr pays 5% + $0.70 out of their pay
      // (_shared/helprFlatFee.ts). Stamped BEFORE any funding branch (gift,
      // gift shortfall, card) so every way a job is funded carries it, and
      // only while the job is still unfunded: a job already funded keeps the
      // model it was funded under. Both parties come out ahead of the old
      // model on an unfunded job (no card-cost line for the poster; 5% + 70c
      // instead of 8-12% for the Helpr), so a job posted before the change
      // and funded after it is stamped too. FAIL CLOSED on a write error:
      // an unstamped job would be paid out on the legacy tier commission
      // while its poster was charged the flat-model price.
      //
      // The write re-asserts, atomically, the two lifecycle facts this
      // request decided from the job it read at the top (race class,
      // migration 20260913014328): the job is still in the status it was
      // judged fundable in (not completed/cancelled,
      // FUNDING_CLOSED_JOB_STATUSES) and still unfunded (the same set as
      // RE_MINTABLE_PAYMENT_STATUSES), and at the price it read (Q1846,
      // pinnedToReadPrice above). Zero rows means the job moved between
      // that read and this write: a concurrent tap funded it, a cancel or a
      // decided dispute closed it, or its status changed under us. None of
      // those may be charged under a stamp that never landed, so the
      // checkout is refused here, before any funding branch (gift redeem,
      // Stripe session).
      {
        const modelStamp = oneOffWhenPayInFour(pinnedToReadPrice(supabaseAdmin
          .from("jobs")
          .update({
            ...(isPosterFee
            ? {
                // Poster-fee model: the poster's fee is stamped, the Helpr side
                // is 0/0 so every payout path takes nothing from the Helpr
                // (CHECK jobs_poster_fee_model_consistent keeps these together).
                poster_fee_flat_cents: POSTER_JOB_FEE_CENTS,
                platform_fee_percent: posterFeePercent,
                customer_fee_amount: posterFeeCents / 100,
                helper_fee_flat_cents: 0,
                helper_fee_percent: 0,
                platform_fee_amount: 0,
              }
            : {
                // A job re-minted on the flat model after a poster-fee
                // checkout it never paid drops the poster stamp, or the CHECK
                // would refuse a row carrying both models. Written only when
                // the job carries one, so a flat checkout never names the
                // column (deploy order: it works before 20261017230824 lands).
                ...(job.poster_fee_flat_cents != null ? { poster_fee_flat_cents: null } : {}),
                helper_fee_flat_cents: HELPR_FLAT_FEE_CENTS,
                helper_fee_percent: HELPR_FLAT_FEE_PERCENT,
                // The poster side back to the flat model's, so an earlier
                // poster-fee attempt's 5/9 and fee never survive into a
                // gift-funded flat job (review of slice 3a, #4).
                platform_fee_percent: POSTER_SERVICE_FEE_PERCENT,
                customer_fee_amount: 0,
                // Every funding branch carries the flat fee it will be paid out at
                // (lh-money-escrow review N4): the full-gift path (redeem_gift_card)
                // and the gift-shortfall stamp never write platform_fee_amount, so
                // money-reconciliation graded a gift-funded flat job against NULL.
                platform_fee_amount: escrowFlatFeeCents / 100,
              }),
            // The dead PaymentIntent proved above leaves with the stamp, on
            // every funding branch and both fee models (review of a2f1618d0, #1).
            ...(rowPaymentIntentId ? { stripe_payment_intent_id: null } : {}),
          })
          .eq("id", jobId))
          .eq("status", job.status)
          .or("payment_status.is.null,payment_status.in.(unpaid,abandoned,failed)")
          // ...and still on the checkout this request read (or released by
          // its expiry), like stampSession: a concurrent request on the OTHER
          // model (a gift tap racing a card tap, a switch flip mid-request)
          // that already stamped its own session is never re-stamped under it
          // (review of slice 3a, #1).
          .or(previousSessionId
            ? `stripe_session_id.is.null,stripe_session_id.eq.${previousSessionId}`
            : "stripe_session_id.is.null"));
        // Pinned to the PI read (and proved dead) above, or to the null a
        // concurrent tap's stamp already cleared it to (delta review #1: a
        // double-tap after a bounced bank payment read the same PI, and an
        // .eq() pin refused the second tap that used to share the first one's
        // session through the idempotency key). A PI written since is neither,
        // is not ours to clear, and zero rows refuses the checkout below.
        // Every .or() filter is ANDed by PostgREST (measured 2026-10-18 03:31Z,
        // or=(id.is.null)&or=(id.not.is.null) on open_jobs_browse: []).
        const { data: modelRows, error: modelErr } = await (rowPaymentIntentId
          ? modelStamp.or(`stripe_payment_intent_id.eq.${rowPaymentIntentId},stripe_payment_intent_id.is.null`)
          : modelStamp.is("stripe_payment_intent_id", null)
        ).select("id");
        if (modelErr) {
          console.error(`[create-payment] fee-model stamp failed for job ${jobId}; refusing escrow:`, modelErr);
          throw new PublicError("Pricing configuration is temporarily unavailable — please try again in a moment");
        }
        if (!modelRows || modelRows.length === 0) {
          // Refused whatever the re-read says; it only picks the sentence.
          const { data: moved } = await supabaseAdmin
            .from("jobs").select("status, payment_status, budget, urgent_fee, is_urgent, helper_fee_flat_cents, helper_fee_percent, poster_fee_flat_cents").eq("id", jobId).maybeSingle();
          console.warn(`[create-payment] fee-model stamp matched 0 rows for job ${jobId} (read status=${job.status}, payment_status=${job.payment_status ?? "null"}; now status=${moved?.status ?? "?"}, payment_status=${moved?.payment_status ?? "?"}); refusing escrow`);
          if (moved && !RE_MINTABLE_PAYMENT_STATUSES.has(moved.payment_status ?? "unpaid")) {
            throw new PublicError("This job's payment has already been processed. Open the job to see its payment status.");
          }
          if (moved && FUNDING_CLOSED_JOB_STATUSES.has(String(moved.status))) {
            throw new PublicError("This job is closed, so it can no longer be paid for.");
          }
          if (moved && (Number(moved.budget) !== Number(job.budget) ||
              Number(moved.urgent_fee ?? 0) !== Number(job.urgent_fee ?? 0) ||
              Boolean(moved.is_urgent) !== Boolean(job.is_urgent))) {
            throw new PublicError("This job's pay changed while checkout was opening. Please try again so you pay the new amount.");
          }
          // A double-tap of THIS request (same model): the other tap stamped
          // the same model and its session, so this one goes on and gets the
          // same Checkout Session by its idempotency key (stampSession then
          // finds the job already holding it). Any other model is refused.
          const sameModel = !!moved && String(moved.status) === String(job.status) &&
            (isPosterFee
              ? Number(moved.poster_fee_flat_cents) === POSTER_JOB_FEE_CENTS && Number(moved.helper_fee_flat_cents) === 0
              : moved.poster_fee_flat_cents == null && Number(moved.helper_fee_flat_cents) === HELPR_FLAT_FEE_CENTS);
          if (!sameModel) throw new PublicError("This job changed while checkout was opening.");
          console.log(`[create-payment] fee-model stamp for job ${jobId} already holds this model (concurrent tap); continuing`);
        }
      }

      // ─── Gift card redemption ───
      // A recipient redeeming a directed gift funds the job from the
      // prepaid donation (already captured into the platform balance at
      // donate time), so the recipient is charged $0 when the gift covers
      // the budget — and only the shortfall via Stripe when it doesn't.
      // The atomic RPC validates ownership + funding + expiry and moves
      // the money server-side; the client is never trusted with any of it.
      // On the flat model a gift-card job carries NO poster service fee; on the
      // poster-fee model the fee stamped above is part of what the gift pays
      // first (redeem_gift_card reads it from customer_fee_amount) and of the
      // shortfall. Either way this short-circuits before the pricing below.
      if (giftCardId) {
        const { data: redeem, error: redeemErr } = await supabaseAdmin.rpc("redeem_gift_card", {
          p_credit_id: giftCardId,
          p_job_id: jobId,
          p_user_id: user.id,
          // The card checkout this request just closed above, if any: any OTHER
          // open one (a concurrent card tap) makes the redeem refuse (Q975 race 15).
          p_retired_session: previousSessionId,
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
        // shortfall (on the poster-fee model it includes the part of the fee
        // the gift did not cover; flat model: no service fee). The difference session's
        // webhook (metadata.gift_card_id) consumes the reservation + funds
        // the job. Retry is safe: the RPC re-entry returns the same
        // difference and Stripe dedupes on the per-job idempotency key.
        const differenceCents = Number(redeem?.difference_cents ?? 0);
        if (!Number.isFinite(differenceCents) || differenceCents <= 0) {
          throw new PublicError("Could not determine the remaining balance for this gift — please try again");
        }
        // The fee the redeem priced must be the fee this request quoted and
        // stamped (review of gift-first, #3): a concurrent flat re-stamp, or
        // a redeem_gift_card older than 20261018031451 (no fee_cents), would
        // otherwise open a shortfall that names and stamps a fee nobody priced.
        // Refused with the gift still reserved for this job, so a retry works.
        const redeemFeeCents = Number(redeem?.fee_cents ?? 0);
        if (redeemFeeCents !== (isPosterFee ? posterFeeCents : 0)) {
          console.warn(`[create-payment] gift redeem for job ${jobId} priced fee ${redeem?.fee_cents ?? "none"}c, this checkout quoted ${isPosterFee ? posterFeeCents : 0}c; refusing the shortfall`);
          throw new PublicError("This job changed while checkout was opening. Please try again.");
        }
        // Roadmap F3 (owner 2026-10-15): the urgent bonus is part of the job
        // price, with NO card-fee line of its own for the poster (it replaced
        // Q362's "Urgent bonus card fee" here). The Helpr's flat 5% + $0.70 is
        // priced on budget + bonus at payout (jobHelprCommissionDollars).
        const diffLineItems: any[] = [{
          price_data: {
            currency: "usd",
            tax_behavior: TAX_BEHAVIOR,
            product_data: {
              name: `Helpr Job: ${job.title}`,
              description: isPosterFee
                ? `Remaining balance after applying your gift card, including the service fee (${POSTER_JOB_FEE_DESCRIPTION}). Funds release once both parties confirm completion.`
                : "Remaining balance after applying your gift card. Funds release once both parties confirm completion.",
              tax_code: NONTAXABLE_TAX_CODE,
            },
            unit_amount: differenceCents,
          },
          quantity: 1,
        }];
        const diffSession = await stripe.checkout.sessions.create({
          customer: await payerWalletCustomer(),
          customer_update: { address: "auto" },
          line_items: diffLineItems,
          mode: "payment",
          // Every job checkout names its methods (owner 2026-10-18) and
          // presents dollars only (no Adaptive Pricing conversion).
          payment_method_types: [...JOB_CHECKOUT_PAYMENT_METHOD_TYPES],
          adaptive_pricing: { enabled: false },
          automatic_tax: { enabled: true },
          // 3D Secure from $300 (Q202): the hosted page runs the challenge.
          payment_method_options: threeDSecureOptions(differenceCents),
          payment_intent_data: {
            metadata: { job_id: jobId, customer_id: user.id, gift_card_id: giftCardId },
            // Q734: honour "save my card" here too. A recurring series charges
            // each later visit to the card on the series' PaymentIntent
            // (charge-recurring-visits seriesCard), which for a gift-funded
            // post is THIS shortfall intent. Without setup_future_usage the
            // card is never attached to the customer and every visit declines.
            ...(saveCardForFuture === true ? { setup_future_usage: "off_session" as const } : {}),
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
          expires_at: checkoutExpiresAt,
          metadata: { job_id: jobId, customer_id: user.id, gift_card_id: giftCardId,
            // wallet_save "1": stripe-webhook makes the saved card the wallet's
            // default card (Q2139) only on a session marked so ("" = unset).
            wallet_save: saveCardForFuture === true ? "1" : "" },
        }, {
          idempotencyKey: `gift-card-diff-${jobId}${priceKey}${checkoutKeySuffix}`,
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
        // Always stamped, zero included: a fee an earlier card checkout of this
        // job stamped must not survive into this gift job's cancellation
        // withholding (Q362 re-review LOW 1).
        // The poster-fee model keeps its fee stamp (the gift + this shortfall
        // pay it); the flat model stamps 0.
        const diffStamp = await stampSession(diffSession.id, { customer_fee_amount: redeemFeeCents / 100 });
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
        // The poster pays no platform rate at all (owner, 2026-10-11).
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
      // reaches any charge: the poster's service fee is Stripe's card cost
      // only (posterCardCostFeeCents, owner 2026-10-11).
      // helper_fee_percent from platform_settings is read and null-checked for
      // the same fail-loud reason, but no longer prices anything: every job
      // funded here is on the flat model stamped above (roadmap F3).
      const helperFeePercent = isPosterFee ? 0 : HELPR_FLAT_FEE_PERCENT;
      const onboardingFeeCents = settings.onboarding_fee_cents; // NOT NULL DEFAULT 200 in schema

      // Check if the poster owes the one-time onboarding fee (first job post).
      // Owner, 2026-10-11: the poster's tier no longer prices anything at
      // checkout (posters pay no platform percentage on any tier; the service
      // fee is Stripe's card cost only, `posterCardCostFeeCents`), so the
      // tier columns are not read here any more.
      const { data: posterProfile, error: posterProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("onboarding_fee_paid")
        .eq("user_id", user.id)
        .single();
      if (posterProfileErr) {
        // Don't fail the charge, but make the failure findable, never silent.
        // Critically, only bill the one-time onboarding fee when we can PROVE
        // it's unpaid: a read failure leaves posterProfile null, so guarding on
        // `!!posterProfile` prevents re-charging onboarding to someone who
        // already paid it.
        console.error(`[create-payment] poster profile read failed — skipping onboarding charge:`, posterProfileErr);
      }
      const owesOnboardingFee = !!posterProfile && !posterProfile.onboarding_fee_paid && onboardingFeeCents > 0;
      // Stamped on the job (platform_fee_percent, the poster-side column) and
      // on the PaymentIntent metadata, so the row records which pricing it was
      // charged under: 0 = card cost only (owner, 2026-10-11).
      const customerFeePercent = isPosterFee ? posterFeePercent : POSTER_SERVICE_FEE_PERCENT;

      // Customer service fee (its own non-taxable line item): Stripe's real
      // processing cost on the WHOLE transaction (budget + fee + urgent tip +
      // onboarding) and nothing more (owner, 2026-10-11), so the platform never
      // nets a loss on Stripe fees and the poster pays no platform percentage.
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
      // ($5) and MAX_URGENT_FEE_DOLLARS ($250 since Q210(c))
      // in _shared/jobBudgetLimits.ts, which src/lib/moneyLimits.ts re-exports.
      // (urgentFeeCents is computed above the fee-model stamp, which records
      // the flat fee on budget + bonus for every funding branch.)
      const onboardingChargeCents = owesOnboardingFee ? onboardingFeeCents : 0;
      // Roadmap F3 (owner 2026-10-14/15): NO service fee and no card-cost
      // line at all. The poster pays exactly the job price, and the urgent
      // bonus is PART of that price (owner 2026-10-15): no "Urgent bonus card
      // fee" line any more (it replaced Q362 / MQ11 for flat-model jobs).
      // Stripe's card cost comes out of the Helpr's flat 5% + $0.70, priced on
      // budget + bonus at payout. customer_fee_amount is 0, so a refund keeps
      // Stripe's actual card fee (refundToPayerCents) and returns the rest.
      // Poster-fee model (owner 2026-10-18): the poster's 5% + 70c (9% + 70c
      // for Pay in 4) is its own line and customer_fee_amount; the Helpr pays 0.
      const customerFeeAmount = isPosterFee ? posterFeeCents / 100 : 0;
      // The Helprs' flat fee is deducted at payout time, not charged to the
      // poster. Stored as platform_fee_amount: the whole job's fee, summed
      // per member on a crew (Q1845, escrowFlatFeeCents above). 0 on the
      // poster-fee model.
      const helperFeeAmount = isPosterFee ? 0 : escrowFlatFeeCents / 100;

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
              // Payer-facing words only (audit 2026-10-29 A2-C28): no category slug, no tax terms;
              // the tax treatment rides on tax_code below.
              description: "Held safely and paid to your Helpr once you both confirm the job is done.",
              // Assembly/installation of tangible personal property: LA repair/install code.
              // All other categories: pass-through (no LA state tax on the labor).
              tax_code: laborTaxCode(job.category),
            },
            unit_amount: Math.round(job.budget * 100),
          },
          quantity: 1,
        },
      ];

      // No poster service fee line (roadmap F3, owner 2026-10-14/15): the
      // poster pays exactly the job price. The 2026-10-11 card-cost line that
      // stood here is gone for every job funded from now on.

      // Urgent bonus (F3 review N5: not called a tip, the 5% applies to it). Taxed like
      // the labor (owner 2026-10-21, Q1843): the labor's own tax code, so a taxable
      // category taxes it and an exempt one does not. Uses the
      // server-recomputed urgentFeeCents (see above), never the stored column:
      // present and >= the floor whenever the job is urgent, absent otherwise.
      if (urgentFeeCents > 0) {
        lineItems.push({
          price_data: {
            currency: "usd",
            tax_behavior: TAX_BEHAVIOR,
            product_data: {
              name: "Urgent bonus",
              description: "Urgent bonus, part of the job price",
              tax_code: laborTaxCode(job.category), // Q1843: taxed exactly like the labor line
            },
            unit_amount: urgentFeeCents,
          },
          quantity: 1,
        });
      }
      // Poster-fee model: the service fee line. Taxed exactly like the job's
      // labor (owner-adopted tax memo 2026-10-17, R.S. 47:301(13)): on a
      // taxable category the fee carries the labor's tax code, otherwise it is
      // non-taxable. Never txcd_90050001 (that code is a fee charged to sellers).
      if (isPosterFee && posterFeeCents > 0) {
        lineItems.push({
          price_data: {
            currency: "usd",
            tax_behavior: TAX_BEHAVIOR,
            product_data: {
              name: "Service fee",
              description: payInFour
                ? `${posterFeePercent}% + $0.70 for Pay in 4, covers payment processing`
                : POSTER_JOB_FEE_DESCRIPTION,
              tax_code: laborTaxable ? laborTaxCode(job.category) : NONTAXABLE_TAX_CODE,
            },
            unit_amount: posterFeeCents,
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
              tax_code: NONTAXABLE_TAX_CODE,
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
          helper_fee_flat_cents: String(isPosterFee ? 0 : HELPR_FLAT_FEE_CENTS),
          fee_model: feeModel,
          poster_fee_flat_cents: isPosterFee ? String(POSTER_JOB_FEE_CENTS) : "",
          service_fee_cents: String(isPosterFee ? posterFeeCents : 0),
          pay_in_four: payInFour ? "true" : "false",
          onboarding_fee_charged: owesOnboardingFee ? "true" : "false",
        },
      };
      // Pay in 4 never saves a card (Klarna/Afterpay are not cards) and never
      // reaches a recurring series (a series is refused Pay in 4 above).
      if (saveCardForFuture === true && !payInFour) {
        paymentIntentExtras.setup_future_usage = "off_session";
      }

      // ─── Card hold at posting (Q2399, owner 2026-10-25, switch card_hold_at_post) ───
      // The poster's card is HELD, not charged, and is captured only when a
      // Helpr is hired (create-payment capture_hold); nobody hired, the hold
      // is cancelled (card-hold-sweep). Card and Link only: a bank payment
      // cannot be held, so it is charged as before; Pay in 4 keeps its own
      // checkout (Afterpay charges an instalment at authorization); a job
      // booked from a quote is hired the moment it is paid
      // (quote_job_funded_hires_quoter), so it is charged at once. A switch
      // read error is OFF (featureEnabledForUser fails closed); an unreadable
      // quote link is treated as a quote job (charged as today).
      const quoteBooked = async (): Promise<boolean> => {
        const { data: links, error: linkErr } = await supabaseAdmin
          .from("job_quote_requests").select("id").eq("job_id", jobId).limit(1);
        if (linkErr) {
          console.error(`[create-payment] quote link read failed for job ${jobId}; no card hold: ${linkErr.message}`);
          return true;
        }
        return (links ?? []).length > 0;
      };
      const cardHold = !payInFour && await featureEnabledForUser(supabaseAdmin, CARD_HOLD_SWITCH, user) && !(await quoteBooked());
      const lineItemsCents = lineItems.reduce((sum: number, li: any) => sum + Number(li?.price_data?.unit_amount ?? 0) * Number(li?.quantity ?? 1), 0);
      // A job far out SAVES the card for an off-session hold later, but only
      // when that hold could go through without the poster (under $300, an
      // untaxed category). Otherwise it is held NOW, on this page, with tax
      // and 3D Secure as today (lh-money-escrow review #2: a saved card that
      // can never be charged off-session left the job unhireable).
      const plannedHold = cardHold ? holdPlanFor(job.date_needed, job.start_time) : null;
      const holdPlan = plannedHold?.kind === "schedule" && !offSessionAllowed(lineItemsCents, job.category).ok
        ? { kind: "hold_now" as const }
        : plannedHold;
      const successUrl = buildRedirectUrl(`/payment-success?job_id=${jobId}`, isNative);
      const cancelUrl = cancelQuoteRequestId === null
        ? buildRedirectUrl(`/post-job`, isNative)
        : buildRedirectUrl(`/quotes/request/${cancelQuoteRequestId}`, isNative);
      const escrowModelStamp = {
        platform_fee_percent: customerFeePercent,
        platform_fee_amount: helperFeeAmount,
        customer_fee_amount: customerFeeAmount,
        helper_fee_percent: helperFeePercent,
        helper_fee_flat_cents: isPosterFee ? 0 : HELPR_FLAT_FEE_CENTS,
        // Every model column is restated with the session (review #7): a
        // concurrent request's model stamp cannot leave this session's job
        // on the other model. Named on a flat job only when it holds a
        // poster stamp to clear (deploy order, as the model stamp above).
        ...(isPosterFee
          ? { poster_fee_flat_cents: POSTER_JOB_FEE_CENTS }
          : job.poster_fee_flat_cents != null ? { poster_fee_flat_cents: null } : {}),
      };

      if (holdPlan?.kind === "schedule") {
        // A job more than 6 days out: the card is SAVED now and held 4 days
        // before the start (card-hold-sweep), inside every brand's off-session
        // hold window. The amount is the line items: a taxed category's hold
        // is confirmed by the poster on a Checkout page (its tax is computed
        // there), so a saved card never carries an untaxed charge.
        const setupSession = await stripe.checkout.sessions.create({
          customer: await payerWalletCustomer(),
          mode: "setup",
          currency: "usd",
          payment_method_types: ["card", "link"],
          billing_address_collection: "required",
          setup_intent_data: { metadata: { job_id: jobId, customer_id: user.id, card_hold: "1" } },
          custom_text: { submit: { message: CARD_HOLD_COPY.scheduled(lineItemsCents, owesOnboardingFee ? onboardingFeeCents : 0) } },
          success_url: successUrl,
          cancel_url: cancelUrl,
          expires_at: checkoutExpiresAt,
          metadata: {
            job_id: jobId, customer_id: user.id, card_hold: "1", card_hold_plan: "schedule",
            hold_amount_cents: String(lineItemsCents), hold_place_at: holdPlan.placeAt.toISOString(),
            onboarding_fee_charged: owesOnboardingFee ? "true" : "false",
            onboarding_fee_cents: String(onboardingFeeCents),
            card_hold_intent: JSON.stringify(paymentIntentExtras.metadata),
            wallet_save: saveCardForFuture === true ? "1" : "",
          },
        }, {
          idempotencyKey: `escrow-${jobId}${priceKey}-m${feeModel}-hs${checkoutKeySuffix}`,
        });
        const setupStamp = await stampSession(setupSession.id, escrowModelStamp);
        if (!setupStamp.ok) {
          console.error(`[create-payment] card-hold setup session ${setupSession.id} created for job ${jobId} but jobs.update failed:`, setupStamp.reason);
          throw new PublicError("Could not record the payment session — please try again");
        }
        return new Response(JSON.stringify({ url: setupSession.url, cardHold: "scheduled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
        });
      }
      if (holdPlan) paymentIntentExtras.metadata.card_hold = "1";

      // 3D Secure from $300 (Q202), on the line items plus a CEILING on the
      // labor's sales tax (Q1658). No card options on a Pay-in-4 session (no
      // card can be used there). A taxable job's service fee is taxed too.
      const threeDSCents = payInFour ? 0 : lineItemsCents
        + (isPosterFee && laborTaxable ? salesTaxCeilingCents(posterFeeCents, job.category) : 0)
        + salesTaxCeilingCents(Math.round(job.budget * 100) + urgentFeeCents, job.category);
      const session = await stripe.checkout.sessions.create({
        customer: await payerWalletCustomer(),
        customer_update: { address: 'auto' },
        line_items: lineItems,
        mode: "payment",
        // Explicit methods on every job checkout (owner 2026-10-18): card,
        // Link and ACH; Pay in 4 is its own session with Klarna/Afterpay only.
        payment_method_types: payInFour ? payInFourMethods : [...JOB_CHECKOUT_PAYMENT_METHOD_TYPES],
        // Dollars only: Adaptive Pricing would add a 2-4% conversion to what
        // the poster pays, so the charge would not be the total the app showed.
        adaptive_pricing: { enabled: false },
        automatic_tax: { enabled: true },
        // 3D Secure from $300 (Q202), on the line items plus a CEILING on the
        // labor's sales tax (Q1658: since Q1578 a taxable $270-$299 checkout
        // can pass $300 once Checkout adds the real tax; a ceiling only errs
        // toward asking for 3DS)
        // (tax is only known once Checkout has the address; it can only add).
        // A card HOLD (Q2399) carries the same 3D Secure rule plus manual capture.
        payment_method_options: holdPlan ? holdCheckoutPaymentMethodOptions(threeDSecureOptions(threeDSCents)) : threeDSecureOptions(threeDSCents),
        payment_intent_data: paymentIntentExtras,
        success_url: successUrl,
        cancel_url: cancelUrl,
        expires_at: checkoutExpiresAt,
        metadata: { job_id: jobId, customer_id: user.id, onboarding_fee_charged: owesOnboardingFee ? "true" : "false", onboarding_fee_cents: String(onboardingFeeCents),
          // card_hold "1": stripe-webhook settles this session as a card HOLD (Q2399); "" = unset, as wallet_save.
          card_hold: holdPlan ? "1" : "",
          // wallet_save "1": stripe-webhook makes the saved card the wallet's
          // default card (Q2139) only on a session marked so ("" = unset).
          wallet_save: paymentIntentExtras.setup_future_usage === "off_session" ? "1" : "" },
      }, {
        // Idempotency: a double-submit (double-tap, retried request) for the same
        // job reuses the existing Checkout Session instead of creating a second
        // escrow charge. Scoped per job and 10-minute expiry bucket (see checkoutKeySuffix).
        // The fee model and Pay-in-4 choice are part of the price (owner
        // 2026-10-18): a session opened on one model is never replayed for
        // a request on the other.
        idempotencyKey: `escrow-${jobId}${priceKey}-m${feeModel}${payInFour ? "4" : ""}${holdPlan ? "-h" : ""}${checkoutKeySuffix}`,
        // Q2399: per-method capture on Checkout needs this API version (one call only).
        ...(holdPlan ? { apiVersion: CARD_HOLD_CHECKOUT_API_VERSION } : {}),
      } as Stripe.RequestOptions);

      // Store both fee structures on the job. Fail the request if this write
      // fails: without stripe_session_id the double-payment guard is blind and
      // the frozen fee percents are lost — the unused Checkout Session is
      // harmless, so failing loudly here costs nothing.
      // stampSession carries the .select("id") zero-row guard: a zero-row match
      // (error === null) would otherwise look identical to success here,
      // leaving stripe_session_id unset — the double-payment guard goes blind
      // and the frozen fee percents are lost.
      const escrowStamp = await stampSession(session.id, escrowModelStamp);
      if (!escrowStamp.ok) {
        console.error(`[create-payment] escrow session ${session.id} created for job ${jobId} but jobs.update failed:`, escrowStamp.reason);
        throw new PublicError("Could not record the payment session — please try again");
      }

      return new Response(JSON.stringify({ url: session.url, ...(holdPlan ? { cardHold: "hold" } : {}) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // (repay_escrow action removed — immediate capture eliminates expiry risk)

    // ─── CAPTURE_HOLD: the hire charges the poster's held card (Q2399) ───
    //
    // Called by the Helpr's app when the accept that completes a hire
    // (accept_job_offer, respond_to_direct_offer, rpc_group_member_confirm)
    // answered payment_not_captured. This request does the WHOLE hire, so no
    // card is charged for a hire that then does not happen (lh-money-escrow
    // review #3):
    //   1. the hire's own RPC runs AS THE HELPR. Each raises
    //      payment_not_captured only after every other gate passed (the
    //      offer is live, the Helpr ready and not banned or blocked), so that
    //      answer is the proof the hire can complete; any other answer charges
    //      nothing (the app re-runs the RPC and shows its own refusal);
    //   2. the held card is captured (captureCardHold claims the hold first);
    //   3. the same RPC runs again and completes the hire; a refusal after a
    //      capture pages ops (money held for nobody).
    // Not behind the switch: it acts only on a job ALREADY held (the poster's
    // switch decided that at posting), and turning the switch off must never
    // strand a card hold with nobody able to hire.
    if (action === "capture_hold") {
      const { jobId } = body;
      if (typeof jobId !== "string" || !STRIPE_MODE_UUID_RE.test(jobId)) throw new PublicError("Missing jobId");
      const json = (payload: Record<string, unknown>, status = 200) =>
        new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
      const { data: job, error: jobErr } = await supabaseAdmin
        .from("jobs")
        .select("id, title, status, payment_status, helper_id, helper_confirmed_at, offered_to_helper_id, direct_offer_status, instant_decline_until, is_group_job, response_deadline, customer_id, is_seed")
        .eq("id", jobId)
        .maybeSingle();
      if (jobErr) {
        console.error(`[create-payment] capture_hold job read failed for ${jobId}: ${jobErr.message}`);
        return json({ error: "Couldn't check this job. Nothing was charged — try again." }, 503);
      }
      if (!job) throw new PublicError("Job not found");
      let seatOpen = false;
      if (job.is_group_job) {
        const { data: seat, error: seatErr } = await supabaseAdmin
          .from("group_job_helpers").select("id, helper_confirmed_at").eq("job_id", jobId).eq("helper_id", user.id).maybeSingle();
        if (seatErr) {
          console.error(`[create-payment] capture_hold crew seat read failed for ${jobId}: ${seatErr.message}`);
          return json({ error: "Couldn't check this job. Nothing was charged — try again." }, 503);
        }
        seatOpen = !!seat && seat.helper_confirmed_at == null;
      }
      const offerOpen = !job.is_group_job && job.status === "accepted" && job.helper_id === user.id && job.helper_confirmed_at == null &&
        (job.response_deadline == null || Date.parse(job.response_deadline) > Date.now());
      const directOpen = !job.is_group_job && job.status === "open" && job.offered_to_helper_id === user.id && job.direct_offer_status === "pending";
      if (!offerOpen && !directOpen && !seatOpen) throw new PublicError("Not authorized");
      if (job.payment_status !== "held" && job.payment_status !== "failed") return json({ state: "not_held" });

      // The hire's own RPC, as the Helpr (auth.uid() is theirs, every gate judged).
      const asHelpr = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
        { global: { headers: { Authorization: authHeader } } },
      );
      const hire = () => seatOpen
        ? asHelpr.rpc("rpc_group_member_confirm", { _job_id: jobId })
        : directOpen
          ? asHelpr.rpc("respond_to_direct_offer", { p_job_id: jobId, p_accept: true })
          : asHelpr.rpc("accept_job_offer", { p_job_id: jobId });
      const notCaptured = (e: { message?: string } | null) => /payment_not_captured/.test(String(e?.message ?? ""));
      /** Is this Helpr hired on the job now (their seat confirmed, or the job confirmed to them)? A failed read is "no". */
      const hiredNow = async (): Promise<boolean> => {
        if (seatOpen) {
          const { data: seat, error: seatErr } = await supabaseAdmin
            .from("group_job_helpers").select("helper_confirmed_at").eq("job_id", jobId).eq("helper_id", user.id).maybeSingle();
          if (seatErr) console.error(`[create-payment] capture_hold seat re-read failed for ${jobId}: ${seatErr.message}`);
          return !seatErr && seat?.helper_confirmed_at != null;
        }
        const { data: now, error: nowErr } = await supabaseAdmin.from("jobs").select("helper_confirmed_at, helper_id").eq("id", jobId).maybeSingle();
        if (nowErr) console.error(`[create-payment] capture_hold job re-read failed for ${jobId}: ${nowErr.message}`);
        return !nowErr && now?.helper_id === user.id && now?.helper_confirmed_at != null;
      };

      if (job.payment_status === "held") {
        const first = await hire();
        if (!first.error) return json({ state: "accepted", result: first.data ?? null });
        // Any other refusal: nothing is charged, and the app re-runs the RPC to show its own copy.
        if (!notCaptured(first.error)) return json({ state: "not_held" });
      }
      // A direct offer (an instant booking among them): the capture gives its claim
      // back if the offer stops being this Helpr's after the claim (CMP-4 race fix).
      const result = await captureCardHold({ db: supabaseAdmin, stripe, mode: stripeMode }, jobId, directOpen ? { offerTo: user.id } : {});
      if (result.ok) {
        const done = await hire();
        if (!done.error) return json({ state: "accepted", result: done.data ?? null });
        // Already captured by another run (card-hold-sweep completing this same Helpr's pending
        // accept): when that run hired THIS Helpr, the accept went through (round 4, money #6).
        if (result.already && await hiredNow()) return json({ state: "accepted", result: null });
        // Captured, and the hire refused in the moment between: money held for nobody.
        console.error(`[create-payment] capture_hold: job ${jobId} captured but the hire did not complete: ${done.error.message}`);
        if (directOpen && job.instant_decline_until != null) {
          // An instant booking (CMP-4, lead 2026-11-01): the SAME path as card-hold-sweep's
          // residual case. The booking ends, the job is closed for review (nobody can be hired
          // on this money), the poster is told the truth, the full refund runs now (and is
          // retried by card-hold-sweep), and ops hears once per job (the shared key).
          const how = "The booked Helpr's own Confirm captured the job's held card, and the hire was then refused.";
          const ended = await endCapturedNotHired({
            db: supabaseAdmin,
            record: (d) => console.error(`[create-payment] capture_hold: ${d}`),
            page: (title, message, fields) => postSlackOpsAlert({ kind: "money_at_risk", severity: "critical", title, message, fields, seed: job.is_seed === true, oncePerDayKey: `instant-book-captured-not-hired:${jobId}` }),
            refund: (id) => refundInstantBookingWith({ db: supabaseAdmin, stripe, mode: stripeMode }, id, (d) => console.error(`[create-payment] capture_hold: ${d}`), job.is_seed === true),
          }, jobId, user.id, how);
          if (ended === "retry") {
            return json({ error: "Your confirm didn't go through. Pull to refresh to see where this booking stands." }, 503);
          }
          return json({ code: "booking_ended", error: "Your booking didn't go through, so you aren't booked. Nothing is owed and no strike." }, 409);
        }
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "A card hold was captured but the hire did not complete",
          message: "The poster's held card was charged for a Helpr's accept, and the accept was then refused. The job is funded with nobody hired, as an unfilled paid job is: the Helpr can accept again, or the poster can hire someone else; if nobody is hired, it settles as any unhired funded job does.",
          fields: { job_id: jobId, helpr: user.id, error: String(done.error.message ?? "").slice(0, 200) },
          seed: job.is_seed === true,
        });
        return json({ code: "captured_not_hired", error: "Your accept didn't go through. Pull to refresh and try again." }, 409);
      }
      if (result.reason === "not_held") return json({ state: "not_held" });
      if (result.reason === "retry") {
        console.warn(`[create-payment] capture_hold for job ${jobId} will retry: ${result.detail}`);
        return json({ error: "Couldn't reach the payment processor. Try again in a moment." }, 503);
      }
      await notifyHelprWaiting(supabaseAdmin, user.id, job);
      return json({ code: "payment_pending", error: CARD_HOLD_COPY.helprWaiting(job.title ?? "This job") }, 409);
    }

    // ─── RELEASE: Both parties confirm → capture + transfer ───
    if (action === "release") {
      const { jobId } = body;
      if (!jobId) throw new PublicError("Missing jobId");
      // Owner 2026-10-23: when a poster has not answered in time, Helpr support steps in
      // (job_approval_escalations). An admin may then approve FOR the poster: the same write as the
      // poster's own approval, allowed only while that job's escalation is open, never on a job the
      // admin is part of, and audited.
      const forPoster = body.forPoster === true;

      const { data: firstRead, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !firstRead) throw new PublicError("Job not found");
      // `let`: the conditional write below re-reads on a lost race.
      let job = firstRead;

      if (forPoster) {
        const { data: isAdmin, error: adminRoleErr } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
        if (adminRoleErr) {
          // Fails closed, and says so: an outage is not "you are not an admin" (lh-silent-failure review #8).
          console.error("[create-payment] release forPoster has_role check failed:", adminRoleErr.message);
          throw new PublicError("We couldn't confirm your admin access right now, so nothing was approved. Try again in a minute.");
        }
        if (!isAdmin) throw new PublicError("Not authorized — admin only");
        if (job.customer_id === user.id || job.helper_id === user.id) {
          throw new PublicError("Another admin must approve a job you are part of.");
        }
        // A crew has no lead (jobs.helper_id is NULL, 20260925154606): a member is on the roster
        // (lh-money-escrow review must-fix 3). Fails closed.
        if (job.is_group_job === true) {
          const { data: onCrew, error: crewErr } = await supabaseAdmin
            .from("group_job_helpers").select("helper_id").eq("job_id", jobId).eq("helper_id", user.id).limit(1);
          if (crewErr) {
            console.error("[create-payment] release forPoster crew read failed:", crewErr.message);
            throw new PublicError("We couldn't check this job's crew right now, so nothing was approved. Try again in a minute.");
          }
          if ((onCrew ?? []).length > 0) throw new PublicError("Another admin must approve a job you are part of.");
        }
        const { data: esc, error: escErr } = await supabaseAdmin
          .from("job_approval_escalations").select("job_id").eq("job_id", jobId).is("resolved_at", null).maybeSingle();
        if (escErr) {
          console.error("[create-payment] release forPoster escalation read failed:", escErr.message);
          throw new PublicError("We couldn't check this job's support request right now, so nothing was approved. Try again in a minute.");
        }
        if (!esc) throw new PublicError("This job isn't waiting on Helpr support, so it can't be approved on behalf of the person who posted it.");
        if (!job.helper_completed_at) throw new PublicError("The Helpr hasn't marked this job done, so there is nothing to approve yet.");
        // The person who posted it sent the work back and the fix is not delivered yet: their "not done" stands
        // (lh-money-escrow review must-fix 1). The same rule is still_waiting in admin_approval_escalation_queue.
        if (job.status === "revision_requested" && !job.revision_completed_at) {
          throw new PublicError("The person who posted this job asked for a change and the Helpr hasn't delivered it yet, so it can't be approved now.");
        }
        // ...and once the fix is delivered, their 72 hours to review it run out first (re-review should-fix 1).
        if (job.status === "revision_requested" &&
            !(job.revision_acceptance_deadline && Date.parse(job.revision_acceptance_deadline) <= Date.now())) {
          throw new PublicError("The person who posted this job is still within their time to review the Helpr's fix, so it can't be approved for them yet.");
        }
      }

      const isPoster = forPoster || job.customer_id === user.id;
      const isHelper = !forPoster && job.helper_id === user.id;
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
      //
      // The gates run on the row the write is decided from: here on the first
      // read, and again on every re-read in the retry loop below, where a
      // stamp cleared in between (a come-back accepted, refund_requests_sweep)
      // makes the retry a NEW completion (lh-money-escrow re-review, 2026-10-21).
      // deno-lint-ignore no-explicit-any
      const newHelperCompletionGates = async (job: any) => {
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

        // 2b. NOT BEFORE AN AGREED COME-BACK (board 141, Q2326; lh-money-escrow
        //     re-review, 2026-10-21). The Helpr agreed to come back and finish
        //     instead of a refund: no new done stamp until the agreed time.
        //     trg_refuse_done_before_come_back judges the member's own write;
        //     this write is the service role's, which that trigger lets
        //     through, so it asks the same SQL rule here.
        const comeBack = await refundComeBackPending(supabaseAdmin, jobId);
        if (!comeBack.ok) throw new PublicError("We couldn't check this job right now, so it wasn't marked done. Try again in a minute.");
        if (comeBack.pending) throw new PublicError(COME_BACK_PENDING_MESSAGE);
      };
      if (isHelper && !isPoster && !job.helper_completed_at) await newHelperCompletionGates(job);

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
      //    use: LEAST(poster_confirmed_working_at, helper_arrived_at), the
      //    EARLIER stamp (audit 2026-10-28 F12, migration
      //    20261029042735_done_floor_from_arrival): it was COALESCE, so a
      //    poster's late "Confirm they're working" restarted the Helpr's clock.
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
      const workStamps = [job.poster_confirmed_working_at, job.helper_arrived_at]
        .map((t) => (t ? Date.parse(t) : NaN))
        .filter((ms) => Number.isFinite(ms));
      const workStartMs = workStamps.length ? Math.min(...workStamps) : NaN;
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
          if (isHelper && !isPoster && !job.helper_completed_at) await newHelperCompletionGates(job);
        }

        updateFields = {};
        if (isPoster) updateFields.poster_completed_at = new Date().toISOString();
        if (isHelper) updateFields.helper_completed_at = new Date().toISOString();

        posterDone = isPoster ? true : !!job.poster_completed_at;
        helperDone = isHelper ? true : !!job.helper_completed_at;
        bothDone = posterDone && helperDone;

        if (bothDone) {
          // Q1326: only HELD money can be scheduled out. This write never read
          // payment_status, so it wrote payout_pending over 'cancelling' (a
          // full admin refund whose Stripe call failed ambiguously, or
          // cancel_escrow mid-refund), over 'refunded' (a Dashboard refund's
          // charge.refunded), over 'chargeback' and over 'unpaid' (no intent,
          // no check), and the payout cron paid the Helpr ~3 days later. The
          // payment_status read here is ALSO pinned on the write below.
          if (job.payment_status !== "escrow") {
            console.error(`[create-payment] release REFUSED for job ${jobId}: payment_status '${job.payment_status}' is not held escrow`);
            throw new PublicError(
              "This job's payment isn't held right now (it is being refunded, was refunded, is under a card dispute, or was never paid), so it can't be released. Nothing was moved.",
            );
          }
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
          // STANDARD PAY: 3 days after the POSTER APPROVED (owner 2026-10-23; was 3 days after the Helpr
          // marked done). The approval is this write when the poster (or an admin for them) is the caller,
          // else the poster's earlier stamp.
          const payoutTime = standardPayoutAtIso(isPoster ? null : job.poster_completed_at);
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
        // Q1326: the payout-scheduling write is pinned to held escrow, so a
        // refund claim, refund or chargeback that lands after the read above
        // is never written over.
        if (updateFields.payment_status === "payout_pending") conditional = conditional.eq("payment_status", "escrow");
        // .select("id"): this is the write that flips status to "completed" and
        // schedules the payout. Zero rows is now EXPECTED on a lost race and is
        // answered by the re-read above — never by falling through.
        const { data, error: updateError } = await conditional.select("id");
        if (updateError) {
          console.error("Failed to update job:", updateError);
          // Q1415 (b): an open ban settlement review on this job's poster or
          // Helpr refuses escrow -> payout_pending
          // (trg_refuse_payout_pending_during_ban_review). Retrying cannot
          // help until an admin decides, so the answer is final and neutral:
          // it never says whose account is under review.
          if (/\bban_review_open\b/.test(String(updateError.message ?? ""))) {
            throw new PublicError(BAN_REVIEW_RELEASE_MESSAGE);
          }
          // Board 141 (Q2272): a live refund request on this job holds its
          // money (trg_refuse_payout_pending_while_refund_requested) until the
          // Helpr answers, the dispute is filed, or the agreed split runs.
          if (isRefundRequestHoldRefusal(String(updateError.message ?? ""))) {
            throw new PublicError(REFUND_REQUEST_RELEASE_MESSAGE);
          }
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
      const jobHelperFeePercent = flatFeePercentOf(job) ?? await getHelperFeePercent(
        supabaseAdmin,
        job.helper_id,
        job.helper_fee_percent ?? DEFAULT_TIER_FEE_PERCENT,
      );
      // Roadmap F3: the job's own model (flat 5% + 70c when stamped).
      const helperCommission = jobHelprCommissionDollars(job, perHelperBudget, jobHelperFeePercent, netUrgentFeeDollars(job.urgent_fee) / helpersCount);
      // Urgent fee is collected from the poster ONCE, so on a group job it is
      // split across the roster like the budget — else N helpers each get the
      // full urgent bonus against a single fee collected, over-paying N×.
      const helperPayout = perHelperBudget - helperCommission + netUrgentFeeDollars(job.urgent_fee) / helpersCount;
      if (isPoster && !forPoster && job.helper_id && !helperDone) {
        await insertNotifications(supabaseAdmin, {
          user_id: job.helper_id,
          title: "Job marked complete",
          message: `The person who posted "${job.title}" marked it complete. Please confirm completion to release payment.`,
          // `?job=` — see the note on the shared rule at the top of this file.
          type: "info", link: `/jobs?job=${job.id}`,
        });
      }
      if (isHelper && !posterDone) {
        await insertNotifications(supabaseAdmin, {
          user_id: job.customer_id,
          title: "Helpr marked the job complete",
          message: `The helpr marked "${job.title}" as complete. Please confirm completion to release payment.`,
          type: "info", link: `/posts?job=${job.id}`,
        });
      }

      if (bothDone) {
        // A: the DAY the money is sent, never "payment has been captured" (owner 2026-10-23).
        const payDay = payoutDayLabel(updateFields.payout_scheduled_at);
        // The same test as notify_on_job_update's crew branch (is_group_job IS TRUE), so no member is told twice.
        const isCrew = job.is_group_job === true;
        // A crew's members are each told their share and the day by notify_on_job_update
        // (20261023143240); this notice would only reach one of them.
        if (job.helper_id && !isCrew) {
          // What the payout will really send: the take-home, less an unpaid setup fee and any debt.
          const promise = payoutPromiseSentence(await readPromisedPayout(supabaseAdmin, job.helper_id, job, helperPayout), payDay);
          await insertNotifications(supabaseAdmin, {
            user_id: job.helper_id,
            job_id: job.id,
            title: "Job approved!",
            message: forPoster
              ? `Helpr support approved "${job.title}". ${promise}`
              : `"${job.title}" was approved. ${promise}`,
            type: "payment", link: "/profile?tab=earnings",
          });
        }
        if (job.customer_id) {
          await insertNotifications(supabaseAdmin, {
            user_id: job.customer_id,
            title: forPoster ? "Helpr support approved your job" : "Job complete",
            message: forPoster
              ? `You didn't answer, so Helpr support looked at "${job.title}" and approved it. ${isCrew ? "Every Helpr on your crew is" : "Your Helpr is"} paid ${payDay}.`
              : `Thanks for approving "${job.title}". ${isCrew ? "Every Helpr on your crew is" : "Your Helpr is"} paid ${payDay}.`,
            type: "payment", link: `/posts?job=${job.id}`,
          });
        }
      }
      if (forPoster) {
        // Close the support request in the same request, and audit the approval. Neither failure undoes the
        // approval (the money write above is done); each is logged and paged by its helper.
        const { data: closed, error: closeErr } = await supabaseAdmin
          .from("job_approval_escalations")
          .update({ resolved_at: new Date().toISOString(), resolved_by: user.id, resolution: "approved_for_poster" })
          .eq("job_id", job.id).is("resolved_at", null).select("job_id");
        if (closeErr || !closed || closed.length === 0) {
          console.error(`[create-payment] approval escalation for job ${job.id} not closed:`, closeErr?.message ?? "matched 0 rows");
          await postSlackOpsAlert({
            kind: "custom",
            severity: "warning",
            title: "Approved on behalf of the person who posted it, but the support request stayed open",
            message: `An admin approved job ${job.id} for the person who posted it and the payout is scheduled, but its job_approval_escalations row was not closed. Close it with Mark reviewed; no money is affected.`,
            fields: { job_id: job.id, db_error: (closeErr?.message ?? "matched 0 rows").slice(0, 200) },
          });
        }
        await logAdminMoneyAction(supabaseAdmin, {
          adminId: user.id,
          action: "approve_for_poster",
          jobId: job.id,
          details: { both_done: bothDone, payout_at: updateFields.payout_scheduled_at ?? null, helper_payout: bothDone ? helperPayout : 0 },
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
        await insertNotifications(supabaseAdmin, {
          user_id: job.helper_id,
          title: "Revision requested",
          message: `The person who posted "${job.title}" has requested revisions: ${note || "Please check the details."}`,
          type: "warning", link: `/jobs?job=${job.id}`,
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

      await insertNotifications(supabaseAdmin, {
        user_id: job.customer_id,
        title: "Revision completed — review needed",
        message: `The helpr has fixed the revision for "${job.title}". You have 72 hours to approve it or open a dispute. If we don't hear from you by then, Helpr support will reach out. Your payment stays held until it's approved.`,
        type: "warning", link: `/posts?job=${job.id}`,
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
      // BEFORE any money math. The $1 floor keeps the charge above Stripe's 50¢
      // minimum and keeps the card fee (added on top; 34¢ on a $1 tip) a small
      // share of what the poster pays; the $1,000 ceiling bounds a
      // fat-finger / abusive charge and matches the tips.amount CHECK.
      if (typeof amount !== "number" || !Number.isFinite(amount)) {
        throw new PublicError("Invalid tip amount");
      }
      const tipCents = Math.round(amount * 100);
      if (tipCents < TIP_MIN_CENTS || tipCents > TIP_MAX_CENTS) {
        throw new PublicError(`Tips must be between $${TIP_MIN_CENTS / 100} and $${(TIP_MAX_CENTS / 100).toLocaleString("en-US")}`);
      }

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");
      if (job.status !== "completed") throw new PublicError("Job must be completed to tip");
      if (user.id !== job.customer_id) throw new PublicError("Only the person who posted this job can tip the Helpr");

      // A crew has no lead (Q407): the poster tips a MEMBER, named in the
      // request, who must be on this job's roster. A single-helper job tips its
      // hired Helpr exactly as before (a named helper is ignored there).
      let helperId: string;
      if (job.is_group_job) {
        const named = (body as { helperId?: unknown }).helperId;
        if (typeof named !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(named)) {
          throw new PublicError("Choose which Helpr on the crew to tip");
        }
        const { data: slot, error: slotErr } = await supabaseAdmin
          .from("group_job_helpers")
          .select("id")
          .eq("job_id", jobId)
          .eq("helper_id", named)
          .limit(1);
        if (slotErr) {
          console.error(`[create-payment] tip — crew roster read failed for job ${jobId}:`, slotErr);
          throw new PublicError("Could not verify who worked this job — please try again");
        }
        if ((slot?.length ?? 0) === 0) throw new PublicError("That Helpr didn't work this job");
        helperId = named;
      } else {
        if (!job.helper_id) throw new PublicError("No Helpr assigned to this job");
        helperId = job.helper_id;
      }
      const tipReview = await underBanReview(supabaseAdmin, user.id, helperId);
      if (tipReview === "payer") throw new PublicError(PAYER_UNDER_REVIEW);

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

      // Payout hold (Q764): a tip is a destination charge, so Stripe moves it
      // to the Helpr the moment the poster pays. A held Helpr is sent nothing,
      // so no tip checkout is opened for them. The poster is not told why (the
      // hold is a staff review); an unreadable hold fails closed.
      const tipHold = await checkPayoutHold(supabaseAdmin, helperId);
      if (tipHold.kind === "error") {
        console.error(`[create-payment] tip — payout hold check failed for ${helperId}: ${tipHold.message}`);
        throw new PublicError("Could not verify the Helpr's payout account — please try again");
      }
      if (tipHold.kind === "held" || tipReview === "counterparty") {
        return new Response(
          JSON.stringify({ error: "This Helpr can't receive tips right now. Please try again later.", code: PAYOUT_HELD_CODE }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
        );
      }

      // Owner 2026-10-30: tips are blocked until the Helpr has verified their ID. No checkout opens and no money is
      // taken. FALSE while the identity_check switch is off. An unreadable answer fails closed.
      const tipIdHold = await checkIdentityHold(supabaseAdmin, helperId);
      if (tipIdHold.kind === "error") {
        console.error(`[create-payment] tip — ID check read failed for ${helperId}: ${tipIdHold.message}`);
        throw new PublicError("Could not verify the Helpr's payout account — please try again");
      }
      if (tipIdHold.kind === "waits") {
        return new Response(
          JSON.stringify({ error: TIP_WAITS_ON_ID_MESSAGE, code: TIP_WAITS_ON_ID_CODE }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
        );
      }

      // The Helpr receives 100% of the tip. Stripe's card-processing cost is
      // added ON TOP, inside the ONE tip line the tipper sees on the Checkout
      // page (owner 2026-10-25: the total only, no card-fee line; the tip
      // dialog quotes the same total from tipChargeBreakdown).
      // On this destination charge Stripe transfers `charge - application fee`
      // to the Helpr, so application_fee_amount = feeCents leaves the Helpr's
      // transfer at exactly tipCents, and the platform keeps only what covers
      // Stripe's card fee on the whole charge.
      const tipQuote = tipChargeBreakdown(tipCents);

      // A tip is a DESTINATION charge (transfer_data to the Helpr's account):
      // Stripe refuses it, before any money moves, when that account cannot
      // receive money. Not live-gated (lead 2026-10-23): the refusal is made
      // LOUD instead, a plain sentence for the poster and an ops alert
      // (error_logs) once a day (_shared/livePayoutHold.ts).
      let session;
      try {
        session = await stripe.checkout.sessions.create({
        customer: await payerWalletCustomer(),
        line_items: [
          {
            price_data: {
              currency: "usd",
              tax_behavior: TAX_BEHAVIOR,
              // Owner 2026-10-25: the tipper sees only the total they pay, no
              // card-fee line. ONE line for the whole charge; the application
              // fee below still keeps exactly feeCents, so the Helpr's
              // transfer stays tipCents (money unchanged).
              product_data: { name: `Tip — ${job.title}`, description: `Your Helpr receives your whole $${(tipQuote.tipCents / 100).toFixed(2)} tip.`, tax_code: NONTAXABLE_TAX_CODE },
              unit_amount: tipQuote.chargeCents,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        // Card (incl. Apple/Google Pay) and Link only: the fee line recovers
        // the CARD rate, so a Klarna/Affirm tip would cost the platform the
        // difference (Q383).
        payment_method_types: TIP_PAYMENT_METHOD_TYPES,
        adaptive_pricing: { enabled: false },
        // 3D Secure from $300 (Q202), same rule as the job charge, measured on
        // what the card is actually charged.
        payment_method_options: threeDSecureOptions(tipQuote.chargeCents),
        payment_intent_data: {
          transfer_data: {
            destination: helperProfile.stripe_account_id,
          },
          application_fee_amount: tipQuote.feeCents,
          // Amounts only. No job_id here: paymentIntentPaymentFailed reads
          // pi.metadata.job_id as "the JOB's escrow charge failed" and would
          // tell the poster their job payment failed on a declined tip.
          metadata: {
            type: "tip",
            tip_cents: String(tipQuote.tipCents),
            fee_cents: String(tipQuote.feeCents),
            helper_cents: String(tipQuote.helperCents),
          },
        },
        success_url: buildRedirectUrl(`/posts?tip=success`, isNative),
        cancel_url: buildRedirectUrl(`/posts`, isNative),
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
        // The key names the charged total as well as the tip, so a retry can
        // only replay a session whose money fields are identical.
        // A crew tip names its member too, so tipping two members the same
        // amount in one attempt window is two sessions, not one replayed.
        idempotencyKey: tipAttemptId
          ? `tip-${jobId}-${user.id}${job.is_group_job ? `-${helperId}` : ""}-${tipCents}-c${tipQuote.chargeCents}-${tipAttemptId}`
          : `tip-${jobId}-${user.id}${job.is_group_job ? `-${helperId}` : ""}-${tipCents}-c${tipQuote.chargeCents}-${Math.floor(Date.now() / 600_000)}`,
      });
      } catch (tipErr) {
        const refused = await noteDestinationChargeRefused(tipErr, {
          fn: "create-payment",
          what: "A tip checkout",
          helperId,
          fields: { job_id: jobId, tip_cents: tipCents },
        });
        if (refused) throw new PublicError(refused);
        throw tipErr;
      }

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

    // ─── RECURRING VISIT: on-session payment for a $300+ visit (Q210b) ───
    // charge-recurring-visits never charges a visit of THREE_D_SECURE_MIN_CENTS
    // or more off-session (owner, 2026-09-27): 3D Secure needs the payer there.
    // It parks the visit in recurring_visit_payments as 'pending'; this opens a
    // Checkout for exactly that row's amount. The webhook marks it 'paid' and
    // the cron books the visit on that PaymentIntent.
    if (action === "recurring_visit") {
      const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId)) {
        throw new PublicError("Missing visit payment");
      }
      if (await underBanReview(supabaseAdmin, user.id)) throw new PublicError(PAYER_UNDER_REVIEW);
      const { data: row, error: rowErr } = await supabaseAdmin
        .from("recurring_visit_payments")
        .select("id, parent_job_id, visit_date, payer_id, status, budget_cents, fee_cents, tax_cents, amount_cents, stripe_session_id")
        .eq("id", paymentId)
        .maybeSingle();
      if (rowErr) {
        console.error("[create-payment] recurring_visit — row read failed:", rowErr);
        throw new PublicError("Could not load this visit payment — please try again");
      }
      if (!row || row.payer_id !== user.id) throw new PublicError("Visit payment not found");
      if (row.status !== "pending") throw new PublicError("This visit is no longer waiting for payment");
      if (String(row.visit_date) <= louisianaToday()) throw new PublicError("This visit's payment window has closed");

      const { data: parent, error: parentErr } = await supabaseAdmin
        .from("jobs")
        .select("id, title, status, series_ended_on, customer_id")
        .eq("id", row.parent_job_id)
        .maybeSingle();
      if (parentErr) {
        console.error("[create-payment] recurring_visit — series read failed:", parentErr);
        throw new PublicError("Could not load this series — please try again");
      }
      if (!parent || parent.customer_id !== user.id || parent.series_ended_on || parent.status === "cancelled") {
        throw new PublicError("This series has ended");
      }

      // Reuse the open session so a double tap or a return visit never opens a
      // second Checkout for the same visit. A prior session that is not reused
      // is EXPIRED before a new one exists, and if that cannot be confirmed no
      // new one is made: two payable sessions for one visit is a double charge.
      if (row.stripe_session_id) {
        let prior: Stripe.Checkout.Session | null = null;
        try {
          prior = await stripe.checkout.sessions.retrieve(row.stripe_session_id);
        } catch (e) {
          console.warn("[create-payment] recurring_visit — could not read the prior session:", e);
        }
        if (prior?.status === "open" && prior.url) {
          return new Response(JSON.stringify({ url: prior.url }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
          });
        }
        if (prior?.status === "complete") throw new PublicError("This visit is already paid");
        if (prior?.status !== "expired") {
          try {
            await stripe.checkout.sessions.expire(row.stripe_session_id);
          } catch (e) {
            console.error("[create-payment] recurring_visit — prior session not expired, refusing a second:", e);
            throw new PublicError("Could not start this payment — please try again");
          }
        }
      }

      // Stripe needs at least 30 minutes; close it by the visit date at the
      // latest (the cron expires the row that day) and within 24 hours. Built
      // from a 10-minute bucket so a retry sends the SAME params under the same
      // idempotency key (a changed expires_at would be refused for 24h).
      const bucketSec = Math.floor(Date.now() / 1000 / 600) * 600;
      // The visit's day starts at Louisiana midnight, not UTC midnight: the UTC
      // one is 5-6 hours EARLIER, so from 19:00 CDT the evening before it read
      // as already started and the payment window closed a day early (Q1203).
      const visitStartSec = Math.floor(jobLocalMidnightMs(String(row.visit_date)) / 1000);
      // Too close to the visit to pay before it: the payment would be refunded.
      if (visitStartSec - bucketSec < 40 * 60) throw new PublicError("This visit's payment window has closed");
      const expiresAt = Math.min(bucketSec + 24 * 60 * 60, visitStartSec);

      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
        {
          price_data: {
            currency: "usd",
            tax_behavior: TAX_BEHAVIOR,
            product_data: { name: `Visit — ${parent.title} on ${row.visit_date}`, tax_code: NONTAXABLE_TAX_CODE },
            // Owner 2026-10-25: no fee line to members. A series sold before
            // the flat model still carries its card-cost fee; it is part of
            // what the visit costs, so it is in this line (the total is unchanged).
            unit_amount: row.budget_cents + Math.max(0, row.fee_cents),
          },
          quantity: 1,
        },
      ];
      if (row.tax_cents > 0) {
        lineItems.push({
          price_data: {
            currency: "usd",
            tax_behavior: TAX_BEHAVIOR,
            product_data: { name: "Sales tax", tax_code: NONTAXABLE_TAX_CODE },
            unit_amount: row.tax_cents,
          },
          quantity: 1,
        });
      }

      const session = await stripe.checkout.sessions.create({
        customer: await payerWalletCustomer(),
        line_items: lineItems,
        mode: "payment",
        payment_method_types: ["card"],
        adaptive_pricing: { enabled: false },
        // The reason this path exists: 3D Secure from $300 (Q202).
        payment_method_options: threeDSecureOptions(row.amount_cents),
        payment_intent_data: {
          description: `Helpr recurring visit — ${parent.title} on ${row.visit_date}`,
          // No transfer_data: escrow, exactly like the off-session visit charge.
          // No job_id: paymentIntentPaymentFailed reads pi.metadata.job_id as
          // "this job's escrow charge failed".
          metadata: {
            type: "recurring_visit",
            parent_job_id: String(row.parent_job_id),
            visit_date: String(row.visit_date),
            recurring_visit_payment_id: row.id,
          },
        },
        expires_at: expiresAt,
        success_url: buildRedirectUrl(`/posts?visit=paid`, isNative),
        cancel_url: buildRedirectUrl(`/posts`, isNative),
        metadata: { kind: "recurring_visit", recurring_visit_payment_id: row.id, payer_id: user.id },
      }, {
        idempotencyKey: `recurring-visit-checkout:${row.id}:${row.stripe_session_id ?? "first"}:${bucketSec}`,
      });

      const { data: stored, error: storeErr } = await supabaseAdmin
        .from("recurring_visit_payments")
        .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id");
      if (storeErr || !stored || stored.length === 0) {
        console.error("[create-payment] recurring_visit — session id not stored:", storeErr ?? "zero rows");
        // Q750 (5): zero rows means the row stopped waiting for payment (the
        // visit-date sweep expired it, or the series ended) between the read
        // and here, so this session can never be stored and no sweep would
        // ever close it. Close it now. A database ERROR is left open on
        // purpose: a retry in the same 10-minute bucket gets this very session
        // back from Stripe on the idempotency key and stores it, and an
        // expired one would hand the payer a dead Checkout page. Its URL was
        // never returned, so nobody can pay it meanwhile.
        if (!storeErr) {
          try {
            await stripe.checkout.sessions.expire(session.id);
          } catch (e) {
            console.warn("[create-payment] recurring_visit — unstored session not expired:", e);
          }
        }
        throw new PublicError("Could not start this payment — please try again");
      }

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── CANCEL ESCROW ───
    // ─── CANCEL QUOTE: what a poster's cancel would send back (read only) ───
    // Boards 66/172 slice 2 (2026-10-21), the shops_order_cancel_quote pattern:
    // the cancel dialog asks this BEFORE the poster confirms, shows "Back to
    // you $X" from it, and passes its fee_cents to poster_cancel_job as
    // p_expected_fee_cents (a tier that moved in between is refused there with
    // quote_changed, nothing written). The amount is posterCancelSplit, the
    // SAME function void-cancelled-payments refunds with, fed the charge's real
    // Stripe fee, tax and earlier refunds. Moves no money and writes nothing.
    // Where the sweep would price the refund some other way (a crew, a gift on
    // the job, an earlier refund, fees larger than the card payment, a payee
    // in the other Stripe mode, an unreadable input), back_to_you_cents is
    // null with the reason: the dialog then shows no number rather than one
    // the sweep did not compute.
    if (action === "cancel_quote") {
      const jobId = typeof body?.jobId === "string" ? body.jobId : "";
      if (!jobId) throw new PublicError("Missing jobId");
      const quoteJson = (payload: Record<string, unknown>, status = 200) =>
        new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
      const { data: qJob, error: qJobErr } = await supabaseAdmin.from("jobs").select("*").eq("id", jobId).maybeSingle();
      // A malformed id (22P02) is a job that does not exist, as readJobParties answers it (lh-authz-rls review nit 4).
      if (qJobErr?.code === "22P02") return quoteJson({ error: "Job not found" }, 404);
      if (qJobErr) {
        console.error(`[create-payment] cancel_quote job read failed for ${jobId}: ${qJobErr.message}`);
        return quoteJson({ error: "Couldn't work out the refund right now. Try again." }, 503);
      }
      // Only the poster: anyone else is told nothing about the job (no oracle).
      if (!qJob || qJob.customer_id !== user.id) return quoteJson({ error: "Job not found" }, 404);
      const nowIso = new Date().toISOString();
      // poster_cancel_job's own refusals, read the same way (it re-decides under its lock).
      if (!["open", "accepted", "in_progress", "revision_requested"].includes(String(qJob.status)) || qJob.helper_completed_at) {
        return quoteJson({ can_cancel: false, quoted_at: nowIso });
      }
      let feePercent: number | null = null;
      const unquoted = (reason: string, feeCents: number | null) =>
        quoteJson({ can_cancel: true, fee_cents: feeCents, fee_percent: feePercent, back_to_you_cents: null, unquoted_reason: reason, charge_state: null, quoted_at: nowIso });
      // A crew prices from its roster ledger, written only by the cancel itself.
      if (qJob.is_group_job) return unquoted("crew", null);
      // THE ladder poster_cancel_job records and checks p_expected_fee_cents
      // against (_shared/cancellationFee.ts, cent for cent with the SQL).
      // Owner 2026-10-30: a hired Helpr who has not verified their ID and has not headed out carries
      // no fee, exactly as poster_cancel_job records it. Unreadable: no amount quoted.
      const { data: qIdWaits, error: qIdErr } = qJob.helper_id && !qJob.helper_on_the_way_at && !qJob.helper_arrived_at
        ? await supabaseAdmin.rpc("payout_waits_on_identity", { p_user_id: qJob.helper_id })
        : { data: false, error: null };
      if (qIdErr && qIdErr.code !== "PGRST202") return unquoted("unreadable", null);
      const feeCents = qIdWaits === true ? 0 : Math.round(computeCancellationFee({ ...qJob, cancelled_at: nowIso }) * 100);
      // Its tier, from the same ladder (0 when no fee is recorded).
      feePercent = feeCents > 0 && qJob.date_needed
        ? cancellationFeePercent(helperIsCommitted(qJob), hoursUntilJob(qJob.date_needed, nowIso, qJob.start_time ?? null))
        : 0;
      if (qJob.payment_status !== "escrow") return unquoted("not_in_escrow", feeCents);
      const { data: qGift, error: qGiftErr } = await supabaseAdmin
        .from("gift_cards").select("id").eq("job_id", jobId).in("status", ["redeemed", "reserved"]).limit(1);
      if (qGiftErr) return unquoted("unreadable", feeCents);
      if ((qGift?.length ?? 0) > 0) return unquoted("gift", feeCents);
      // A10: void-cancelled-payments reads the same marker (a missing table or column reads "not marked").
      const { data: qFault, error: qFaultErr } = await supabaseAdmin
        .from("declutter_order_jobs").select("seller_fault_refund_id").eq("job_id", jobId).maybeSingle();
      if (qFaultErr && !["42P01", "42703", "PGRST204", "PGRST205"].includes(qFaultErr.code ?? "")) return unquoted("unreadable", feeCents);
      const qSellerFault = !qFaultErr && !!qFault?.seller_fault_refund_id;
      // The sweep's own fee rule: no fee on a seller-fault setup job or an unfilled / ban-ended series visit.
      const owedFeeCents = qSellerFault || refundsSeriesVisitInFull(qJob) ? 0 : feeCents;
      if (owedFeeCents > 0) {
        // A fee owed to a payee of the other Stripe mode goes back with the refund instead (the sweep's feePayeesShareMode).
        try {
          await jobMoneyMode(supabaseAdmin, jobId, { kind: "payout", extraParties: [qJob.helper_id] });
        } catch (modeErr) {
          if (!(modeErr instanceof StripeModeRefused)) throw modeErr;
          // One word for every such case: "mixed" would tell the poster whether their Helpr is a test account
          // (lh-authz-rls review nit 5); the log keeps the detail.
          console.warn(`[create-payment] cancel_quote job ${jobId}: fee payee mode ${modeErr.reason}; no amount quoted`);
          return unquoted("unreadable", feeCents);
        }
      }
      let qPiId: string | null = typeof qJob.stripe_payment_intent_id === "string" ? qJob.stripe_payment_intent_id : null;
      try {
        if (!qPiId && qJob.stripe_session_id) {
          const qSession = await stripe.checkout.sessions.retrieve(qJob.stripe_session_id);
          const sPi = qSession.payment_intent;
          qPiId = typeof sPi === "string" ? sPi : sPi?.id ?? null;
        }
        if (!qPiId) return unquoted("no_payment", feeCents);
        const qPi = await stripe.paymentIntents.retrieve(qPiId, { expand: ["latest_charge.balance_transaction"] });
        if (qPi.status === "requires_capture") {
          const holdSplit = posterCancelSplit({
            job: qJob, sellerFault: qSellerFault, cancellationFeeCents: owedFeeCents, blockFeeCents: 0,
            charge: {
              state: "hold",
              amountCents: Number(qPi.amount ?? 0),
              capturableCents: Math.max(0, Math.round(Number(qPi.amount_capturable ?? qPi.amount ?? 0))),
            },
          });
          if (holdSplit.state !== "hold" || holdSplit.feesExceedHold) return unquoted("fees_exceed_payment", feeCents);
          return quoteJson({ can_cancel: true, fee_cents: feeCents, fee_percent: feePercent, back_to_you_cents: holdSplit.backCents, unquoted_reason: null, charge_state: "hold", quoted_at: nowIso });
        }
        if (qPi.status !== "succeeded") return unquoted("payment_state", feeCents);
        const capturedCents = qPi.amount_received ?? qPi.amount;
        // The sweep reads Stripe's REAL fee off the balance transaction; a
        // charge whose fee is not settled yet would be an estimate, so no number.
        const realFeeCents = actualStripeFeeCents(qPi);
        const alreadyRefundedCents = Number(
          (qPi.latest_charge && typeof qPi.latest_charge === "object"
            ? (qPi.latest_charge as { amount_refunded?: number }).amount_refunded
            : 0) ?? 0,
        );
        // An earlier refund on the charge (an admin's partial, a duplicate setup fee) changes what the sweep may return.
        if (realFeeCents === null) return unquoted("unreadable", feeCents);
        if (alreadyRefundedCents > 0) return unquoted("earlier_refund", feeCents);
        const taxCents = await checkoutChargeTaxCents(stripe, qPi);
        if (taxCents === null) return unquoted("unreadable", feeCents);
        const capturedSplit = posterCancelSplit({
          job: qJob, sellerFault: qSellerFault, cancellationFeeCents: owedFeeCents, blockFeeCents: 0,
          charge: { state: "captured", capturedCents, actualFeeCents: realFeeCents, alreadyRefundedCents, taxCents },
        });
        if (capturedSplit.state !== "captured" || !capturedSplit.feesFitCard) return unquoted("fees_exceed_payment", feeCents);
        return quoteJson({ can_cancel: true, fee_cents: feeCents, fee_percent: feePercent, back_to_you_cents: capturedSplit.backCents, unquoted_reason: null, charge_state: "captured", quoted_at: nowIso });
      } catch (quoteErr) {
        // A quote that cannot read Stripe shows no number; the cancel itself still works.
        console.warn(`[create-payment] cancel_quote could not read the payment for job ${jobId}: ${caughtMessage(quoteErr)}`);
        return unquoted("unreadable", feeCents);
      }
    }

    if (action === "cancel_escrow") {
      const { jobId } = body;
      if (!jobId) throw new PublicError("Missing jobId");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");
      if (job.customer_id !== user.id) throw new PublicError("Not authorized");

      // ── Only an unhired, undisputed job is the poster's to refund here ──
      // A group job's crew is its roster (group_job_helpers); jobs.helper_id is
      // only the lead, and is NULL on a crew whose lead left or was removed
      // (20260925140148). A crew with hired members is a hired job: it goes
      // through Cancel job like any other. Fail-closed on a read error.
      const { data: crew, error: crewErr } = await supabaseAdmin
        .from("group_job_helpers")
        .select("id")
        .eq("job_id", jobId)
        .limit(1);
      if (crewErr) {
        console.error(`[create-payment] cancel_escrow roster check failed for job ${jobId}: ${crewErr.message}`);
        return new Response(JSON.stringify({
          error: "Couldn't check who is hired on this job. No money was moved — try again.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
      }
      if ((crew?.length ?? 0) > 0) {
        console.error(
          `[create-payment] cancel_escrow REFUSED on job ${jobId} (caller ${user.id}): group job with hired crew members, helper=${job.helper_id ?? "none"}`,
        );
        return new Response(JSON.stringify({
          error: "This job has a Helpr or has already started, so it has to be cancelled with Cancel job — that applies the cancellation rules and refunds you. No money was moved.",
          useCancelJob: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
      }

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

      // ── A card only HELD (Q2399): nothing was charged, so nothing is
      // refunded. The job is closed and the hold cancelled (no refund, no fee);
      // the poster is told their card was not charged. Same allowlist as the
      // refund below (open, nobody hired, no dispute: checked above), pinned
      // to the payment state read so a capture landing between wins.
      const failedHold = job.payment_status === "failed" ? await readHold(supabaseAdmin, jobId) : null;
      // A failed hold the poster re-paid by bank carries that payment, which is
      // refunded the ordinary way below, never "released" (review #9).
      if (job.payment_status === "held" ||
          (failedHold && (job.stripe_payment_intent_id == null || job.stripe_payment_intent_id === failedHold.payment_intent_id))) {
        // A Helpr's accept is capturing this hold right now: the cancel waits
        // (the capture re-reads the job after its claim, so the two never both
        // win; round 2, money #1).
        const live = job.payment_status === "held" ? await readHold(supabaseAdmin, jobId) : failedHold;
        if (live?.state === "capturing") {
          return new Response(JSON.stringify({ error: "A Helpr is accepting this job right now. Refresh in a minute to see where it stands." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409,
          });
        }
        const { data: closed, error: closeErr } = await supabaseAdmin
          .from("jobs")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: user.id })
          .eq("id", jobId)
          .eq("status", "open")
          .is("helper_id", null)
          .eq("payment_status", job.payment_status)
          .select("id");
        if (closeErr || !closed || closed.length === 0) {
          console.error(`[create-payment] cancel_escrow on held job ${jobId} did not close it: ${closeErr?.message ?? "matched 0 rows"}`);
          return new Response(JSON.stringify({ error: "This job changed while it was being cancelled, so it was not cancelled. Refresh to see where it stands." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409,
          });
        }
        let released: Awaited<ReturnType<typeof releaseCardHold>> | "later";
        try {
          released = await releaseCardHold({ db: supabaseAdmin, stripe, mode: stripeMode }, jobId);
        } catch (e) {
          // The job IS cancelled; only the hold's release did not finish (a
          // capture claim in the way, Stripe unreadable). card-hold-sweep
          // releases it and tells the poster: never an error over a cancel
          // that happened (round 2, money #5).
          console.error(`[create-payment] cancel_escrow: job ${jobId} cancelled, hold release left to card-hold-sweep: ${caughtMessage(e)}`);
          released = "later";
        }
        if (released === "captured") {
          return new Response(JSON.stringify({ error: "This job's payment needs a look from our team. Support has the details." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409,
          });
        }
        return new Response(JSON.stringify({ success: true, released: true, message: CARD_HOLD_COPY.releasedTitle }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
        });
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
      //
      // Q1323: 'cancelling' is re-entered only when it is cancel_escrow's own
      // stranded claim. A full admin refund (admin_refund_general, Q1290) takes
      // the same state; taking it over refunded the charge under a second
      // key. Its marker is read first, and the claim is also pinned to the
      // exact payment_status read, so an admin claim landing after this read
      // is not taken over either.
      // Re-entry needs the marker to say cancel_escrow POSITIVELY: no row, an
      // admin's row, or an unreadable one all refuse (lh-authz-rls review of
      // Q1323: an absent row is not "mine").
      if (job.payment_status === "cancelling") {
        const holder = await readRefundClaim(supabaseAdmin, jobId);
        if (holder.claimedBy !== "cancel_escrow" || holder.error) {
          return new Response(JSON.stringify({
            error: holder.error
              ? "Couldn't check this job's refund in progress. No money was moved — try again."
              : holder.claimedBy === "admin_refund_general"
              ? "An admin refund of this job is in progress, so it can't be cancelled here. No money was moved."
              : "A refund of this job is already in progress and could not be confirmed as this cancellation's own. No money was moved; support has the details.",
            refundClaimedBy: holder.claimedBy,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: holder.error ? 503 : 409 });
        }
      }
      // ── A crew emptied by a block still owes its block fees (Q2133) ──
      // block_user_and_settle sets a crew whose last member the poster blocked
      // back to 'open' with nobody on the roster, so it passes every check
      // here, while the blocked members' fees stay in crew_block_fees. This
      // refund has no block-fee term: it returned that money to the poster,
      // and void-cancelled-payments Part F then paid the members from the
      // platform's own balance. Cancel job (poster_cancel_job, then the sweep)
      // withholds the fees and pays them, so this door refuses and sends the
      // poster there. Any row but a void one counts (a paid one already left
      // from this charge). Checked here, after the allowlist and the claim-holder
      // check (so a disputed job or an admin's claim keeps its own reply), with
      // no claim taken, and again after the claim below (the race: a block
      // that commits in between). Fails
      // CLOSED: a read error refuses too, with no database text shown.
      // A job read 'cancelling' is an earlier stranded claim: Cancel job on it
      // would leave cancelled/cancelling, which nothing settles, so it is not
      // sent there; ops is paged instead (money review of Q2133 #1).
      const refuseOwedBlockFees = async (blocked: { status: number; error: string; cents: number }) => {
        const unreadable = blocked.status === 503;
        console.error(
          `[create-payment] cancel_escrow REFUSED on job ${jobId} (caller ${user.id}): ${unreadable ? `crew block fees unreadable (${blocked.error})` : `${blocked.cents}¢ of crew block fees owed`}, payment_status=${job.payment_status}`,
        );
        const json = (b: Record<string, unknown>, status: number) =>
          new Response(JSON.stringify(b), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
        if (unreadable) {
          return json({ error: "Couldn't check whether a crew member is owed money from this job. No money was moved; try again." }, 503);
        }
        const strandedClaim = job.payment_status === "cancelling";
        if (strandedClaim) {
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "critical",
            title: "Stranded crew cancel owes block fees",
            message: `cancel_escrow was re-run on crew job ${jobId}, left 'cancelling' by an earlier run, and a blocked crew member is owed $${(blocked.cents / 100).toFixed(2)} from its payment. Nothing was moved. Check Stripe for a refund on this job's charge, set payment_status back to 'escrow' by hand if none went out, then cancel the job (the sweep keeps the fee).`,
            fields: { job_id: jobId, block_fee_cents: blocked.cents, payment_status: String(job.payment_status) },
            oncePerDayKey: `cancel-escrow-block-fee-stranded:${jobId}`,
          });
          return json({
            error: "A refund of this job is already in progress and could not be finished here. No money was moved; support has the details.",
            crewBlockFeeCents: blocked.cents,
          }, 409);
        }
        return json({
          error: `A crew member you blocked on this job is owed $${(blocked.cents / 100).toFixed(2)} from its payment for their time, so this job has to be cancelled with Cancel job: that pays them and sends most of the rest back to you. No money was moved.`,
          useCancelJob: true,
          crewBlockFeeCents: blocked.cents,
        }, 409);
      };
      // Only where the claim below could succeed: any other payment_status is
      // refused by the claim itself ("can no longer be cancelled").
      if (job.payment_status === "escrow" || job.payment_status === "cancelling") {
        const owedBeforeClaim = await crewBlockFeeRefusal(supabaseAdmin, job);
        if (owedBeforeClaim) return await refuseOwedBlockFees(owedBeforeClaim);
      }

      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from("jobs")
        .update({ payment_status: "cancelling" })
        .eq("id", jobId)
        .eq("status", job.status)
        .in("payment_status", ["escrow", "cancelling"])
        .eq("payment_status", job.payment_status)
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
      // Q1323: the holder is recorded or the claim is not kept (an unrecorded
      // claim could not be re-entered, and nobody could tell whose it was).
      if (!(await recordRefundClaim(supabaseAdmin, jobId, "cancel_escrow", user.id))) {
        // putCancelClaimBack is declared further down; the same CAS inline.
        // Escrow-only (lh-authz-rls re-review of Q1323): a RE-ENTERED claim
        // (job read 'cancelling') may follow an earlier run that already
        // refunded, so it is never moved to 'escrow' here; it stays
        // 'cancelling' under its existing cancel_escrow row and answers 503.
        const reenteredClaim = job.payment_status !== "escrow";
        if (reenteredClaim) {
          return new Response(JSON.stringify({
            error: "Couldn't start the cancellation. No money was moved — try again.",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
        }
        const restoreTo = "escrow";
        const { data: back, error: backErr } = await supabaseAdmin
          .from("jobs").update({ payment_status: restoreTo })
          .eq("id", jobId).eq("status", job.status).eq("payment_status", "cancelling")
          .select("id");
        if (backErr || !back || back.length === 0) {
          await claimPutBackMissed(supabaseAdmin, {
            jobId, path: "cancel_escrow", why: "its claim holder could not be recorded", restoreTo: restoreTo ?? null, dbError: backErr?.message ?? null,
          });
        } else {
          await deleteRefundClaim(supabaseAdmin, jobId);
        }
        return new Response(JSON.stringify({
          error: "Couldn't start the cancellation. No money was moved — try again.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
      }

      // ── A crew is hired through its roster, never through helper_id ──
      // The claim's `helper_id IS NULL` stands for "nobody is hired", which is
      // not true of a group job: a crew has no lead and jobs.helper_id is NULL
      // on every group job (20260925154606). The roster read above can be
      // overtaken by a hire that commits before this claim, so read it again
      // NOW. It is final: the claimed job reads payment_status 'cancelling',
      // and enforce_group_roster_award_gate refuses to add a crew member to an
      // unfunded job, so no hire can land after this line. Anyone hired puts
      // the claim back and sends the poster to Cancel job; a read error does
      // the same and moves no money (fail closed).
      if (job.is_group_job) {
        const { data: crewNow, error: crewNowErr } = await supabaseAdmin
          .from("group_job_helpers")
          .select("id, helper_id")
          .eq("job_id", jobId)
          .limit(1);
        if (crewNowErr || (crewNow?.length ?? 0) > 0) {
          const { data: restored, error: restoreErr } = await supabaseAdmin
            .from("jobs")
            .update({ payment_status: job.payment_status })
            .eq("id", jobId)
            .eq("status", job.status)
            .eq("payment_status", "cancelling")
            .select("id");
          if (restoreErr || !restored || restored.length === 0) {
            console.error(
              `CRITICAL: [create-payment] cancel_escrow on crew job ${jobId} could not put its claim back (payment_status stays 'cancelling'; no money moved): ${restoreErr?.message ?? "zero rows"}`,
            );
            // A job stuck in 'cancelling' blocks every payout and hire on it
            // (money review LOW-12): page, do not only log.
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "critical",
              title: "Crew job stuck in 'cancelling' — claim could not be put back",
              message: `cancel_escrow claimed crew job ${jobId} (payment_status -> 'cancelling'), found a hired member, and could not restore payment_status. No money moved. Set payment_status back to '${job.payment_status}' by hand.`,
              fields: { job_id: jobId, restore_to: String(job.payment_status), db_error: (restoreErr?.message ?? "zero rows").slice(0, 200) },
            });
          } else if (job.payment_status === "escrow") {
            // A re-entered claim keeps its row (lh-authz-rls re-review of Q1323).
            await deleteRefundClaim(supabaseAdmin, jobId);
          }
          if (crewNowErr) {
            console.error(`[create-payment] cancel_escrow post-claim roster check failed for job ${jobId}: ${crewNowErr.message}`);
            return new Response(JSON.stringify({
              error: "Couldn't check who is hired on this job. No money was moved — try again.",
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
          }
          console.error(`[create-payment] cancel_escrow REFUSED after claim on job ${jobId} (caller ${user.id}): crew member ${crewNow?.[0]?.helper_id ?? "(anonymised)"} was hired`);
          return new Response(JSON.stringify({
            error: "This job has a Helpr or has already started, so it has to be cancelled with Cancel job — that applies the cancellation rules and refunds you. No money was moved.",
            useCancelJob: true,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
        }
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
      // Hand the 'cancelling' claim back when this call stops before any money
      // moved. The claim admits 'escrow' OR an earlier stranded 'cancelling'
      // (job 36eebad4 is one); putting 'cancelling' back would leave it stuck,
      // so a re-entered claim goes back to 'escrow' (lh-money-escrow review).
      const putCancelClaimBack = async (why: string): Promise<boolean> => {
        const restoreTo = job.payment_status === "cancelling" ? "escrow" : job.payment_status;
        const { data: putBack, error: putBackErr } = await supabaseAdmin
          .from("jobs")
          .update({ payment_status: restoreTo })
          .eq("id", jobId)
          .eq("status", job.status)
          .eq("payment_status", "cancelling")
          .select("id");
        if (putBackErr || !putBack || putBack.length === 0) {
          await claimPutBackMissed(supabaseAdmin, {
            jobId, path: "cancel_escrow", why, restoreTo: restoreTo ?? null, dbError: putBackErr?.message ?? null,
          });
          return false;
        }
        await deleteRefundClaim(supabaseAdmin, jobId);
        return true;
      };
      // A sandbox payment or session seen through the live key: nothing real to
      // refund, and nothing this call can do about it. Put the claim back (no
      // money moved) and answer a clear 409 instead of a 500 that strands the
      // job in 'cancelling' (function_logs 2026-09-30T15:55Z).
      const refuseTestModeCancel = async (stripeId: string | null) => {
        await putCancelClaimBack(`Stripe object ${stripeId} is a test-mode object under the live key`);
        console.error(`[create-payment] cancel_escrow REFUSED on job ${jobId}: ${stripeId} is a Stripe test-mode object and prod runs the live key`);
        return new Response(JSON.stringify({
          error: "This job was paid in Stripe test mode, so it can't be refunded here. No money was moved.",
          testModePayment: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
      };

      // Q2133, again after the claim: a block that committed between the
      // check above and the claim. Final here: only a block of a hired member
      // writes a fee row, and the post-claim roster read above saw nobody (no
      // hire lands on a 'cancelling' job). Nothing moved, so a fresh claim is
      // put back; a re-entered one stays 'cancelling', as on the session-read
      // exit (an earlier run may already have refunded).
      {
        const owedAfterClaim = await crewBlockFeeRefusal(supabaseAdmin, job);
        if (owedAfterClaim) {
          const why = `crew block fees ${owedAfterClaim.status === 503 ? "could not be read" : `of ${owedAfterClaim.cents}¢ are owed`}`;
          if (job.payment_status === "escrow") await putCancelClaimBack(why);
          return await refuseOwedBlockFees(owedAfterClaim);
        }
      }

      // Q86 (a): ONE meaning per payment_status. A captured charge that this
      // cancel refunds (less the non-refundable fee) ends 'refunded', the
      // same label void-cancelled-payments writes for the same outcome;
      // 'cancelled' stays "nothing was charged" (no PaymentIntent: a job the
      // gift card covered in full, or no payment found).
      let captureRefunded = false;
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
          // Never cancel without the refund. This catch used to log and carry
          // on with no PI, so a transient Stripe error here skipped the refund
          // below and still flipped the job to cancelled: the poster's money
          // stayed captured on a dead job (docs/OPEN.md Q891 item 3). Now the
          // claim goes back (no money moved) and the error rethrows, so a retry
          // re-reads the session; a sandbox session under the live key lands on
          // the outer catch's 409 floor.
          console.error(
            `[create-payment] cancel_escrow: could not retrieve session for PI (job ${jobId}); claim put back, nothing refunded or cancelled:`,
            sessionErr,
          );
          // Escrow-only: a re-entered 'cancelling' job may already have been
          // refunded by an earlier run (the gift-restore exit below leaves it
          // 'cancelling' after the refund), so writing 'escrow' back would make
          // gone money read as funded. It stays 'cancelling' (re-claimable,
          // and money-reconciliation's cancelling_stranded re-reports it).
          if (job.payment_status === "escrow") await putCancelClaimBack(`session ${job.stripe_session_id} could not be read`);
          throw sessionErr;
        }
      }

      if (cancelPaymentIntentId) {
        let pi: Stripe.PaymentIntent;
        try {
          pi = await stripe.paymentIntents.retrieve(cancelPaymentIntentId, {
            expand: ["latest_charge.balance_transaction"],
          });
        } catch (piErr) {
          if (!isTestObjectUnderLiveKey(piErr)) {
            // Same escrow-only rule as the session read above.
            if (job.payment_status === "escrow") {
              await putCancelClaimBack(`payment ${cancelPaymentIntentId} could not be read`);
            }
            throw piErr;
          }
          return await refuseTestModeCancel(cancelPaymentIntentId);
        }
        if (pi.status === "succeeded") {
          captureRefunded = true;
          // Service fee is non-refundable: Stripe already took its cut on the
          // full capture and does NOT return it on a refund, so a full refund
          // leaves the platform out-of-pocket by that processing cost on every
          // free cancellation. Withhold the poster's service fee, floored at
          // Stripe's ACTUAL processing cost for this specific charge (read from
          // the balance transaction, not assumed) so the platform never loses
          // money to fees regardless of payment method — cards, Klarna/Affirm/
          // Afterpay, and ACH all carry different real rates.
          const capturedCents = pi.amount_received ?? pi.amount;
          // A poster-fee job keeps no service fee, only Stripe's real fee
          // (posterCancelKeptFeeCents, Q2082 slice 4); any other job keeps
          // the fee its poster paid.
          const serviceFeeCents = posterCancelKeptFeeCents(job);
          // Q1674 (owner, 2026-10-12): a first job's $2 setup fee is kept on a
          // cancel ("paid and done": never refunded, never charged again).
          const setupFeeCents = setupFeeKeptCents(job);
          // A retry of a cancel that already refunded (the job is left
          // 'cancelling' when the gift restore below fails) must not refund
          // again: the idempotency key only dedupes for ~24h, and past that a
          // second refunds.create either errors (stranding the job) or, when
          // the withholding is at least half the capture, pays out twice.
          // The charge's own amount_refunded is the authority, and it comes
          // off what this cancel may still return (Q1675): an earlier refund
          // on the same charge (the duplicate $2 setup fee settleOnboardingFee
          // refunds, an admin's partial refund) already went back, and
          // pi.amount_received does not go down after it.
          const alreadyRefundedCents = Number(
            (pi.latest_charge && typeof pi.latest_charge === "object"
              ? (pi.latest_charge as { amount_refunded?: number }).amount_refunded
              : 0) ?? 0,
          );
          // THE refund amount (owner, 2026-10-14: never absorb a fee):
          // _shared/refundAmount.ts, the same definition every refund path uses.
          const cancelSplit = refundToPayerCents({
            capturedCents,
            actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents),
            customerFeeCents: serviceFeeCents,
            setupFeeCents,
            alreadyRefundedCents,
            taxCents: await chargeTaxCentsFor(stripe, pi),
          });
          const nonRefundableCents = cancelSplit.nonRefundableCents;
          const refundAmount = cancelSplit.refundCents;
          // Idempotency key prevents a double-refund on concurrent cancel
          // requests (double-tap, network retry) from both succeeding before
          // the payment_status flip below makes the second 409 out.
          // Skip the refund entirely if the withholding consumes the whole
          // capture (Stripe rejects a $0 refund); the job still flips cancelled.
          if (refundAmount === 0 && cancelSplit.ceilingCents > 0 && alreadyRefundedCents > 0) {
            console.log(
              `[create-payment] cancel_escrow: charge for job ${jobId} already refunded ${alreadyRefundedCents}¢ (>= ${cancelSplit.ceilingCents}¢ refundable) — not refunding again`,
            );
            // More than this cancel may return went back already: the fee it
            // keeps was given away by an earlier refund. Not a retry; a
            // person must look (lh-money-escrow review of Q1675 #2).
            if (alreadyRefundedCents > cancelSplit.ceilingCents + 1) {
              await postSlackOpsAlert({
                kind: "money_at_risk",
                severity: "warning",
                title: "Cancelled job's charge was already refunded past what the cancel keeps",
                message: "Earlier refunds on this charge returned more than a cancellation may (they ate into the card fee it keeps). Nothing more was refunded; reconcile by hand.",
                fields: { job_id: jobId, payment_intent: cancelPaymentIntentId, refunded_cents: alreadyRefundedCents, refundable_cents: cancelSplit.ceilingCents },
                oncePerDayKey: `cancel-refunded-past-kept:${jobId}`,
              });
            }
          } else if (refundAmount > 0) {
            let refund: Stripe.Refund;
            try {
              refund = await stripe.refunds.create(
                { payment_intent: cancelPaymentIntentId, amount: refundAmount },
                { idempotencyKey: `cancel-escrow-${jobId}` },
              );
            } catch (refundErr) {
              // Stripe ANSWERED "no" (job 2c8480ae, 2026-10-23: 400 "This
              // account is not currently able to refund charges"): no refund
              // exists, and the same key replays the same "no" for 24 hours.
              // The claim used to stay 'cancelling' behind a 500, so the job
              // was stuck mid-cancel with its money still captured and nothing
              // ever settled it. Hand the claim back (the job is funded again,
              // exactly as before the press) and say so plainly. A re-entered
              // claim goes back only when the charge shows no earlier refund
              // (an earlier run that refunded is read from amount_refunded).
              // Anything that is not a definite answer (timeout, 5xx, rate
              // limit) may have refunded: the claim stays and the error
              // rethrows, as before, so a retry on the same key settles it.
              if (!isDefinitiveStripeRefusal(refundErr)) throw refundErr;
              // A refusal that says the CHARGE changed under us (refunded or
              // disputed since we read it, or less left than we asked) is not
              // "nothing happened": the job must not read funded again. It
              // stays 'cancelling' for a person (lh-money-escrow review
              // 2026-10-25 #4).
              const refusalCode = String((refundErr as { code?: unknown }).code ?? "");
              const chargeChanged = ["charge_already_refunded", "charge_disputed", "amount_too_large"].includes(refusalCode) ||
                // An amount refusal may carry no code, only param 'amount'.
                String((refundErr as { param?: unknown }).param ?? "") === "amount";
              const safeToPutBack = !chargeChanged && (job.payment_status === "escrow" || alreadyRefundedCents === 0);
              const putBack = safeToPutBack
                ? await putCancelClaimBack(`Stripe refused the refund: ${caughtMessage(refundErr)}`)
                : false;
              console.error(
                `[create-payment] cancel_escrow: Stripe refused the refund for job ${jobId} (${cancelPaymentIntentId}); ` +
                  `${putBack ? "claim put back, job still funded" : safeToPutBack ? "claim put-back MISSED (paged)" : chargeChanged ? `claim kept (${refusalCode})` : "claim kept (the charge shows an earlier refund)"}:`,
                caughtMessage(refundErr),
              );
              await postSlackOpsAlert({
                kind: "money_at_risk",
                severity: "warning",
                title: "Stripe refused a cancellation refund",
                message: `Stripe refused the refund for a poster's cancel. No money moved in this call. ${putBack ? "The job was put back to funded (escrow), so the poster can try again." : safeToPutBack ? "Putting the job back to funded FAILED (see the claim put-back alert); it reads 'cancelling'." : chargeChanged ? `Stripe says the charge changed (${refusalCode}): check it in Stripe; the job stays 'cancelling' for a person.` : "The job stays 'cancelling' because its charge already shows an earlier refund; reconcile by hand."}`,
                fields: {
                  job_id: jobId,
                  payment_intent: cancelPaymentIntentId,
                  refund_cents: refundAmount,
                  stripe_status: (refundErr as { statusCode?: number }).statusCode ?? null,
                  stripe_message: caughtMessage(refundErr),
                  stripe_code: refusalCode || null,
                  claim_put_back: putBack ? "yes" : "no",
                },
                oncePerDayKey: `cancel-escrow-refund-refused:${jobId}`,
              });
              return new Response(JSON.stringify({
                error: putBack
                  ? "The payment processor refused this refund right now. No money was moved and your job is still paid for; try again later or contact support."
                  : "The payment processor refused this refund. No money was moved by this request; support has the details and will finish the cancellation.",
                refundRefused: true,
              }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 });
            }
            await recordRefund(supabaseAdmin, {
              refund,
              jobId,
              customerId: job.customer_id,
              paymentIntentId: cancelPaymentIntentId,
              source: "cancel_escrow",
              isPartial: nonRefundableCents > 0,
              // What was REALLY kept, in dollars (it said "minus non-refundable
              // service fee" when only Stripe's card fee was kept; see
              // _shared/refundReason.ts). A poster-fee job keeps the card
              // processing cost, never a service fee (Q2082 slice 4 #7).
              reason: (() => {
                const setupKept = Math.min(setupFeeCents, nonRefundableCents);
                const feeKept = Math.max(0, nonRefundableCents - setupKept);
                // A flat-model job's customer_fee_amount is its card cost, not a
                // service fee (cardCostFeeCents; lh-money-escrow review 2026-10-25 #2).
                const serviceKept = isPosterFeeJob(job) || cardCostFeeCents(job) > 0 ? 0 : Math.min(serviceFeeCents, feeKept);
                return refundReasonWithKeptParts("escrow cancellation refund", {
                  serviceFeeCents: serviceKept,
                  processingFeeCents: feeKept - serviceKept,
                  taxCents: cancelSplit.taxKeptCents,
                  setupFeeCents: setupKept,
                });
              })(),
              initiatedByUserId: user.id,
            });
            // Q1714: the poster is told at once, with what was kept and why
            // in the amounts computed here.
            if (refund?.id) {
              const refundedCents = Math.round(Number(refund.amount ?? refundAmount));
              // An earlier refund on this charge (Q1675) went back too: not kept.
              const keptCents = Math.max(0, capturedCents - alreadyRefundedCents - refundedCents);
              await announceRefund(supabaseAdmin, "cancel_escrow", {
                key: `refund:${refund.id}`,
                kind: "refund",
                paymentIntentId: cancelPaymentIntentId,
                amountCents: refundedCents,
                keptCents,
                // Q1674: what a first job keeps besides the fees is its one-time
                // $2 setup fee; the notice names it after the fee reason.
                taxKeptCents: cancelSplit.taxKeptCents,
                // Owner 2026-10-25: the notice names no card or service fee;
                // only the one-time setup fee (refundNotice keptSentence).
                keptReason: keptCents > 0 ? setupFeeKeptReason(null, setupFeeCents) : null,
                keptUnnamed: true,
                recipientId: job.customer_id ?? null,
                jobId,
                method: paymentMethodFromCharge(typeof pi.latest_charge === "object" ? pi.latest_charge : null),
              });
            }
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

      // ── Give the gift card back (SC-005) ──
      // A job funded by a gift card has no charge for the refund above to
      // reverse — or only the shortfall — because the gift IS the money
      // (redeem_gift_card consumed it against this job). This door flipped the
      // job to cancelled and stopped, so the recipient's gift stayed 'redeemed'
      // on a dead job and was simply gone; every other cancel/refund exit
      // (void-cancelled-payments, release-payout, execute-dispute-split,
      // process-scheduled-payouts) calls restore_gift_card_for_job. Found by
      // e2e/prod-gift-card.spec.ts; the class is pinned by
      // src/test/cancelPathsRestoreGift.test.ts.
      //
      // After the refund, before the flip, and FAIL CLOSED: if the gift cannot
      // be given back the job stays 'cancelling', which the claim above
      // re-admits, so a retry re-runs this (the refund is skipped once the
      // charge shows it, and the restore dedupes on restored_from_job_id).
      // Flipping anyway would make the loss permanent. Nothing retries
      // 'cancelling' (docs/OPEN.md Q456): the alert asks for a hand, and
      // money-reconciliation re-reports the job as cancelling_stranded on every
      // run until someone finishes it. The caller is the
      // recipient themself (poster == gift recipient), so the answer below is
      // their notice; no separate notification is sent.
      const giftBack = await restoreGiftForCancelledJob(supabaseAdmin, jobId);
      if (!giftBack.ok) {
        console.error(`CRITICAL: [create-payment] cancel_escrow could not restore the gift card on job ${jobId}: ${giftBack.reason}`);
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "Cancelled gift-funded job could not have its gift returned",
          message:
            `cancel_escrow on job ${jobId} could not give the recipient's gift card back, so the job was left 'cancelling' ` +
            "instead of cancelled. Any shortfall refund above has been issued. MANUAL ACTION: nothing retries this " +
            "automatically unless cancel_escrow is called again for it; money-reconciliation re-reports it as cancelling_stranded " +
            "every run until it is finished. While 'cancelling' the job cannot be hired or applied to " +
            "(hire and apply both require a funded payment_status, and 'cancelling' is not funded); re-run cancel_escrow for it (a repeat call does not refund " +
            "twice and the restore is idempotent) or restore the gift by hand and finish the cancel.",
          fields: { job_id: jobId, reason: giftBack.reason.slice(0, 200) },
          seed: job.is_seed === true,
        });
        return new Response(JSON.stringify({
          error: "We couldn't return your gift card yet, so this job wasn't cancelled. Please try again in a moment.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
      }

      // The job's pending applications are closed in the same UPDATE by
      // trg_close_pending_applications_on_job_cancel (Q274, 20260923205811).
      //
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
        payment_status: captureRefunded ? "refunded" : "cancelled",
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
        if (nowJob?.status === "cancelled" && nowJob?.payment_status === (captureRefunded ? "refunded" : "cancelled")) {
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
            payment_status: captureRefunded ? "refunded" : "cancelled",
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
          message: `cancel_escrow finished the refund step for job ${jobId} but the jobs update did not land. Any gift card on the job has already been handled before this flip (restored, or none existed), so do not restore it again. The job may still look payable — reconcile by hand.`,
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
            // `?view=` is the ONLY query param /admin routes on (src/pages/admin/Admin.tsx
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
      // Roadmap F3: a flat-model job keeps its stamp; no tier read.
      const disputeFeePercent = flatFeePercentOf(job) ?? await getHelperFeePercent(
        supabaseAdmin,
        job.helper_id,
        job.helper_fee_percent ?? DEFAULT_TIER_FEE_PERCENT,
      );
      const dpHelpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
      // feeAmt is the WHOLE job's commission (divided by the roster below). A
      // flat-model job's 70c is per Helpr, so it is priced on the per-Helpr
      // share and multiplied back up; a legacy job keeps its old formula.
      const feeAmt = flatFeePercentOf(job) !== null
        ? Math.round(jobHelprCommissionDollars(job, Number(job.budget) / dpHelpersCount, disputeFeePercent, netUrgentFeeDollars(job.urgent_fee) / dpHelpersCount) * dpHelpersCount * 100) / 100
        : Math.round(Number(job.budget) * disputeFeePercent) / 100 || (job.platform_fee_amount || 0);
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
            isGiveawayFixedPayJob(job),
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
      // .in("payment_status", ...) (Q1192): charge.dispute.created sets
      // 'chargeback' while the transfer is in flight; a flip matched on status
      // alone wrote 'released' over that block.
      }).eq("id", jobId).eq("status", "disputed").in("payment_status", [...DISPUTE_RELEASE_FLIP_PAYMENT_STATES]).select("id");
      if (!releaseUpdateErr && releaseUpdated && releaseUpdated.length === 0) {
        const settled = await alreadyResolvedDispute(supabaseAdmin, jobId, "completed", "released");
        if (settled) return settled;
        const raced = await chargebackLandedDuringSettlement(supabaseAdmin, jobId, "transfer", !!(job.helper_id && helperPayout > 0), {
          stripe,
          paymentIntentId: captureResult.paymentIntentId ?? null,
          title: job.title ?? null,
        });
        if (raced) return raced;
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
          computed_helper_payout_cents: roundPayoutDownCents(Math.round(helperPayout * 100)),
          platform_fee_cents: Math.round((feeAmt / dpHelpersCount) * 100),
          helper_fee_percent: disputeFeePercent,
          payment_intent_id: captureResult.paymentIntentId,
          stripe_transfer_id: settledTransfer.transferId,
          dispute_resolved_at: disputeResolvedAt,
        },
      });

      // Notify both parties
      if (job.helper_id) {
        // The ledger's amount (lookupSettledTransfer, never the request body): a
        // Helpr-fault debt can take exact cents off it (Q2165), which the payout
        // floor formatter would hide. No ledger row read: no figure (a
        // recomputed one would be before the debt).
        const ledgerTransferredCents = settledTransfer.amountCents;
        await insertNotifications(supabaseAdmin, {
          user_id: job.helper_id,
          job_id: job.id,
          title: "Dispute resolved — payment released!",
          message: `The dispute on "${job.title}" has been resolved in your favor. ${ledgerTransferredCents != null ? `$${formatExactDollars(ledgerTransferredCents / 100)} has been transferred` : "Your payment has been transferred"}.`,
          type: "payment", link: "/profile?tab=earnings",
        });
      }
      await insertNotifications(supabaseAdmin, {
        user_id: job.customer_id,
        title: "Dispute resolved",
        message: `The dispute on "${job.title}" has been resolved. Payment was released to the helpr.`,
        type: "info", link: `/posts?job=${job.id}`,
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
      // Q2082 (b), owner 2026-10-18 ("J4", "in the dispute tools"): a poster's
      // no-show / backout report filed as a dispute is ruled here too. Same
      // money as the general path: the card fee comes back (the Helpr is billed
      // it after the flip), a first job's $2 setup fee is KEPT, and a Helpr
      // whose account is gone means the ordinary fee-keeping refund (owner
      // 2026-10-18 ~22:30Z: we never absorb a fee).
      const disputeHelprFault = parseHelprFault(body.helprFault);
      if (body.helprFault != null && !disputeHelprFault) {
        throw new PublicError("Helpr at fault needs the Helpr, what happened (no-show or backout) and a note.");
      }

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

      // Helpr Guarantee (owner 2026-10-27): a dispute born of a "Not done right"
      // request refunds the job price only, fees kept. Quick Refund returns the
      // whole charge, so it is refused here; the admin records a decision and
      // execute-dispute-split applies the price-only rule. Fails closed.
      {
        const { data: openDispute, error: odErr } = await supabaseAdmin
          .from("disputes").select("id").eq("job_id", jobId).eq("status", "open").maybeSingle();
        if (odErr) throw new PublicError("Could not read this job's dispute. Nothing was moved; try again.");
        if (openDispute) {
          const { data: g, error: gErr } = await supabaseAdmin.rpc("guarantee_claim_for_dispute", { p_dispute_id: openDispute.id });
          if (gErr && gErr.code !== "PGRST202") throw new PublicError("Could not read whether this is a Helpr Guarantee dispute. Nothing was moved; try again.");
          if (!gErr && g) {
            throw new PublicError("This dispute came from a Helpr Guarantee request. Record a decision instead: its refund is the job price only, fees kept.");
          }
        }
      }

      // Q1490: the same rule as a general full refund: a fee owed to a crew
      // member the poster blocked stays on the charge. Refused, nothing moved.
      {
        const blocked = await crewBlockFeeRefusal(supabaseAdmin, job, "dispute");
        if (blocked) {
          return new Response(JSON.stringify({ error: blocked.error, crewBlockFeeCents: blocked.cents }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: blocked.status,
          });
        }
      }

      // Q2082 (b): the ruling first (shared with the general path); a refusal moves nothing.
      // lh-money-escrow review of c4ec33afb #1: the same refusal as the general path.
      if (!disputeHelprFault) {
        const plainRefused = await refuseRefundWithoutFaultRuling(supabaseAdmin, jobId);
        if (plainRefused) return plainRefused;
      }
      let disputeHelprFaultGone = false;
      if (disputeHelprFault) {
        const ruled = await ruleHelprFaultFirst(authHeader, supabaseAdmin, jobId, disputeHelprFault);
        if ("refusal" in ruled) return ruled.refusal;
        disputeHelprFaultGone = ruled.gone;
      }
      // Live = the card fee goes back and the Helpr is billed it.
      const disputeHelprFaultLive = disputeHelprFault != null && !disputeHelprFaultGone;
      let disputeHelprFaultCardFeeCents: number | null = null;

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
      // Q1714: what the capture kept (Stripe's processing fee), for the notice.
      let disputeKeptCents = 0;
      // Q2082 (a): the sales tax kept with the kept card fee, for the notice.
      let disputeTaxKeptCents = 0;
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

            // Q1674: the first job's $2 setup fee is kept here too.
            // THE refund amount (owner, 2026-10-14: never absorb a fee), from
            // _shared/refundAmount.ts. The poster WON, so only the CARD cost is
            // kept, never a legacy service fee: cardCostFeeCents counts
            // customer_fee_amount only on a job priced with no service fee
            // (platform_fee_percent = 0), where that fee IS the card cost; on a
            // legacy 12% job Stripe's real fee is what is kept. execute-dispute-
            // split computes its poster leg the same way, so a 0/100 split and
            // this Quick Refund return the same cents.
            // Q1675: refunds ANOTHER flow already made on this charge (the
            // duplicate $2 setup fee settleOnboardingFee refunds, a Dashboard
            // refund) went back already, and pi.amount_received does not go
            // down after them, so they come off what this refund may return.
            // This action's own earlier refund (metadata.source
            // admin_refund_dispute) is NOT subtracted: a retry finds and reuses
            // it below (Q1209). Listed only when the charge shows a refund.
            const disputeChargeRefundedCents = Number(
              (pi.latest_charge && typeof pi.latest_charge === "object"
                ? (pi.latest_charge as { amount_refunded?: number }).amount_refunded
                : 0) ?? 0,
            );
            const disputePriorRefunds = disputeChargeRefundedCents > 0
              ? (await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 })).data ?? []
              : [];
            const disputeOtherRefundedCents = disputePriorRefunds
              .filter((r) => (r.status === "succeeded" || r.status === "pending") && r.metadata?.source !== "admin_refund_dispute")
              .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
            const disputeTaxCents = await chargeTaxCentsFor(stripe, pi);
            const disputeSplit = refundToPayerCents({
              capturedCents,
              actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents),
              customerFeeCents: cardCostFeeCents(job),
              setupFeeCents: setupFeeKeptCents(job),
              alreadyRefundedCents: disputeOtherRefundedCents,
              taxCents: disputeTaxCents,
            });
            // Q2082 (b): a live Helpr fault returns the card fee too (zero card
            // fee) but still keeps a first job's $2 setup fee and its tax.
            const helprFaultDisputeSplit = refundToPayerCents({
              capturedCents,
              actualFeeCents: 0,
              customerFeeCents: 0,
              setupFeeCents: setupFeeKeptCents(job), // the $2 stays on a disputed Helpr fault too
              alreadyRefundedCents: disputeOtherRefundedCents,
              taxCents: disputeTaxCents,
            });
            const disputeEffectiveSplit = disputeHelprFaultLive ? helprFaultDisputeSplit : disputeSplit;
            if (disputeHelprFaultLive) disputeHelprFaultCardFeeCents = actualOrEstimatedFeeCents(pi, capturedCents);
            const nonRefundableCents = disputeEffectiveSplit.nonRefundableCents;
            const refundAmount = disputeSplit.refundCents;
            const helprFaultDisputeRefundCents = helprFaultDisputeSplit.refundCents;
            const disputeSendCents = disputeHelprFaultLive ? helprFaultDisputeRefundCents : refundAmount;
            // Other flows already returned MORE than this refund may: the card
            // fee it keeps was given away earlier. The $0 branch below would
            // blame the processing fee; say what happened instead
            // (lh-money-escrow review of Q1675 #2).
            if (disputeOtherRefundedCents > disputeEffectiveSplit.ceilingCents + 1) {
              await postSlackOpsAlert({
                kind: "money_at_risk",
                severity: "warning",
                title: "Disputed job's charge was already refunded past what the refund keeps",
                message: "Earlier refunds by another flow returned more than a dispute refund may (they ate into the card fee it keeps). Nothing more is refunded; reconcile by hand.",
                fields: { job_id: jobId, payment_intent: paymentIntentId, refunded_cents: disputeOtherRefundedCents, refundable_cents: disputeEffectiveSplit.ceilingCents },
                oncePerDayKey: `dispute-refunded-past-kept:${jobId}`,
              });
            }
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

            if (disputeSendCents > 0) {
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
                // Q1209: a retry whose refund already went out reuses it.
                const disputeAlreadyRefundedCents = Number(
                  (pi.latest_charge && typeof pi.latest_charge === "object"
                    ? (pi.latest_charge as { amount_refunded?: number }).amount_refunded
                    : 0) ?? 0,
                );
                const reusedDispute = await existingRefundCovering(stripe, paymentIntentId, disputeAlreadyRefundedCents, disputeSendCents, "admin_refund_dispute");
                if (reusedDispute) {
                  console.log(`[create-payment] admin_refund_dispute: charge for job ${jobId} already refunded ${disputeAlreadyRefundedCents}¢ — reusing ${reusedDispute.id}, not refunding again`);
                }
                refund = reusedDispute ?? (disputeHelprFaultLive ? await stripe.refunds.create(
                  {
                    payment_intent: paymentIntentId,
                    // Q2082 (b): the card fee back too, the $2 setup fee kept;
                    // the Helpr is billed the card fee after the flip.
                    amount: helprFaultDisputeRefundCents,
                    metadata: { source: "admin_refund_dispute", job_id: jobId, helpr_fault: "true" },
                  },
                  { idempotencyKey: `helpr-fault-dispute-refund-${jobId}` },
                ) : await stripe.refunds.create(
                  { payment_intent: paymentIntentId, amount: refundAmount, metadata: { source: "admin_refund_dispute", job_id: jobId } },
                  { idempotencyKey: `refund-dispute-${jobId}` },
                ));
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
              disputeRefundCents = Math.round(Number(refund.amount ?? disputeSendCents));
              // Another flow's earlier refund (Q1675) went back too: not kept.
              disputeKeptCents = Math.max(0, capturedCents - disputeOtherRefundedCents - disputeRefundCents);
              disputeTaxKeptCents = disputeEffectiveSplit.taxKeptCents;
              await recordRefund(supabaseAdmin, {
                refund,
                jobId,
                customerId: job.customer_id,
                paymentIntentId,
                source: "admin_refund_dispute",
                isPartial: nonRefundableCents > 0,
                reason: disputeHelprFaultLive
                  ? (setupFeeKeptCents(job) > 0
                    ? "dispute refund, Helpr at fault (card fee returned and billed to the Helpr; the $2 setup fee kept)"
                    : "dispute refund, Helpr at fault (card fee returned and billed to the Helpr)")
                  : setupFeeKeptCents(job) > 0
                    ? "dispute refund (minus non-refundable Stripe processing fee and the kept $2 setup fee)"
                    : "dispute refund (minus non-refundable Stripe processing fee)",
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
                  refund_amount: disputeSendCents,
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

      // Q2082 (b): the Helpr at fault is billed the card fee the refund
      // returned (0 when they are gone and the refund kept it). Once per call;
      // bill_helpr_fault_card_fee itself bills once per ruling. Q2170
      // (lh-money-escrow #2): EVERY exit after a fault refund went out bills,
      // not only the success path (a concurrent copy closed it first, a
      // chargeback raced the flip, the flip failed).
      // A cast, not an annotation: assigned inside the closure, so TS must not narrow it to null.
      let disputeHelprFaultBill = null as { billedCents: number | null; failed: boolean } | null;
      const billDisputeHelprFault = async () => {
        if (!disputeHelprFault || disputeHelprFaultBill) return;
        disputeHelprFaultBill = await billHelprFaultCardFee(supabaseAdmin, jobId, disputeHelprFault.helperId, disputeHelprFaultCardFeeCents, disputeRefundId ?? paymentIntentId ?? `job-${jobId}`);
      };

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
      // .in("payment_status", ...): same chargeback race as admin_release_dispute (Q1192).
      }).eq("id", jobId).eq("status", "disputed").in("payment_status", [...DISPUTE_REFUND_FLIP_PAYMENT_STATES]).select("id");
      if (!refundUpdateErr && refundUpdated && refundUpdated.length === 0) {
        const settled = await alreadyResolvedDispute(supabaseAdmin, jobId, "cancelled", "refunded");
        if (settled) {
          // A concurrent copy of this Quick Refund closed it first, and that
          // copy returns the gift. Asked again here (idempotent) so one copy's
          // failed restore is finished by the other.
          await returnGiftAfterRefund(supabaseAdmin, job, "Quick Refund");
          // Q1208: this copy's own settlement claim is handed back too, as the
          // success path below does; returning without it left it held.
          await releaseDisputeSettlementClaim(supabaseAdmin, jobId, refundClaimHeld);
          if (disputeRefundId) await billDisputeHelprFault();
          return settled;
        }
        const raced = await chargebackLandedDuringSettlement(supabaseAdmin, jobId, "refund", disputeRefundCents > 0);
        if (raced) {
          if (disputeRefundId) await billDisputeHelprFault();
          return raced;
        }
      }
      if (refundUpdateErr || !refundUpdated || refundUpdated.length === 0) {
        console.error(`CRITICAL: refund issued for disputed job ${jobId} but jobs.update to refunded failed — manual reconciliation needed:`, refundUpdateErr ?? "matched 0 rows");
        if (disputeRefundId) await billDisputeHelprFault();
        return new Response(JSON.stringify({
          error: "refund issued but job status update failed — manual reconciliation needed",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
      }

      // ── Give the gift card back (Q454) ──
      // On a PARTLY gift-funded job the PaymentIntent refunded above is only
      // the shortfall, so the refund returned the card part and the gift part
      // was dropped: the recipient simply lost it. The poster won the whole
      // dispute, so the whole gift comes back: restore_gift_card_for_job's
      // default share (10000 bps), exactly what execute-dispute-split restores
      // at a 0/100 split. The gift leg carries no Stripe fee (the DONOR paid it
      // when the gift was bought), so nothing is withheld from it.
      // AFTER the flip, while the settlement claim is still held (lh-money-
      // escrow review of the first draft, HIGH): the job is closed as
      // cancelled/refunded first, so no path can still pay the Helpr out of
      // this escrow once the gift is back (a claim handed back over a
      // still-disputed job let a withdrawn dispute walk it to a payout). A
      // restore that fails pages critical and is finished by hand, which can
      // no longer double-pay.
      const disputeGift = await returnGiftAfterRefund(supabaseAdmin, job, "Quick Refund");

      // Q2082 (b): after the flip, the Helpr at fault is billed (above).
      await billDisputeHelprFault();

      // Same two closing writes as the release path: the formal dispute record,
      // and the audit trail. What the poster got back counts the gift, as the
      // split's record does.
      await closeDisputeRecordForJob(supabaseAdmin, {
        jobId,
        outcome: "poster",
        decidedBy: user.id,
        decisionText: disputeHelprFault && !disputeHelprFaultGone
          ? "Resolved by an admin Quick Refund: the Helpr was at fault, so all of the payment for the job went back to the person who posted it."
          : "Resolved by an admin Quick Refund: most of the payment went back to the person who posted this job.",
        refundCents: disputeRefundCents + disputeGift.spendableCents,
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
          gift_restored_cents: disputeGift.restoredCents,
          gift_restore_failed: disputeGift.failed,
          payment_intent_id: paymentIntentId,
          stripe_refund_id: disputeRefundId,
          dispute_resolved_at: refundResolvedAt,
          helpr_fault: disputeHelprFault ? { helper_id: disputeHelprFault.helperId, kind: disputeHelprFault.kind, card_fee_billed_cents: disputeHelprFaultBill?.billedCents ?? null, bill_failed: disputeHelprFaultBill?.failed ?? false, helpr_gone: disputeHelprFaultGone } : null,
        },
      });

      // Notify both parties. Q1714: the poster's is THE refund notice (in the
      // app and by email); the webhook leaves an admin_refund_dispute refund
      // to this path. A $0 card refund (all gift) keeps the plain notice.
      if (disputeRefundId && disputeRefundCents > 0) {
        const disputeSetupKeptCents = setupFeeKeptCents(job);
        await announceRefund(supabaseAdmin, "admin_refund_dispute", {
          key: `refund:${disputeRefundId}`,
          kind: "refund",
          paymentIntentId: paymentIntentId ?? null,
          amountCents: disputeRefundCents,
          keptCents: disputeKeptCents,
          taxKeptCents: disputeTaxKeptCents,
          // Q1674: a first job also keeps its one-time $2 setup fee; the notice says so.
          keptReason: disputeKeptCents > 0
            ? setupFeeKeptReason(null, disputeSetupKeptCents)
            : null,
          keptUnnamed: true,
          recipientId: job.customer_id ?? null,
          jobId: job.id,
          extra: `The dispute on "${job.title}" was resolved in your favor.${disputeHelprFault ? (disputeHelprFaultGone ? " The Helpr was at fault." : " The Helpr was at fault, so all of your payment for the job comes back to you.") : ""}${disputeGift.posterSentence}`,
        });
      } else {
        await insertNotifications(supabaseAdmin, {
          user_id: job.customer_id,
          title: "Dispute resolved",
          message: `The dispute on "${job.title}" has been resolved in your favor.${disputeGift.posterSentence}`,
          type: "payment", link: `/posts?job=${job.id}`,
        });
      }
      if (job.helper_id) {
        await insertNotifications(supabaseAdmin, {
          user_id: job.helper_id,
          title: "Dispute resolved",
          message: `The dispute on "${job.title}" has been resolved. The person who posted it has been refunded.`,
          type: "info", link: `/jobs?job=${job.id}`,
        });
      }

      // Settled — same tidy-up as the release path.
      await releaseDisputeSettlementClaim(supabaseAdmin, jobId, refundClaimHeld);

      // The job IS settled; a gift that could not be returned is said in the
      // answer as well as the page, so the admin screen can show it.
      return new Response(JSON.stringify({
        success: true,
        ...(disputeGift.failed ? { giftRestoreFailed: true } : {}),
        ...(disputeHelprFault ? { helprFault: { cardFeeBilledCents: disputeHelprFaultBill?.billedCents ?? null, billFailed: disputeHelprFaultBill?.failed ?? false, helprGone: disputeHelprFaultGone } } : {}),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // ─── ADMIN: bill the Helpr at fault again (Q2170, lh-money-escrow #2) ───
    // A Helpr-at-fault refund closes the job (general: payment_status
    // refunded; dispute: the dispute is resolved), so neither refund button is
    // shown again and pressing "Helpr at fault" a second time is no recovery
    // when bill_helpr_fault_card_fee failed after the refund went out. This
    // action moves NO money: it finds the fault refund already on the charge
    // (metadata helpr_fault, by either refund action), prices the card fee
    // from the charge exactly as the refund did (actualOrEstimatedFeeCents),
    // and bills it. bill_helpr_fault_card_fee bills once per ruling (FOR
    // UPDATE, card_fee_cents set once), so a double press bills once.
    if (action === "admin_bill_helpr_fault") {
      const { jobId } = body;
      if (!jobId) throw new PublicError("Missing jobId");
      const { data: isAdmin, error: adminRoleErr } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (adminRoleErr) console.error("[create-payment] admin_bill_helpr_fault has_role check failed:", adminRoleErr.message);
      if (!isAdmin) throw new PublicError("Not authorized — admin only");
      const reply = (payload: Record<string, unknown>, status: number) => new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
      });

      const { data: ruling, error: rulingErr } = await supabaseAdmin
        .from("job_helpr_fault_rulings").select("helper_id, card_fee_cents").eq("job_id", jobId).maybeSingle();
      if (rulingErr) {
        console.error(`[create-payment] admin_bill_helpr_fault: reading job ${jobId}'s ruling failed:`, rulingErr.message);
        return reply({ error: "Couldn't read this job's Helpr-at-fault ruling. Nothing was billed: try again." }, 503);
      }
      if (!ruling) return reply({ error: "This job has no Helpr-at-fault ruling, so there is nothing to bill.", code: "no_helpr_fault_ruling" }, 409);
      const helprGone = ruling.helper_id == null;
      if (ruling.card_fee_cents != null) {
        return reply({ success: true, alreadyBilled: true, helprFault: { cardFeeBilledCents: ruling.card_fee_cents, billFailed: false, helprGone } }, 200);
      }

      const { data: billJob, error: billJobErr } = await supabaseAdmin
        .from("jobs").select("id, stripe_payment_intent_id, stripe_session_id").eq("id", jobId).maybeSingle();
      if (billJobErr || !billJob) return reply({ error: "Couldn't read the job. Nothing was billed: try again." }, 503);
      let faultRefund: Stripe.Refund | undefined;
      let cardFeeCents = 0;
      try {
        let piId: string | null | undefined = billJob.stripe_payment_intent_id;
        if (!piId && billJob.stripe_session_id) {
          const session = await stripe.checkout.sessions.retrieve(billJob.stripe_session_id, { expand: ["payment_intent"] });
          piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        }
        if (!piId) return reply({ error: "This job has no payment on Stripe, so there is nothing to bill.", code: "no_payment" }, 409);
        const listed = (await stripe.refunds.list({ payment_intent: piId, limit: 100 })).data ?? [];
        faultRefund = listed.find((r) =>
          (r.status === "succeeded" || r.status === "pending") &&
          (r.metadata?.source === "admin_refund_general" || r.metadata?.source === "admin_refund_dispute") &&
          (r.metadata?.helpr_fault === "true" || r.metadata?.helpr_fault === "helpr_gone"));
        // lh-money-escrow re-review of b4102e4ec (nit): a dispute refund for a Helpr
        // whose account was already gone is the ORDINARY refund (it kept the card fee)
        // and carries no helpr_fault metadata, so a gone Helpr is settled at 0 here.
        if (!faultRefund && helprGone) {
          const zero = await billHelprFaultCardFee(supabaseAdmin, jobId, "deleted", 0, `job-${jobId}`);
          if (zero.failed) return reply({ error: "Billing the Helpr failed again. Nothing was moved; try again.", helprFault: { cardFeeBilledCents: null, billFailed: true, helprGone } }, 503);
          return reply({ success: true, helprFault: { cardFeeBilledCents: zero.billedCents, billFailed: false, helprGone } }, 200);
        }
        if (!faultRefund) {
          return reply({
            error: "No Helpr-at-fault refund has gone out on this job's charge, so the Helpr is not billed. Refund it with \"Helpr at fault\" first.",
            code: "no_helpr_fault_refund",
          }, 409);
        }
        // "helpr_gone": that refund KEPT the card fee (owner 2026-10-18), so 0 is billed.
        if (faultRefund.metadata?.helpr_fault === "true") {
          const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge.balance_transaction"] });
          const capturedCents = pi.amount_received ?? pi.amount;
          cardFeeCents = actualOrEstimatedFeeCents(pi, capturedCents);
        }
      } catch (stripeErr) {
        // Q891: a pre-live job's stored session / PaymentIntent is a TEST-mode id the
        // live key cannot read. That is not "try again": the outer catch answers its
        // 409 (test-mode payment, no money moved). Nothing was billed either way.
        if (isTestObjectUnderLiveKey(stripeErr)) throw stripeErr;
        console.error(`[create-payment] admin_bill_helpr_fault: Stripe read failed for job ${jobId}:`, stripeErr);
        return reply({ error: "Couldn't read the charge from Stripe. Nothing was billed: try again." }, 503);
      }
      const bill = await billHelprFaultCardFee(supabaseAdmin, jobId, ruling.helper_id ?? "deleted", cardFeeCents, faultRefund.id);
      await logAdminMoneyAction(supabaseAdmin, {
        adminId: user.id,
        action: "helpr_fault_bill_retry",
        jobId,
        details: { helper_id: ruling.helper_id, stripe_refund_id: faultRefund.id, card_fee_cents: cardFeeCents, card_fee_billed_cents: bill.billedCents, bill_failed: bill.failed },
      });
      const helprFaultOutcome = { cardFeeBilledCents: bill.billedCents, billFailed: bill.failed, helprGone };
      if (bill.failed) return reply({ error: "Billing the Helpr failed again. Nothing was moved; try again.", helprFault: helprFaultOutcome }, 503);
      return reply({ success: true, helprFault: helprFaultOutcome }, 200);
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
      // Q2082 (b), owner 2026-10-18 ("J4"): HELPR FAULT. After the poster
      // reports a no-show or a backout, an admin rules the Helpr at fault: the
      // poster gets EVERYTHING back (card fee and its tax included), the Helpr
      // is billed the card fee Stripe kept (bill_helpr_fault_card_fee, taken
      // from their next payout) and carries a strike (admin_rule_helpr_fault).
      // Full refunds only: a partial cannot be "everything back".
      const helprFault = parseHelprFault(body.helprFault);
      if (body.helprFault != null && !helprFault) {
        throw new PublicError("Helpr at fault needs the Helpr, what happened (no-show or backout) and a note.");
      }
      if (helprFault && typeof amountCents === "number") {
        throw new PublicError("A Helpr-at-fault refund is always a full refund: leave the amount empty.");
      }

      const { data: isAdmin, error: adminRoleErr } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (adminRoleErr) console.error("[create-payment] admin_refund_general has_role check failed:", adminRoleErr.message);
      if (!isAdmin) throw new PublicError("Not authorized — admin only");

      const { data: job, error: jobError } = await supabaseAdmin
        .from("jobs").select("*").eq("id", jobId).single();
      if (jobError || !job) throw new PublicError("Job not found");

      // ── A card only HELD is not a refund (Q2399) ──────────────────────────
      // Nothing was charged: a refund of an uncaptured PaymentIntent is
      // refused by Stripe, and the 'cancelling' claim below would strand the
      // job. Cancelling the job releases the hold (card-hold-sweep), at no fee.
      if (job.payment_status === "held") {
        return new Response(JSON.stringify({
          error: "This job's card is only on hold, so nothing was charged and there is nothing to refund. Cancel the job to release the hold. No money was moved.",
          cardHold: true,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
      }

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
        // Q1323: say WHOSE claim it is. A stranded admin refund claim used to
        // answer "the cancellation is refunding it right now" forever.
        const holder = await readRefundClaim(supabaseAdmin, jobId);
        const stale = holder.claimedAt != null && Date.now() - Date.parse(holder.claimedAt) > 10 * 60 * 1000;
        return new Response(
          JSON.stringify({
            error: holder.claimedBy === "admin_refund_general"
              ? (stale
                ? `An earlier admin refund of this job did not finish (started ${holder.claimedAt}). Its Stripe refund may or may not exist: check the charge in Stripe before anything else. No money was moved now.`
                : "An admin refund of this job is running right now. No money was moved — refresh in a minute.")
              : "This job's cancellation is refunding it right now. No money was moved — refresh in a minute.",
            refundClaimedBy: holder.claimedBy,
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
      // Q1490: a crew member this poster blocked is owed a fee out of this
      // escrow. A full refund would hand the poster that money too, and
      // void-cancelled-payments Part F would then pay the member from the
      // platform's balance. Refused, nothing moved (fails closed on a failed
      // read). A partial refund stays the platform's choice, as above.
      if (wantsFullRefund) {
        const blocked = await crewBlockFeeRefusal(supabaseAdmin, job);
        if (blocked) {
          return new Response(JSON.stringify({ error: blocked.error, crewBlockFeeCents: blocked.cents }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: blocked.status,
          });
        }
      }
      // Q2082 (b): the ruling comes first, as the admin (auth.uid() in the
      // RPC is who ruled; it checks the admin role, the Helpr was booked here,
      // and gives the Helpr exactly one strike for this job). It is
      // idempotent ('already_ruled'), so a refund that stops below is retried
      // by pressing the button again. No ruling, no fault refund.
      // lh-money-escrow review of c4ec33afb #1: once a job HAS a Helpr-at-fault
      // ruling, a refund without it would reuse the fault refund (card fee
      // back) and never bill the Helpr: refused, nothing moved.
      if (!helprFault) {
        const plainRefused = await refuseRefundWithoutFaultRuling(supabaseAdmin, jobId);
        if (plainRefused) return plainRefused;
      }
      let helprFaultGone = false;
      if (helprFault) {
        const ruled = await ruleHelprFaultFirst(authHeader, supabaseAdmin, jobId, helprFault);
        if ("refusal" in ruled) return ruled.refusal;
        helprFaultGone = ruled.gone;
      }

      // ── Q1290: take the JOB before reading the payout ledger ──────────────
      // The ledger read below and the payout claim (payoutClaim.claimPayout:
      // insert a 'pending' payout_transfers row, THEN re-read the job expecting
      // 'payout_pending') used to interleave: this read before the claim row
      // existed, the payout's re-read before this call's flip, and both moved
      // money (the card refunded AND the Helpr paid). The job is now claimed
      // first, a compare-and-set to 'cancelling' (cancel_escrow's in-flight
      // refund state) pinned to the status and payment_status just read. A
      // payout that claims after this sees a job that is no longer
      // payout_pending and sends nothing; one that claimed before it has its
      // 'pending' row read by the ledger check below, which refuses. Every
      // stop before a refund can exist puts the claim back.
      let generalClaimHeld = false;
      const putGeneralClaimBack = async (why: string) => {
        if (!generalClaimHeld) return;
        const { data: putBack, error: putBackErr } = await supabaseAdmin.from("jobs")
          .update({ payment_status: job.payment_status })
          .eq("id", jobId).eq("status", job.status).eq("payment_status", "cancelling")
          .select("id");
        if (putBackErr || !putBack || putBack.length === 0) {
          await claimPutBackMissed(supabaseAdmin, {
            jobId, path: "admin_refund_general", why, restoreTo: job.payment_status ?? null, dbError: putBackErr?.message ?? null,
          });
        } else {
          generalClaimHeld = false;
          await deleteRefundClaim(supabaseAdmin, jobId);
        }
      };
      if (wantsFullRefund) {
        let generalClaim = supabaseAdmin.from("jobs").update({ payment_status: "cancelling" })
          .eq("id", jobId).eq("status", job.status);
        generalClaim = job.payment_status == null
          ? generalClaim.is("payment_status", null)
          : generalClaim.eq("payment_status", job.payment_status);
        const { data: generalClaimed, error: generalClaimErr } = await generalClaim.select("id");
        if (generalClaimErr) {
          console.error(`[create-payment] admin_refund_general claim failed for job ${jobId}:`, generalClaimErr.message);
          return new Response(JSON.stringify({
            error: "Couldn't start this refund. No money was moved — try again.",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
        }
        if (!generalClaimed || generalClaimed.length === 0) {
          return new Response(JSON.stringify({
            error: "This job changed while the refund was being set up (a payout, cancel or dispute may have started). No money was moved — refresh and check it before trying again.",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
        }
        generalClaimHeld = true;
        // Q1323: recorded or given back; an unrecorded admin claim is one a
        // poster's cancel could not tell apart from a stranded one.
        if (!(await recordRefundClaim(supabaseAdmin, jobId, "admin_refund_general", user.id))) {
          await putGeneralClaimBack("its claim holder could not be recorded");
          return new Response(JSON.stringify({
            error: "Couldn't start this refund. No money was moved — try again.",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
        }

        const alreadyPaidOut = await escrowAlreadyMovedTheOtherWay(supabaseAdmin, jobId, "refund", "admin_refund");
        if (alreadyPaidOut) {
          await putGeneralClaimBack("the payout ledger shows money already left (or could not be read)");
          return alreadyPaidOut;
        }

        // Q1208 (2): that ledger check reads 'pending' and 'paid' only, and
        // failClaim also writes 'failed' for a network fault where the transfer
        // may exist at Stripe. A 'failed' row is therefore asked of Stripe (as
        // Quick Refund asks for every refund): a live transfer in the job's
        // transfer group refuses the full refund. Fails CLOSED.
        const { data: failedPayouts, error: failedPayoutErr } = await supabaseAdmin
          .from("payout_transfers")
          .select("id, status")
          .eq("job_id", jobId)
          .eq("status", "failed")
          .limit(1);
        if (failedPayoutErr) {
          await putGeneralClaimBack("the 'failed' payout rows could not be read");
          return new Response(JSON.stringify({
            error: "Couldn't check this job's payout history. No money was moved — try again.",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
        }
        if (((failedPayouts ?? []) as Array<{ status?: string }>).some((r) => r.status === "failed")) {
          let liveTransferId: string | null = null;
          try {
            const prior = await stripe.transfers.list({ transfer_group: `job_${jobId}`, limit: 100 });
            liveTransferId = ((prior?.data ?? []) as Array<{ id: string; amount?: number; amount_reversed?: number }>)
              .find((t) => Number(t.amount ?? 0) - Number(t.amount_reversed ?? 0) > 0)?.id ?? null;
          } catch (listErr) {
            console.error(`[create-payment] admin_refund_general: transfers.list failed for job ${jobId}:`, listErr);
            await putGeneralClaimBack("Stripe's transfer list could not be read");
            return new Response(JSON.stringify({
              error: "Couldn't confirm with Stripe that no payout left for this job. No money was moved — try again.",
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
          }
          if (liveTransferId) {
            console.error(`[create-payment] admin_refund_general REFUSED for job ${jobId}: Stripe shows transfer ${liveTransferId} behind a 'failed' payout row`);
            await putGeneralClaimBack(`Stripe shows transfer ${liveTransferId} behind a 'failed' payout row`);
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "critical",
              title: "Admin refund refused — a transfer for this job left Stripe behind a 'failed' payout row",
              message: `Job ${jobId} has a payout_transfers row marked 'failed', but Stripe shows transfer ${liveTransferId} in its transfer group. Nothing was refunded; reconcile the payout ledger by hand.`,
              fields: { job_id: jobId, transfer_id: liveTransferId },
            });
            return new Response(JSON.stringify({
              error: "Stripe shows a payout to the Helpr already left for this job, so it can't also be refunded in full. Nothing was moved; this job needs manual reconciliation.",
              alreadyMoved: true,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
          }
        }
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

      // Q1290: set just before the Stripe refund call. Until then nothing can
      // have moved, so any stop puts the job claim back.
      let generalRefundSent = false;
      // Q1714: the refund the poster's notice is about (claimed on its id).
      let generalRefundForNotice: { id: string; amountCents: number; keptCents: number; taxKeptCents: number } | null = null;
      // Q1674: what a full refund kept (the setup fee) and sent, for the audit row.
      let generalKeptSetupCents = 0;
      // Owner 2026-10-14: what a full refund kept as the card fee, for the notice and audit row.
      let generalKeptFeeCents = 0;
      // A full refund that found nothing left to send (earlier refunds already
      // returned everything refundable, or more): the job is still cancelled.
      let generalNothingLeft = false;
      let generalRefundCents: number | null = null;
      // Q2082 (b): Stripe's real card fee on the charge, billed to the Helpr at fault.
      let helprFaultCardFeeCents: number | null = null;
      let helprFaultRefundRef: string | null = null;
      let paymentIntentId = job.stripe_payment_intent_id;
      try {
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
        // The fee Stripe kept is read from the charge's own balance
        // transaction (owner, 2026-10-14: an admin refund keeps the card fee too).
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: ["latest_charge.balance_transaction"],
        });
        if (pi.status === "succeeded") {
          // MS-6: bound a partial refund against what Stripe ACTUALLY captured
          // (budget + poster service fee + urgent fee + tax), not `job.budget`.
          // A partial can be up to the full capture; anything beyond it is an
          // over-refund and is refused. A partial that (with earlier refunds)
          // returns the WHOLE capture is refused too (Q1320, below): it would
          // leave the job payable on a fully refunded charge. Only an omitted
          // `amountCents` cancels the job.
          // capturedCents is the base of EVERY admin refund since 2026-10-14: a
          // full refund sends the charge less the kept card and setup fees, a
          // partial is capped by the same ceiling (generalSplit below). The
          // degenerate-capture checks here are partial-only; a full refund on an
          // unreadable or too-small capture is refused by its own check below
          // (captured <= the kept fees), so no amount ever reaches Stripe from it.
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
              const partialAlreadyPaidOut = await escrowAlreadyMovedTheOtherWay(supabaseAdmin, jobId, "refund", "admin_refund");
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

          // Q1209: a FULL refund retried after it already went out reuses it.
          // Measured on the refunds Stripe lists for this charge (succeeded or
          // pending), against the whole capture; a partial never reuses.
          const generalAlreadyRefundedCents = priorRefunds.data
            .filter((r) => r.status === "succeeded" || r.status === "pending")
            .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
          // THE refund amount (owner, 2026-10-14: "if admin refunds we keep the
          // fee also. we should never absorb any fee"), from
          // _shared/refundAmount.ts: the charge less the CARD fee only, less a
          // first job's kept $2 setup fee (Q1674), less what earlier refunds
          // returned. A full refund sends exactly that; a partial is capped by
          // it. The sales tax on the kept fee is kept too (owner 2026-10-18,
          // Q2082 (a): refundToPayerCents taxKeptCents).
          // Owner, 2026-10-14 pop-up: on a legacy job priced with the old 12%
          // poster service fee (platform_fee_percent > 0; prod had 3 funded:
          // 7440a72d, 11f8b084, 9c6ff2de) an admin full refund keeps ONLY the
          // card fee, like the dispute paths, never the old 12%. cardCostFeeCents
          // counts customer_fee_amount only when it IS the card cost
          // (platform_fee_percent = 0); otherwise Stripe's real fee is kept.
          const generalTaxCents = await chargeTaxCentsFor(stripe, pi);
          const generalSplit = refundToPayerCents({
            capturedCents,
            actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents),
            customerFeeCents: cardCostFeeCents(job),
            setupFeeCents: setupFeeKeptCents(job),
            alreadyRefundedCents: generalAlreadyRefundedCents,
            requestedCents: isPartial ? requestedCents : null,
            taxCents: generalTaxCents,
          });
          // Q2082 (b): a Helpr-at-fault refund returns the CARD FEE too (the
          // Helpr is billed it after the refund), less what earlier refunds
          // (the poster's own fee-keeping cancel) returned, which tops that
          // cancel up. Owner 2026-10-18 ~22:30Z: a first job's $2 setup fee
          // is still KEPT (with the sales tax on it, Q2082 (a)); and when the
          // Helpr's account is gone (nobody to bill) the card fee is kept as
          // well, so the refund is the ordinary one: we never absorb a fee.
          const helprFaultSplit = refundToPayerCents({
            capturedCents,
            actualFeeCents: 0,
            customerFeeCents: 0,
            setupFeeCents: setupFeeKeptCents(job), // the $2 stays on a Helpr fault too
            alreadyRefundedCents: generalAlreadyRefundedCents,
            requestedCents: null,
            taxCents: generalTaxCents,
          });
          const split = helprFault && !helprFaultGone ? helprFaultSplit : generalSplit;
          if (helprFault && !helprFaultGone) helprFaultCardFeeCents = actualOrEstimatedFeeCents(pi, capturedCents);
          // Q1320: a partial that, with the refunds already on this charge,
          // returns the WHOLE capture is a full refund in disguise. A partial
          // takes no job claim and flips nothing, and the single-Helpr payout
          // path reads no refund total, so the job stayed payable and a later
          // payout could pay the Helpr on top of the poster's full refund.
          // Refused (nothing moved): the full refund cancels the job and stops
          // its payout, and is the action to use.
          // Since 2026-10-14 the whole charge is never refundable (the card fee
          // is kept), so "everything refundable" is the line: a partial that
          // reaches the ceiling (or passes it) is refused the same way.
          if (isPartial && generalAlreadyRefundedCents + requestedCents! >= split.ceilingCents) {
            const keptWords = split.setupKeptCents > 0
              ? `the $${(split.feeKeptCents / 100).toFixed(2)} card processing fee and the one-time $${(split.setupKeptCents / 100).toFixed(2)} setup fee are kept`
              : `the $${(split.feeKeptCents / 100).toFixed(2)} card processing fee is kept`;
            // Q2082 (a): the sales tax on what is kept is kept too, so the figure adds up.
            const keptTaxWords = split.taxKeptCents > 0 ? `, with $${(split.taxKeptCents / 100).toFixed(2)} sales tax on it` : "";
            return new Response(JSON.stringify({
              error: `This partial refund would return everything refundable on the $${(capturedCents / 100).toFixed(2)} charge ($${(split.ceilingCents / 100).toFixed(2)}: ${keptWords}${keptTaxWords}${generalAlreadyRefundedCents > 0 ? `; $${(generalAlreadyRefundedCents / 100).toFixed(2)} was already refunded` : ""}). Use a full refund instead: it cancels the job and stops its payout (it is refused if the Helpr was already paid). No money was moved.`,
              useFullRefund: true,
              refundableCents: split.remainingCents,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
          }
          // Q1674 (owner, 2026-10-12): an admin's FULL refund keeps a first
          // job's $2 setup fee too, and since 2026-10-14 the card fee as well
          // (generalSplit above). The refund is then everything left on the
          // charge but those fees (Stripe sees a partial; this path still
          // cancels the job).
          const keptSetupCents = isPartial ? 0 : split.setupKeptCents;
          const keptFeeCents = isPartial ? 0 : split.feeKeptCents;
          if (!isPartial && (!Number.isFinite(capturedCents) || capturedCents <= split.nonRefundableCents)) {
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "critical",
              title: "General refund aborted — captured amount unreadable or not above the kept fees",
              message: `admin_refund_general could not keep the card fee${keptSetupCents > 0 ? " and the $2 setup fee" : ""} on job ${jobId}: the captured amount (${String(capturedCents)}) is unreadable or not above them (${split.nonRefundableCents}c). No refund issued.`,
              fields: { job_id: jobId, payment_intent: paymentIntentId, captured_cents: String(capturedCents), non_refundable_cents: split.nonRefundableCents },
            });
            throw new PublicError(`admin_refund_general: invalid captured amount (${capturedCents}) for job ${jobId} — aborting, no refund issued.`);
          }
          const fullTargetCents = split.ceilingCents;
          const reused = !isPartial
            ? await existingRefundCovering(stripe, paymentIntentId, generalAlreadyRefundedCents, fullTargetCents, "admin_refund_general", priorRefunds.data)
            : null;
          const keptFullAmountCents = split.remainingCents;
          generalKeptSetupCents = keptSetupCents;
          generalKeptFeeCents = keptFeeCents;
          // What a full refund KEPT is read from the money, not from the rule:
          // a refund made before 2026-10-14 (reused on a retry) or one made
          // outside this path (a Stripe Dashboard refund) may have returned the
          // card fee or the setup fee too, and the ledger row, the audit row and
          // the poster's notice must not claim a fee was kept when it went back
          // (lh-silent-failure review of 79e9a6bb5, #2 and #3). The setup fee
          // is counted first, then the card fee, each capped by what stayed.
          const keptFromMoney = (stayedCents: number) => {
            if (isPartial || !Number.isFinite(stayedCents)) return;
            const stayed = Math.max(0, stayedCents);
            generalKeptSetupCents = Math.min(keptSetupCents, stayed);
            generalKeptFeeCents = Math.min(keptFeeCents, stayed - generalKeptSetupCents);
          };
          // Earlier admin partials already returned everything but the kept
          // fees: nothing is left to send, but the full refund still CANCELS
          // the job, so no payout can be made over a near-full refund (Q1320;
          // lh-money-escrow review N1). Mirrors cancel_escrow's $0 branch.
          const nothingLeftToSend = !isPartial && !reused && keptFullAmountCents <= 0;
          if (nothingLeftToSend) {
            generalNothingLeft = true;
            keptFromMoney(capturedCents - generalAlreadyRefundedCents);
            await postSlackOpsAlert({
              kind: "custom",
              severity: "info",
              title: "Full refund sent nothing: only the kept fees were left",
              message: `admin_refund_general on job ${jobId}: earlier refunds already returned everything but ${capturedCents - generalAlreadyRefundedCents > 0 ? `$${((capturedCents - generalAlreadyRefundedCents) / 100).toFixed(2)} (the kept card fee${generalKeptSetupCents > 0 ? " and setup fee" : ""})` : "nothing (the whole charge is already refunded)"}, so no Stripe refund was sent; the job is cancelled.`,
              fields: { job_id: jobId, payment_intent: paymentIntentId, captured_cents: capturedCents, already_refunded_cents: generalAlreadyRefundedCents },
            });
          }
          if (reused) {
            console.log(`[create-payment] admin_refund_general: charge for job ${jobId} already refunded ${generalAlreadyRefundedCents}¢ — reusing ${reused.id}, not refunding again`);
          }

          if (!nothingLeftToSend) {
          generalRefundSent = true;
          const refund = reused ?? (helprFault ? await stripe.refunds.create({
            payment_intent: paymentIntentId,
            // Q2082 (b): everything back but a first job's $2 setup fee; the
            // Helpr is billed the card fee below (or, Helpr gone, it is kept).
            amount: split.refundCents,
            metadata: {
              reason: reason || "helpr_fault_full_refund",
              admin_user_id: user.id,
              // "false": existingRefundCovering finds a retried full refund by it.
              partial: "false",
              source: "admin_refund_general",
              helpr_fault: helprFaultGone ? "helpr_gone" : "true",
              kept_setup_fee_cents: String(keptSetupCents),
              kept_card_fee_cents: String(keptFeeCents),
            },
          }, {
            idempotencyKey: `refund-helpr-fault-${jobId}`,
          }) : await stripe.refunds.create({
            payment_intent: paymentIntentId,
            // Partial or full, the amount is generalSplit's (never the card fee).
            amount: generalSplit.refundCents,
            metadata: {
              reason: reason || (isPartial ? "admin_partial_refund" : "admin_general_refund"),
              admin_user_id: user.id,
              // "false" for a full refund even when it keeps the setup fee:
              // existingRefundCovering finds a retried full refund by it.
              partial: String(isPartial),
              source: "admin_refund_general",
              // Always written ("0" when none): a creator never spreads metadata (Q343).
              kept_setup_fee_cents: String(keptSetupCents),
              kept_card_fee_cents: String(keptFeeCents),
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
          }));
          if (refund?.id) {
            const refundedCents = Math.round(Number(refund.amount ?? split.refundCents));
            generalRefundForNotice = {
              id: refund.id,
              amountCents: refundedCents,
              // A REUSED refund (a retry) is already inside generalAlreadyRefundedCents;
              // counting it twice made "kept" 0 and dropped the kept $2 from the
              // notice (lh-money-escrow re-review of the setup-fee merge, note 2).
              keptCents: Number.isFinite(capturedCents)
                ? Math.max(0, capturedCents - generalAlreadyRefundedCents - (reused ? 0 : refundedCents))
                : 0,
              taxKeptCents: split.taxKeptCents,
            };
            keptFromMoney(capturedCents - generalAlreadyRefundedCents - (reused ? 0 : refundedCents));
            helprFaultRefundRef = refund.id;
          }
          await recordRefund(supabaseAdmin, {
            refund,
            jobId,
            customerId: job.customer_id,
            paymentIntentId,
            source: "admin_refund_general",
            isPartial: isPartial || generalKeptSetupCents > 0 || generalKeptFeeCents > 0,
            reason: [
              reason || null,
              isPartial
                ? null
                : generalKeptSetupCents > 0 && generalKeptFeeCents > 0
                  ? "full refund less the card processing fee and the kept $2 setup fee"
                  : generalKeptSetupCents > 0
                    ? "full refund less the kept $2 setup fee"
                    : generalKeptFeeCents > 0
                      ? "full refund less the card processing fee"
                      : null,
            ].filter(Boolean).join(" — ") || null,
            initiatedByUserId: user.id,
          });
          generalRefundCents = Math.round(Number(refund.amount ?? 0));
          }
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
        // Q1290: hand the job claim back only when no refund can exist: the
        // call stopped before the Stripe refund, or Stripe refused it outright.
        // A network fault on the refund itself may have refunded, so the job
        // stays 'cancelling': a payout claim expects 'payout_pending' and the
        // release write is pinned to 'escrow' (Q1326), so nothing schedules or
        // sends a payout over it; money-reconciliation's cancelling_stranded
        // pages it for a person.
        const refundErrType = String((e as { type?: string } | null)?.type ?? "");
        const nothingMoved = !generalRefundSent || [
          "StripeInvalidRequestError",
          "StripeCardError",
          "StripePermissionError",
          "StripeAuthenticationError",
        ].includes(refundErrType);
        if (nothingMoved) await putGeneralClaimBack(`the refund stopped before any money moved: ${caughtMessage(e).slice(0, 200)}`);
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
        // Q1290: the job was claimed to 'cancelling' before the ledger read, so
        // the flip is pinned to that claim; 'refunded' is this refund's own
        // charge.refunded landing first (it closes 'cancelling' too).
        generalFlip = generalClaimHeld
          ? generalFlip.in("payment_status", ["cancelling", "refunded"])
          : job.payment_status == null
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
          // Q2170 (lh-money-escrow #2): the fault refund is out, so the Helpr is billed on this exit too.
          if (helprFault && helprFaultRefundRef) {
            await billHelprFaultCardFee(supabaseAdmin, jobId, helprFault.helperId, helprFaultCardFeeCents, helprFaultRefundRef);
          }
          return new Response(JSON.stringify({
            error: "refund issued but job status update failed — manual reconciliation needed",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
        }
      }

      // Q2082 (b): the Helpr at fault is billed the card fee Stripe kept, once
      // (a replay returns 0), only after the poster's full refund went out and
      // the job closed. A failure here is the platform absorbing a fee unless
      // someone acts: it pages, and pressing the button again bills it
      // (ruling and refund are both reused).
      let helprFaultBilledCents: number | null = null;
      let helprFaultBillFailed = false;
      if (helprFault) {
        const bill = await billHelprFaultCardFee(supabaseAdmin, jobId, helprFault.helperId, helprFaultCardFeeCents, helprFaultRefundRef ?? paymentIntentId ?? `job-${jobId}`);
        helprFaultBilledCents = bill.billedCents;
        helprFaultBillFailed = bill.failed;
      }

      // ── Give the gift card back (Q454) ── a FULL refund cancels the job, and
      // on a PARTLY gift-funded job the refund above returned only the card
      // shortfall: the gift part was dropped. The whole job is refunded, so
      // the whole gift comes back (restore_gift_card_for_job's default share).
      // AFTER the flip only (lh-money-escrow review of the first draft): this
      // path holds no settlement claim, so the job must be closed as
      // cancelled/refunded before the gift is back, or a payout that moved the
      // job first could pay the Helpr over it. A flip that missed returned
      // above, with nothing restored. A failed restore pages; charge.refunded
      // asks again when Stripe's full-refund event arrives (it restores on
      // every full refund), and by hand it can no longer double-pay. A partial
      // refund leaves the job running, so its gift stays where it is.
      const generalGift = isPartial
        ? { restoredCents: 0, spendableCents: 0, failed: false, posterSentence: "" }
        : await returnGiftAfterRefund(supabaseAdmin, job, "Admin refund");

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
          refund_cents: generalRefundCents,
          kept_setup_fee_cents: generalKeptSetupCents,
          kept_card_fee_cents: generalKeptFeeCents,
          helpr_fault: helprFault ? { helper_id: helprFault.helperId, kind: helprFault.kind, card_fee_billed_cents: helprFaultBilledCents, bill_failed: helprFaultBillFailed, helpr_gone: helprFaultGone } : null,
          gift_restored_cents: generalGift.restoredCents,
          gift_restore_failed: generalGift.failed,
          payment_intent_id: paymentIntentId,
        },
      });

      // Q1714: THE refund notice (in the app and by email: amount, card,
      // reference, 5-10 business days, what was kept), claimed on the refund's
      // id. The charge.refunded webhook leaves an admin_refund_general refund
      // to this path (its metadata.source), so the admin's reason and a
      // restored gift always reach the poster, and they get one notice, not
      // the old in-app pair (Q300). It links the job: a partial leaves it running.
      if (generalRefundForNotice) {
        await announceRefund(supabaseAdmin, "admin_refund_general", {
          key: `refund:${generalRefundForNotice.id}`,
          kind: "refund",
          paymentIntentId: paymentIntentId ?? null,
          amountCents: generalRefundForNotice.amountCents,
          // A partial refund leaves the rest paying for the job: nothing "kept".
          keptCents: isPartial ? 0 : generalRefundForNotice.keptCents,
          taxKeptCents: isPartial ? 0 : generalRefundForNotice.taxKeptCents,
          // Q1674: a full refund of a first job also keeps its one-time $2
          // setup fee; the notice names it after the card fee, which every
          // full refund keeps (owner, 2026-10-14).
          keptReason: !isPartial && generalRefundForNotice.keptCents > 0
            ? setupFeeKeptReason(null, generalKeptSetupCents)
            : null,
          keptUnnamed: true,
          recipientId: job.customer_id ?? null,
          jobId: job.id,
          extra: [
            helprFault
              ? (helprFaultGone
                ? "The Helpr was at fault."
                : "The Helpr was at fault, so all of your payment for the job comes back to you.")
              : "",
            reason ? `Reason: ${reason}.` : "",
            generalGift.posterSentence.trim(),
          ].filter(Boolean).join(" ") || null,
        });
      } else if (!isPartial && generalRefundCents === null && generalNothingLeft) {
        // Q1674: earlier partials already returned everything but the kept
        // setup fee, so no refund was sent and there is no refund notice to
        // claim; the poster is still told the job is cancelled and why the $2
        // stayed (lh-money-escrow review N1 of the setup-fee change).
        await insertNotifications(supabaseAdmin, {
          user_id: job.customer_id,
          title: "Refund issued",
          // Worded from what actually stayed on the charge (keptFromMoney), so
          // it never claims a fee was kept that an earlier refund returned.
          message: `"${job.title}" has been cancelled.${reason ? ` Reason: ${reason}` : ""} ${
            // Owner 2026-10-25: no card-fee name; only the one-time setup fee.
            generalKeptSetupCents > 0
              ? `The earlier refunds already sent back what comes back to you; the one-time $${(generalKeptSetupCents / 100).toFixed(2)} account setup fee is paid once and never refunded.`
              : generalKeptFeeCents > 0
              ? "The earlier refunds already sent back what comes back to you."
              : "The earlier refunds already returned the whole charge."
          }`,
          type: "payment",
          link: `/posts?job=${job.id}`,
        });
      }

      // Helper notification — only on full refund (job is cancelled). Partial
      // refunds don't change the helper's stake; if a partial-refund scenario
      // ever needs helper notification, send a separate manual message.
      if (!isPartial && job.helper_id) {
        await insertNotifications(supabaseAdmin, {
          user_id: job.helper_id,
          job_id: job.id,
          title: "Job cancelled",
          message: `"${job.title}" was cancelled by support and refunded to the person who posted it.${reason ? ` Reason: ${reason}` : ""}`,
          // `?job=` — same shape as the poster half above, and as every
          // producer converted in migration
          // 20260831232514_notification_links_land_on_the_right_spot.sql.
          //
          // This was `/jobs?filter=not_selected`. Two things were wrong
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
          type: "info", link: `/jobs?job=${job.id}`,
        });
      }

      return new Response(JSON.stringify({
        success: true, refunded: true, partial: isPartial,
        ...(generalGift.failed ? { giftRestoreFailed: true } : {}),
        ...(helprFault ? { helprFault: { cardFeeBilledCents: helprFaultBilledCents, billFailed: helprFaultBillFailed, helprGone: helprFaultGone } } : {}),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    throw new PublicError("Invalid action");
  } catch (error) {
    // A payment that runs in neither Stripe mode (a test account paired with a
    // real one, a missing test key, an unreadable test-account list): nothing
    // was sent to Stripe, and the answer says so.
    if (error instanceof StripeModeRefused) return stripeModeRefusedResponse(error, corsHeaders);
    // The payer's wallet could not be read or claimed (Q2139): no Checkout
    // page was opened. Earlier steps of the action (an expired older page, a
    // reserved gift) are the same ones a retry repeats, so retrying is safe.
    if (error instanceof StripeCustomerUnavailable) {
      console.error(`[create-payment] 503 — wallet unavailable: ${error.message}`);
      return new Response(JSON.stringify({ error: "We couldn't open the payment page just now. Please try again." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 503,
      });
    }
    // A stored id from the Stripe sandbox read under the live key (a job paid
    // before prod went live): retrying never changes Stripe's answer and no
    // real money sits behind it, so it is a 409 with a plain sentence, not a
    // 500. The paths that can recover (re-mint, cancel_escrow) handle it
    // themselves above; this is every other path's floor.
    if (isTestObjectUnderLiveKey(error)) {
      console.error("[create-payment] 409 — test-mode Stripe object under the live key:", (error as Error).message);
      return new Response(JSON.stringify({
        error: "This job's payment was made in Stripe test mode, so it can't be used here. No money was moved.",
        testModePayment: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
    }
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
  // "admin_refund": admin_refund_general asked for a FULL refund after the
  // payout. That is a refused request, not a dispute that needs reconciling:
  // no money moved and nothing is out of step, so it answers 409 and does NOT
  // page money_at_risk. On 2026-09-24 press-every-control and the prod-audit
  // presser pressed Refund on released SEED jobs and paged "Dispute settlement
  // refused ... needs manual reconciliation" twice for jobs with no dispute.
  context: "dispute" | "admin_refund" = "dispute",
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
  if (context === "admin_refund") {
    console.warn(`[create-payment] admin_refund_general full refund REFUSED for job ${jobId}: already paid out to the Helpr.`);
    return new Response(
      JSON.stringify({
        error: "This job was already paid out to the Helpr, so a full refund isn't possible. Enter a partial amount instead. Nothing was moved.",
        alreadyMoved: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
    );
  }
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

/**
 * The payment states a Quick Release / Quick Refund flip may close (Q1192): a
 * disputed job's escrow is held ('escrow') or queued ('payout_pending'). Pinned
 * on the flip so a chargeback block that lands during the Stripe call
 * (charge.dispute.created sets 'chargeback') is never written over.
 */
const DISPUTE_FLIP_PAYMENT_STATES = ["escrow", "payout_pending"] as const;

/**
 * Quick Release also closes a job our OWN transfer webhook already marked
 * 'released': transfer.created (stripe-webhook transferCreated.ts) sets
 * payment_status='released' on payout_pending/escrow/released whatever the
 * status, and it fires within milliseconds of transferToHelper, between the
 * ledger insert and this flip. Inside a held settlement claim, 'released' can
 * only come from that webhook (lh-money-escrow review of Q1192, must-fix 1).
 */
const DISPUTE_RELEASE_FLIP_PAYMENT_STATES = [...DISPUTE_FLIP_PAYMENT_STATES, "released"] as const;

/**
 * Quick Refund also closes a job its OWN refund's charge.refunded already
 * marked 'refunded' (Q1301). It withholds the Stripe fee, so its refund is
 * usually partial and charge.refunded leaves the job alone; but when the fee
 * is 0, or the charge already carried a partial refund equal to the fee, its
 * refund COMPLETES the charge and charge.refunded (stripe-webhook
 * chargeRefunded.ts) flips the job to 'refunded' first. The flip then matched
 * zero rows: a 500 and a stuck, stamped claim. Inside a held settlement claim
 * 'refunded' can only mean the card holder has the money back, which is what
 * this flip records.
 */
const DISPUTE_REFUND_FLIP_PAYMENT_STATES = [...DISPUTE_FLIP_PAYMENT_STATES, "refunded"] as const;

/**
 * Q1323: who holds a job's 'cancelling' refund claim (public.job_refund_claims,
 * service role only). Written right after the claim's compare-and-set; a row
 * is meaningful only while the job still reads 'cancelling' (a later claim
 * overwrites it), so nothing has to delete it. A write failure is logged, not
 * fatal: the job CAS is the lock, the marker only names its holder. A table
 * that is not deployed yet (42P01 / PGRST205) reads as "no marker".
 */
type RefundClaimHolder = "cancel_escrow" | "admin_refund_general";
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

/** false = the holder could not be recorded: the caller puts its claim back and answers 503. */
async function recordRefundClaim(supabaseAdmin: any, jobId: string, by: RefundClaimHolder, actorId: string | null): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("job_refund_claims")
    .upsert({ job_id: jobId, claimed_by: by, actor_user_id: actorId, claimed_at: new Date().toISOString() }, { onConflict: "job_id" })
    .select("job_id");
  if (error) {
    // Before 20261005064908 deploys there is no table: no holder can be
    // recorded, and none is read (cancel_escrow then never re-enters).
    if (MISSING_TABLE.has(String((error as { code?: string }).code ?? ""))) return true;
    console.error(`[create-payment] job_refund_claims write failed for job ${jobId} (${by}):`, error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/** The claim was put back: its holder row goes with it, so a stale row can never vouch for a later claim. */
async function deleteRefundClaim(supabaseAdmin: any, jobId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("job_refund_claims").delete().eq("job_id", jobId).select("job_id");
  if (error && !MISSING_TABLE.has(String((error as { code?: string }).code ?? ""))) {
    console.error(`[create-payment] job_refund_claims delete failed for job ${jobId} after its claim was put back:`, error.message);
  }
}

async function readRefundClaim(
  supabaseAdmin: any,
  jobId: string,
): Promise<{ claimedBy: RefundClaimHolder | null; claimedAt: string | null; error: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("job_refund_claims").select("claimed_by, claimed_at").eq("job_id", jobId).maybeSingle();
  if (error) {
    if (MISSING_TABLE.has(String((error as { code?: string }).code ?? ""))) return { claimedBy: null, claimedAt: null, error: null };
    return { claimedBy: null, claimedAt: null, error: error.message };
  }
  const row = data as { claimed_by?: string; claimed_at?: string } | null;
  const by = row?.claimed_by === "cancel_escrow" || row?.claimed_by === "admin_refund_general" ? row.claimed_by : null;
  return { claimedBy: by, claimedAt: row?.claimed_at ?? null, error: null };
}

/**
 * Q1322: a 'cancelling' claim could not be put back (cancel_escrow's or a full
 * admin refund's, stopped before any refund). The page used to tell a person
 * to "set payment_status back to X by hand" whatever had happened, including
 * when charge.refunded (a Dashboard refund) had already moved the job to
 * 'refunded', where following it would re-open refunded money. The row is
 * re-read first and the page is worded by its actual state:
 *   - write ERROR, or the re-read fails: critical, state unknown, check first;
 *   - still 'cancelling' (the status moved under the claim): critical, put it
 *     back by hand, naming the state it was claimed from;
 *   - 'refunded': nothing to put back (the money went back to the card) —
 *     logged, not paged;
 *   - anything else: the claim is already gone; a warning naming the state,
 *     with nothing to undo.
 */
async function claimPutBackMissed(
  supabaseAdmin: any,
  args: { jobId: string; path: "cancel_escrow" | "admin_refund_general"; why: string; restoreTo: string | null; dbError: string | null },
): Promise<void> {
  const { jobId, path, why, restoreTo, dbError } = args;
  let now: { status?: string | null; payment_status?: string | null } | null = null;
  let readErr: string | null = null;
  if (!dbError) {
    const { data, error } = await supabaseAdmin.from("jobs").select("status, payment_status").eq("id", jobId).maybeSingle();
    if (error) readErr = error.message;
    else now = (data as { status?: string | null; payment_status?: string | null } | null) ?? null;
  }
  const fields = { job_id: jobId, restore_to: String(restoreTo), now: now ? `${now.status ?? "?"}/${now.payment_status ?? "?"}` : "unread" };
  if (dbError || readErr || !now || now.payment_status === "cancelling") {
    console.error(`CRITICAL: [create-payment] ${path} on job ${jobId}: ${why}, and its 'cancelling' claim could not be put back: ${dbError ?? readErr ?? "zero rows"}`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Job stuck in 'cancelling' — refund claim could not be put back",
      message: dbError || readErr || !now
        ? `${path} claimed job ${jobId} (payment_status -> 'cancelling'), stopped before any refund (${why}), and could not restore payment_status (${(dbError ?? readErr ?? "row not found").slice(0, 160)}). No money moved here. Read the job's payment_status and its charge in Stripe FIRST: if it reads 'cancelling', set it back to '${restoreTo ?? "null"}'; if it reads 'refunded', leave it.`
        : `${path} claimed job ${jobId} (payment_status -> 'cancelling'), stopped before any refund (${why}); the job's status moved to '${now.status ?? "?"}' under the claim, so it could not be put back. No money moved here. Set payment_status back to '${restoreTo ?? "null"}' by hand.`,
      fields: { ...fields, db_error: (dbError ?? readErr ?? "zero rows").slice(0, 200) },
    });
    return;
  }
  if (now.payment_status === "refunded") {
    console.warn(`[create-payment] ${path} on job ${jobId}: ${why}; the claim was already closed as 'refunded' (charge.refunded), nothing to put back`);
    return;
  }
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "warning",
    title: "Refund claim already gone when it was put back",
    message: `${path} stopped before any refund on job ${jobId} (${why}), and by then the job no longer read 'cancelling' (now ${fields.now}). Nothing was moved by this call and nothing needs putting back; check that the job's state matches Stripe.`,
    fields,
  });
}

/**
 * Zero rows matched the Quick Release / Quick Refund flip: did a chargeback
 * block land during the Stripe call? Re-reads the job; when it reads
 * 'chargeback' the claim is KEPT, ops is paged and the caller answers 409.
 * Returns null when no chargeback is there (or the read failed: the caller's
 * existing fail-loud path then runs).
 *
 * `moneyMoved` says whether this call actually sent the transfer / refund.
 * With no Helpr on the job or nothing owed (a 0 payout, a 0 refund) no Stripe
 * call happened, and the answer and the page say so instead of claiming the
 * money "went out" (Q1303).
 */
async function chargebackLandedDuringSettlement(
  supabaseAdmin: any,
  jobId: string,
  moved: "transfer" | "refund",
  moneyMoved: boolean,
  release?: { stripe: any; paymentIntentId: string | null; title: string | null },
): Promise<Response | null> {
  const { data: current, error } = await supabaseAdmin
    .from("jobs").select("status, payment_status").eq("id", jobId).maybeSingle();
  if (error || !current || current.payment_status !== "chargeback") return null;
  console.error(`[create-payment] job ${jobId}: a chargeback block landed during the ${moved} call; the flip did NOT overwrite it`);
  // Q1260: the Quick Release transfer went out over a live chargeback. The
  // webhooks' clawback runs on charge.dispute.created / funds_withdrawn, and
  // both may have been processed BEFORE this transfer existed, so nothing
  // would ever reverse it. Run the same idempotent clawback here, against the
  // charge's own Stripe dispute (an inquiry withdraws nothing: left alone).
  const clawbackOutcome = moved === "transfer" && moneyMoved && release
    ? await clawBackRacedRelease(release.stripe, supabaseAdmin, jobId, release.title, release.paymentIntentId)
    : null;
  const action = moved === "transfer" ? "Release" : "Refund";
  if (!moneyMoved) {
    // Nothing was sent (no Helpr, or nothing owed): no money to reconcile, so
    // no money_at_risk page; the block stands and the job stays disputed.
    await postSlackOpsAlert({
      kind: "custom",
      severity: "warning",
      title: `Quick ${action} raced a chargeback — block kept, nothing was sent`,
      message: `A Stripe chargeback marked job ${jobId} payment_status='chargeback' while Quick ${action} was settling it. This Quick ${action} sent no ${moved} (nothing was owed), so no money moved; the job was NOT flipped and stays 'disputed' under the chargeback's block. Answer the chargeback in Stripe. This Quick ${action}'s settlement claim was never stamped (nothing moved), so it expires on its own and the dispute can be settled again after that.`,
      fields: { job_id: jobId, job_status: String(current.status ?? "—") },
      oncePerDayKey: `quick-settle-raced-chargeback:${jobId}:nothing-sent`,
    });
    return new Response(JSON.stringify({
      error: `A card chargeback landed on this job while it was being settled. No ${moved} was sent (nothing was owed); the chargeback's block was left in place. Ops has been told.`,
      chargebackRaced: true,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
  }
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "critical",
    title: `Quick ${moved === "transfer" ? "Release" : "Refund"} raced a chargeback — block kept, money already moved`,
    message: moved === "transfer"
      ? `A Stripe chargeback marked job ${jobId} payment_status='chargeback' while Quick Release's transfer was in flight. The transfer went out, so the job was NOT flipped to released (the chargeback's block stands). Clawback: ${clawbackOutcome?.text ?? "not attempted"}. FIRST check chargeback_clawbacks for this job's dispute before reversing anything by hand: charge.dispute.created also runs the clawback against the job's transfer group, and reversing it again takes the money twice. The job stays 'disputed' and this Quick Release's stamped settlement claim stays in dispute_settlement_claims (nothing clears it on its own); once reconciled, delete that row (delete from public.dispute_settlement_claims where job_id = '${jobId}') so the dispute can be closed.`
      : `A Stripe chargeback marked job ${jobId} payment_status='chargeback' while Quick Refund's refund was in flight. The refund went out, so the job was NOT flipped to refunded (the chargeback's block stands). The card holder now has the refund AND the chargeback: respond to the dispute in Stripe with the refund as evidence.`,
    fields: {
      job_id: jobId,
      job_status: String(current.status ?? "—"),
      ...(clawbackOutcome ? { clawback: clawbackOutcome.kind } : {}),
    },
    // The outcome is in the key: a later attempt that clawed back (or failed)
    // must not be suppressed by an earlier page with a different outcome.
    oncePerDayKey: `quick-settle-raced-chargeback:${jobId}${clawbackOutcome ? `:${clawbackOutcome.kind}` : ""}`,
  });
  return new Response(JSON.stringify({
    error: `A card chargeback landed on this job while the ${moved} was being made. The ${moved} went out; the chargeback's block was left in place. Ops has been paged to reconcile.`,
    chargebackRaced: true,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
}

/**
 * Q1260: reverse a Quick Release transfer that landed after a real chargeback.
 * Finds the charge's Stripe dispute, then runs the webhook's own clawback
 * (idempotent per dispute and transfer, so a later funds_withdrawn delivery
 * resumes, never repeats). Never throws: the outcome is a sentence for the
 * page, and anything it could not do says to reverse the transfer by hand.
 */
async function clawBackRacedRelease(
  stripe: any,
  supabaseAdmin: any,
  jobId: string,
  title: string | null,
  paymentIntentId: string | null,
): Promise<{ kind: string; text: string }> {
  const byHand = "redeliver charge.dispute.funds_withdrawn for this job's dispute from the Stripe Dashboard (its clawback is idempotent per transfer) or reverse the transfer by hand.";
  if (!paymentIntentId) return { kind: "no_payment_intent", text: `no PaymentIntent on file to find the dispute: ${byHand}` };
  let disputes: Array<{ id: string; status?: string }>;
  try {
    const list = await stripe.disputes.list({ payment_intent: paymentIntentId, limit: 10 });
    disputes = (list?.data ?? []) as Array<{ id: string; status?: string }>;
  } catch (e) {
    return { kind: "dispute_read_failed", text: `the Stripe dispute could not be read (${caughtMessage(e).slice(0, 160)}): ${byHand}` };
  }
  // A live, money-moving dispute only: an inquiry (warning_*) withdrew
  // nothing, and one already WON was paid back by its closed webhook, so a
  // reversal now would never be repaid (review of Q1260, nit 1).
  const real = disputes.find((d) => ["needs_response", "under_review", "lost"].includes(String(d.status ?? "")));
  if (!real) {
    return {
      kind: disputes.some((d) => String(d.status ?? "").startsWith("warning_needs") || d.status === "warning_under_review")
        ? "inquiry_only"
        : disputes.length > 0 ? "dispute_closed" : "no_dispute_found",
      text: disputes.some((d) => String(d.status ?? "").startsWith("warning_needs") || d.status === "warning_under_review")
        ? "the dispute is still an inquiry, which withdraws nothing; if the bank escalates it, charge.dispute.funds_withdrawn claws the transfer back."
        : disputes.length > 0
        ? `the charge's dispute is already closed (${disputes.map((d) => d.status ?? "?").join(", ")}), so nothing was reversed; check the transfer against the outcome by hand.`
        : `Stripe lists no dispute for PaymentIntent ${paymentIntentId}: ${byHand}`,
    };
  }
  try {
    const r = await clawBackReleasedPayout(
      { stripe, supabase: supabaseAdmin, logStep: (step: string, details?: unknown) => console.log(`[create-payment] ${step}`, details ?? "") },
      real as never,
      { id: jobId, title },
      { alertIfNoTransfer: true },
    );
    if (r.failed.length > 0) {
      return { kind: "clawback_partial", text: `${(r.reversedNowCents / 100).toFixed(2)} dollars reversed now, but Stripe refused ${r.failed.length} transfer(s) (paged separately): reverse those by hand.` };
    }
    return { kind: "clawed_back", text: `reversed now: $${(r.reversedNowCents / 100).toFixed(2)} ($${(r.reversedTotalCents / 100).toFixed(2)} in total for dispute ${real.id}). A won dispute pays it back automatically.` };
  } catch (e) {
    return { kind: "clawback_failed", text: `the clawback failed (${caughtMessage(e).slice(0, 160)}): ${byHand}` };
  }
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

/**
 * Owner 2026-10-30: mark the giveaway winner's one-time setup fee paid, atomically,
 * and say how many cents THIS call claimed (0 when it was already paid). Fails
 * closed: an unreadable setting or a failed write refuses before any money moves.
 */
async function claimGiveawaySetupFee(
  supabaseAdmin: any,
  helperId: string,
): Promise<{ cents: number; error?: undefined } | { cents?: undefined; error: string }> {
  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from("platform_settings").select("onboarding_fee_cents").limit(1).single();
  if (settingsErr || settings?.onboarding_fee_cents == null) return { error: settingsErr?.message ?? "no onboarding_fee_cents" };
  const feeCents = Number(settings.onboarding_fee_cents);
  if (feeCents <= 0) return { cents: 0 };
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("profiles")
    .update({ onboarding_fee_paid: true, onboarding_fee_charged_at: new Date().toISOString() })
    .eq("user_id", helperId)
    .eq("onboarding_fee_paid", false)
    .select("user_id");
  if (claimErr) return { error: claimErr.message ?? String(claimErr) };
  return { cents: claimed && claimed.length > 0 ? feeCents : 0 };
}

/** No money moved: hand the claim back so the fee is neither lost nor taken twice. Logged loudly when it cannot. */
async function unclaimGiveawaySetupFee(supabaseAdmin: any, helperId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
    .eq("user_id", helperId);
  if (error) {
    console.error(`CRITICAL: [create-payment] no money moved AND the setup fee un-claim failed for ${helperId} — onboarding_fee_paid is incorrectly true; manual reconciliation needed:`, error);
  }
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
  // Owner 2026-10-30: the giveaway job sends exactly its $50 (isGiveawayFixedPayJob).
  fixedPayGiveaway = false,
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

  // Payout hold (Q764). Thrown before `beforeTransfer` stamps the settlement
  // claim and before any Stripe call, so no money moved and the caller hands
  // its claim back: the dispute stays open until the hold is released. Fails
  // closed on an unreadable hold.
  const hold = await checkPayoutHold(supabaseAdmin, helperId);
  if (hold.kind === "error") {
    console.error(`[create-payment] transferToHelper — payout hold check failed for ${helperId}: ${hold.message}`);
    throw new PublicError("Could not verify the Helpr's payout hold status — no money was moved. Try again.");
  }
  if (hold.kind === "held") {
    throw new PublicError("This Helpr's payouts are on hold. Release the hold in the Payout Queue first — no money was moved.");
  }
  // No payout without a verified ID (owner 2026-10-30). Same place, same fail-closed rule:
  // this path sends the transfer before it writes its ledger row.
  const idHold = await checkIdentityHold(supabaseAdmin, helperId);
  if (idHold.kind === "error") {
    console.error(`[create-payment] transferToHelper — ID check read failed for ${helperId}: ${idHold.message}`);
    throw new PublicError("Could not verify the Helpr's ID check — no money was moved. Try again.");
  }
  if (idHold.kind === "waits") throw new PublicError(IDENTITY_HOLD_MESSAGE);
  // Q1491: a JOB payout hold (an underfunded gift-card job). This path sends
  // the transfer before it writes its ledger row, so the payout_transfers
  // claim trigger cannot stop it; ask here, same place, same fail-closed rule.
  const jobHold = await checkJobPayoutHold(supabaseAdmin, jobId);
  if (jobHold.kind === "error") {
    console.error(`[create-payment] transferToHelper — job payout hold check failed for ${jobId}: ${jobHold.message}`);
    throw new PublicError("Could not verify this job's payout hold — no money was moved. Try again.");
  }
  if (jobHold.kind === "held") {
    throw new PublicError(JOB_PAYOUT_HELD_MESSAGE);
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

  // Lead 2026-10-23 (Stripe rejected the platform and its connected accounts): no transfer unless
  // Stripe says the Helpr's account is payable (_shared/livePayoutHold.ts).
  // Thrown before `beforeTransfer` stamps the settlement claim and before any
  // money moves, like the payout hold above: the caller hands its claim back.
  const live = await holdUnlessPayable({
    stripe,
    supabaseAdmin,
    helperId,
    accountId: helperProfile.stripe_account_id,
    fn: "create-payment",
    what: "the dispute release payout",
    then: "Nothing moved; the dispute stays open until it is released again.",
    fields: { job_id: jobId },
  });
  if (live.held) {
    throw new PublicError(live.kind === "platform_rejected" || live.kind === "cannot_verify"
      ? "Stripe could not confirm the Helpr's payout account right now, so no money was moved. Try again later."
      : "Stripe says the Helpr's payout account can't receive money right now, so no money was moved.");
  }

  // Q2082 (b), owner 2026-10-18 ("J4"): a card fee this Helpr owes from a
  // Helpr-at-fault refund comes out of this payout too (what keeps it at $1 or
  // more; the rest waits for the next payout). Taken once per job under the
  // same payout_ref as release-payout and process-scheduled-payouts
  // (_shared/helprFaultFee.ts). Fails closed, before any money moves.
  const unroundedCents = Math.round(amount * 100);
  // Owner 2026-10-30: the giveaway sends exactly $50, so a debt waits for the next payout.
  const helprFaultTake = fixedPayGiveaway
    ? { cents: 0, error: undefined }
    : await takeHelprFaultFee(supabaseAdmin, helperId, jobId, helprFaultFeeCapCents(unroundedCents));
  if (helprFaultTake.error !== undefined) {
    console.error(`[create-payment] transferToHelper — Helpr-fault card fee read failed for job ${jobId}: ${helprFaultTake.error}`);
    throw new PublicError("Could not read the Helpr's card-fee debt — no money was moved. Try again.");
  }
  const helprFaultFeeCents = helprFaultTake.cents;
  // Owner 2026-10-30: a setup fee the giveaway's winner owes is covered from the
  // $10 Louisiana Helpr keeps. Marked paid once like the other two payout paths;
  // the transfer stays $50 and the ledger books $8 commission + $2 setup fee.
  const giveawaySetupFee = fixedPayGiveaway ? await claimGiveawaySetupFee(supabaseAdmin, helperId) : { cents: 0 };
  if (giveawaySetupFee.error !== undefined) {
    console.error(`[create-payment] transferToHelper — setup fee claim failed for job ${jobId}: ${giveawaySetupFee.error}`);
    throw new PublicError("Could not settle the Helpr's setup fee — no money was moved. Try again.");
  }
  const giveawaySetupFeeCents = giveawaySetupFee.cents;
  // Every exit below that moves NO money gives the withheld fee back.
  const restoreHelprFault = async () => {
    if (helprFaultFeeCents > 0) await restoreHelprFaultFee(supabaseAdmin, helperId, jobId, "create-payment.transferToHelper");
    if (giveawaySetupFeeCents > 0) await unclaimGiveawaySetupFee(supabaseAdmin, helperId);
  };

  // Whole dollars, rounded DOWN; the platform keeps the cents (Q236). Then
  // the Helpr-fault debt off in exact cents (Q2165, owner 2026-10-19), so what
  // is withheld is exactly what is booked. The one figure both the transfer
  // and its ledger row carry.
  const amountCents = roundPayoutDownCents(unroundedCents) - helprFaultFeeCents;
  if (amountCents <= 0) {
    // No money moved: the caller hands its settlement claim back.
    await restoreHelprFault();
    throw new PublicError("The helpr's share rounds down to $0 — nothing to transfer. Resolve this dispute by hand.");
  }

  try {
    const transferParams: any = {
      amount: amountCents,
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

    // Link the transfer to the source charge if we have one. A failed
    // retrieve REFUSES the transfer: without `source_transaction` Stripe funds
    // the payout from the platform's own available balance instead of this
    // job's charge. It was a warning that let the transfer go ahead
    // (money review, Q891 follow-up). This runs before `beforeTransfer`, so
    // the claim is still unstamped and no money has moved: the caller hands
    // its settlement claim back (no `moneyMoved`).
    if (paymentIntentId) {
      let pi;
      try {
        pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      } catch (piErr) {
        console.error(`[create-payment] transferToHelper — could not retrieve ${paymentIntentId} to link the transfer to its charge for job ${jobId}:`, piErr);
        await restoreHelprFault();
        throw new PublicError("Couldn't confirm the source charge with Stripe, so the payout was not sent. No money was moved — try again.");
      }
      if (pi.latest_charge) {
        transferParams.source_transaction = pi.latest_charge;
      }
    }

    if (beforeTransfer && !(await beforeTransfer())) {
      // The settlement claim is no longer this caller's. No money moved, so
      // this is NOT moneyMoved: the caller hands back whatever it still holds.
      await restoreHelprFault();
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
      // A definite refusal sent nothing: the withheld card fee goes back.
      else await restoreHelprFault();
      throw stripeErr;
    }
    console.log(`Transferred $${(amountCents / 100).toFixed(2)} to helper ${helperId} (transfer: ${transfer.id})`);

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
        amount_cents: amountCents,
        platform_fee_cents: Math.round(platformFeeAmount * 100) - giveawaySetupFeeCents,
        status: "paid",
        paid_at: new Date().toISOString(),
        initiated_by: "admin",
        initiated_by_user_id: initiatedByUserId,
        // Q1520: the cents rounded off. The only onboarding fee on this path is the
        // giveaway's, which came out of Louisiana Helpr's share, not the transfer.
        // Named keys, no spread: checkoutMetadataKeysAreWritten reads every
        // metadata literal in this file and a spread makes its inventory blind.
        metadata: {
          source: "admin_release_dispute",
          onboarding_fee_cents: giveawaySetupFeeCents,
          rounding_remainder_cents: payoutWithheldMetadata(unroundedCents, 0, amountCents, helprFaultFeeCents).rounding_remainder_cents,
          // Q2082 (b): the Helpr-fault card fee kept back (the earnings export adds it back).
          helpr_fault_fee_cents: helprFaultFeeCents,
        },
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
        await insertNotifications(supabaseAdmin, {
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
 * Give back the gift card that funded a job being cancelled, via
 * restore_gift_card_for_job (idempotent: a second call answers
 * `already_restored`). Mirrors void-cancelled-payments' restorePifGift outcome
 * handling: a null `error` is not proof, only the outcomes the function
 * defines count, and an error is only survivable when no gift is at stake.
 */
async function restoreGiftForCancelledJob(
  supabaseAdmin: any,
  jobId: string,
): Promise<{ ok: true; outcome: string | null; restoreCents: number; spendable: boolean } | { ok: false; reason: string }> {
  const { data, error: rpcErr } = await supabaseAdmin.rpc("restore_gift_card_for_job", { p_job_id: jobId });
  const outcome = rpcErr ? null : ((data as { outcome?: string } | null)?.outcome ?? null);
  if (
    outcome === "restored" ||
    outcome === "unreserved" ||
    outcome === "already_restored" ||
    outcome === "no_credit" ||
    outcome === "nothing_to_restore" ||
    outcome === "job_not_found"
  ) {
    const d = (data ?? {}) as { restore_cents?: number; payment_status?: string };
    return {
      ok: true,
      outcome,
      restoreCents: Math.max(0, Math.round(Number(d.restore_cents ?? 0)) || 0),
      // A replacement minted from a REVOKED donation inherits 'refunded' and
      // cannot be spent; only a 'paid' one is announced as back.
      spendable: (d.payment_status ?? "paid") === "paid",
    };
  }
  const reason = rpcErr
    ? `${rpcErr.message}${rpcErr.code ? ` (${rpcErr.code})` : ""}`
    : `unrecognised outcome ${JSON.stringify(data)}`;
  // Already given back (a replacement row carries this job)? The ORIGINAL row
  // stays 'redeemed' after a restore, so without this a retry while the RPC is
  // down read a gift that is already back as one still at stake (lh-money-
  // escrow review of Q454, LOW).
  const { data: restoredRows, error: restoredErr } = await supabaseAdmin
    .from("gift_cards")
    .select("id, restored_from_job_id")
    .eq("restored_from_job_id", jobId)
    .limit(1);
  if (!restoredErr && (restoredRows ?? []).length > 0) {
    return { ok: true, outcome: "already_restored", restoreCents: 0, spendable: false };
  }
  // Was a gift at stake at all? If not (the ordinary card-funded job), an
  // unavailable RPC must not hold every cancellation hostage.
  const { data: giftRows, error: giftErr } = await supabaseAdmin
    .from("gift_cards")
    .select("id")
    .eq("job_id", jobId)
    .in("status", ["redeemed", "reserved"])
    .limit(1);
  if (!restoredErr && !giftErr && (giftRows ?? []).length === 0) {
    console.warn(`[create-payment] restore_gift_card_for_job unavailable for job ${jobId}: ${reason}. No gift on this job — cancelling anyway.`);
    return { ok: true, outcome: null, restoreCents: 0, spendable: false };
  }
  const lookupErr = restoredErr ?? giftErr;
  return { ok: false, reason: lookupErr ? `${reason}; gift lookup failed: ${lookupErr.message}` : reason };
}

/**
 * Q454: after an admin refund has CLOSED a job (cancelled/refunded), give back
 * the gift card that paid the part its PaymentIntent did not: on a partly
 * gift-funded job the refund returned only the card shortfall. Whole gift
 * (restore_gift_card_for_job's default share): the whole job was refunded.
 *
 * Called only after the job's terminal flip (lh-money-escrow review, HIGH):
 * once the job reads cancelled/refunded no NEW payout can start from it. A
 * payout already past its claim can still land (claimPayout re-reads the job
 * only once its claim row exists, Q1211; a transfer after that re-read
 * proceeds), so the payout ledger is read first and the whole gift comes back
 * only when no
 * transfer (pending, paid or reversed) moved money out of this escrow (review
 * round 2, MEDIUM; the same rule charge.refunded applies). Never throws; a
 * refusal or a failure pages critical and is finished by hand. Returns what
 * came back for the dispute record, the audit row and the poster's notice,
 * which only announces a gift this call minted and that can be spent.
 */
async function returnGiftAfterRefund(
  supabaseAdmin: any,
  job: { id: string; is_seed?: boolean | null },
  path: "Quick Refund" | "Admin refund",
): Promise<{ restoredCents: number; spendableCents: number; failed: boolean; posterSentence: string }> {
  // Q1208 (1): only when a gift is still at stake: a redeemed or reserved gift
  // on the job with no replacement minted for it. A card-only job's refund
  // after a reversed payout paged "did not return the poster's gift card"
  // about a gift that never was. An unreadable gift ledger is still a page.
  const { data: stakeGifts, error: stakeGiftErr } = await supabaseAdmin
    .from("gift_cards")
    .select("id, status")
    .eq("job_id", job.id)
    .in("status", ["redeemed", "reserved"])
    .limit(1);
  const { data: stakeReplaced, error: stakeReplacedErr } = await supabaseAdmin
    .from("gift_cards")
    .select("id, restored_from_job_id, parent_credit_id")
    .eq("restored_from_job_id", job.id)
    .limit(1);
  const stakeErr = stakeGiftErr ?? stakeReplacedErr;
  const { data: payoutRows, error: payoutErr } = await supabaseAdmin
    .from("payout_transfers")
    .select("id, stripe_transfer_id, status")
    .eq("job_id", job.id)
    .in("status", ["pending", "paid", "reversed"])
    .limit(50);
  const payoutList = (payoutRows ?? []) as Array<{ id: string; stripe_transfer_id: string | null; status: string }>;
  const payout = payoutList[0];
  if (!stakeErr) {
    const held = ((stakeGifts ?? []) as unknown[]).length > 0;
    const replaced = ((stakeReplaced ?? []) as Array<{ restored_from_job_id?: string | null }>)
      .some((r) => r.restored_from_job_id === job.id);
    if (!held || replaced) {
      // Review of Q1208: no gift is owed, but a payout that is out (or about
      // to be) while the card was refunded in full is still the Q1211
      // double-outflow race, and still pages. Quiet only for a reversed row
      // (its money came back); an unreadable payout ledger pages too.
      const live = payoutList.find((r) => r.status === "pending" || r.status === "paid");
      if (payoutErr || live) {
        const why = payoutErr
          ? `the payout ledger could not be read (${payoutErr.message})`
          : `payout transfer ${live!.stripe_transfer_id ?? live!.id} (${live!.status}) moved money out of this escrow toward a Helpr`;
        console.error(`CRITICAL: [create-payment] ${path} refunded job ${job.id} in full: ${why}`);
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: `${path} refunded a job whose payout already moved`,
          message: `${path} refunded job ${job.id} in full and closed it as cancelled/refunded, but ${why}: the escrow may have gone out twice. Reconcile the payout against the refund by hand.`,
          fields: { job_id: job.id, reason: why.slice(0, 200) },
          seed: job.is_seed === true,
        });
      }
      return { restoredCents: 0, spendableCents: 0, failed: false, posterSentence: "" };
    }
  }
  if (stakeErr || payoutErr || payout) {
    const why = stakeErr
      ? `the gift ledger could not be read (${stakeErr.message})`
      : payoutErr
      ? `the payout ledger could not be read (${payoutErr.message})`
      : `payout transfer ${payout.stripe_transfer_id ?? payout.id} (${payout.status}) moved money out of this escrow toward a Helpr`;
    console.error(`CRITICAL: [create-payment] ${path} closed job ${job.id} as refunded; its gift card was NOT restored: ${why}`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      // Q1208 (1): a payout that moved during the refund is its own signal
      // (the Q1211 class), not "the restore failed".
      title: payout && !stakeErr && !payoutErr
        ? `${path} refunded a job whose payout already moved: gift card NOT returned`
        : `${path} closed the job but did not return the poster's gift card`,
      message:
        `${path} refunded the card part of job ${job.id} and closed it as cancelled/refunded, but any gift card that paid the rest ` +
        `was NOT given back automatically: ${why}. Reconcile the payout against the refund, then restore the gift by hand ` +
        "(restore_gift_card_for_job for this job) if it is owed.",
      fields: { job_id: job.id, reason: why.slice(0, 200) },
      seed: job.is_seed === true,
    });
    return { restoredCents: 0, spendableCents: 0, failed: true, posterSentence: "" };
  }
  const back = await restoreGiftForCancelledJob(supabaseAdmin, job.id);
  if (!back.ok) {
    console.error(`CRITICAL: [create-payment] ${path} closed job ${job.id} as refunded but could not restore its gift card: ${back.reason}`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: `${path} closed the job but did not return the poster's gift card`,
      message:
        `${path} refunded the card part of job ${job.id} and closed it as cancelled/refunded, but the gift card that paid the rest ` +
        "could not be given back. The job is closed, so no payout can follow: restore the gift by hand (restore_gift_card_for_job " +
        "for this job) and tell the poster.",
      fields: { job_id: job.id, reason: back.reason.slice(0, 200) },
      seed: job.is_seed === true,
    });
    return { restoredCents: 0, spendableCents: 0, failed: true, posterSentence: "" };
  }
  const minted = back.outcome === "restored" ? back.restoreCents : 0;
  return {
    restoredCents: minted,
    // Q1208 (4): what the poster can actually spend. A replacement minted from
    // a REVOKED donation inherits 'refunded' and cannot be spent, so it is not
    // part of what the dispute record says went back to the poster.
    spendableCents: back.spendable ? minted : 0,
    failed: false,
    posterSentence: minted > 0 && back.spendable
      ? ` The $${formatExactDollars(minted / 100)} your gift card paid is back as a gift you can use on another job.`
      : "",
  };
}

/**
 * Q1209: the charge's own refunds are the authority, as cancel_escrow reads
 * amount_refunded. An admin refund retried after its refund already went out
 * (its flip failed) must not ask Stripe for a second one: inside the ~24h key
 * window that replays, past it Stripe refuses ("charge already refunded") and
 * the job could never be finished from the button. Returns an existing live
 * (succeeded or pending) refund on this PaymentIntent when the amount already
 * refunded covers `cents` AND that THIS action wrote (review of Q1209: a
 * refund of another flow, a Dashboard or cancel refund, is never reused or
 * booked as this action's): metadata.source names the action, and for the
 * general refund metadata.partial is "false". The one of exactly that amount,
 * else the largest. Null when none qualifies, so the caller refunds as before
 * (inside the key window that replays this action's own refund).
 */
/** Q2082 (b): the admin's Helpr-at-fault ruling from the request body, or null when it is missing or malformed. */
function parseHelprFault(raw: unknown): { helperId: string; kind: "no_show" | "backout"; note: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { helperId?: unknown; kind?: unknown; note?: unknown };
  if (typeof r.helperId !== "string" || !STRIPE_MODE_UUID_RE.test(r.helperId)) return null;
  if (r.kind !== "no_show" && r.kind !== "backout") return null;
  const note = typeof r.note === "string" ? r.note.trim() : "";
  if (note.length < 1 || note.length > 1000) return null;
  return { helperId: r.helperId, kind: r.kind, note };
}

/**
 * Q2082 (b): the Helpr-at-fault ruling comes FIRST, as the admin (auth.uid()
 * in admin_rule_helpr_fault is who ruled; it checks the admin role, that the
 * Helpr was booked on the job, and gives exactly one strike for it). It is
 * idempotent ('already_ruled'), so a refund that stops later is retried by
 * pressing the button again. No ruling, no fault refund: a refusal moves no
 * money. Then (owner 2026-10-18 ~22:30Z) whether the ruled Helpr still exists:
 * when their account is gone nobody can be billed, so the caller keeps the card
 * fee from the refund (we never absorb it). Shared by admin_refund_general and
 * admin_refund_dispute.
 */
async function ruleHelprFaultFirst(
  authHeader: string,
  supabaseAdmin: any,
  jobId: string,
  hf: { helperId: string; kind: "no_show" | "backout"; note: string },
): Promise<{ gone: boolean } | { refusal: Response }> {
  const asAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { error: ruleErr } = await asAdmin.rpc("admin_rule_helpr_fault", {
    p_job_id: jobId, p_helper_id: hf.helperId, p_kind: hf.kind, p_note: hf.note,
  });
  if (ruleErr) {
    console.error(`[create-payment] admin_rule_helpr_fault refused job ${jobId}:`, ruleErr.message);
    return { refusal: new Response(JSON.stringify({
      error: `${helprFaultRuleError(ruleErr.message)} No money was moved.`,
      code: ruleErr.message,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }) };
  }
  const gone = await helprFaultHelprIsGone(supabaseAdmin, jobId);
  if (gone === null) {
    return { refusal: new Response(JSON.stringify({
      error: "Couldn't read the Helpr-at-fault ruling just recorded. No money was moved: press it again.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }) };
  }
  return { gone };
}

/**
 * lh-money-escrow review of c4ec33afb #1: a job with a Helpr-at-fault ruling is
 * only refunded AS a Helpr fault. A plain refund retried after a fault refund
 * went out would reuse it (the card fee back to the poster) without billing the
 * Helpr. Returns the refusal (nothing moved), or null when there is no ruling.
 * Fails closed on an unreadable ruling.
 */
async function refuseRefundWithoutFaultRuling(supabaseAdmin: any, jobId: string): Promise<Response | null> {
  const { data, error } = await supabaseAdmin
    .from("job_helpr_fault_rulings").select("id").eq("job_id", jobId).maybeSingle();
  if (error) {
    console.error(`[create-payment] reading job ${jobId}'s Helpr-at-fault ruling failed:`, error.message);
    return new Response(JSON.stringify({
      error: "Couldn't check whether this job has a Helpr-at-fault ruling. No money was moved: try again.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 });
  }
  if (!data) return null;
  return new Response(JSON.stringify({
    error: "This job has a Helpr-at-fault ruling, so refund it with \"Helpr at fault\" (that bills the Helpr the card fee). No money was moved.",
    code: "helpr_fault_ruling_exists",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
}

/**
 * Q2082 (b): AFTER the fault refund and the job flip, bill the Helpr the card
 * fee Stripe kept (bill_helpr_fault_card_fee: once per ruling, capped at the
 * charge; 0 when the refund kept the fee because the Helpr is gone). A failure
 * never undoes the refund: it pages, and the admin's "Bill the Helpr"
 * (admin_bill_helpr_fault, Q2170) bills it later; it moves no money.
 */
async function billHelprFaultCardFee(
  supabaseAdmin: any,
  jobId: string,
  helperId: string,
  cardFeeCents: number | null,
  refundRef: string,
): Promise<{ billedCents: number | null; failed: boolean }> {
  const { data: billed, error: billErr } = await supabaseAdmin.rpc("bill_helpr_fault_card_fee", {
    p_job_id: jobId,
    p_card_fee_cents: Math.max(0, Math.round(cardFeeCents ?? 0)),
    p_refund_ref: refundRef,
  });
  if (billErr || typeof billed !== "number") {
    console.error(`[create-payment] bill_helpr_fault_card_fee failed for job ${jobId}:`, billErr?.message ?? billed);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Helpr-at-fault refund sent, but the Helpr was NOT billed the card fee",
      message: `Job ${jobId} was refunded to the poster (Helpr at fault, card fee included), but billing the ${cardFeeCents ?? "?"}-cent card fee to the Helpr failed: ${billErr?.message ?? "no amount returned"}. Open the job in Admin > Jobs and press "Bill the Helpr" (create-payment admin_bill_helpr_fault: it moves no money and bills once).`,
      fields: { job_id: jobId, helper_id: helperId, card_fee_cents: String(cardFeeCents ?? "") },
    });
    return { billedCents: null, failed: true };
  }
  return { billedCents: billed, failed: false };
}

/**
 * Q2082 (b), owner 2026-10-18: true when the job's Helpr-at-fault ruling has
 * no Helpr any more (their account was deleted: helper_id ON DELETE SET NULL),
 * so the card fee cannot be billed and the refund keeps it. null = unreadable.
 */
async function helprFaultHelprIsGone(supabaseAdmin: any, jobId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from("job_helpr_fault_rulings").select("helper_id").eq("job_id", jobId).maybeSingle();
  if (error || !data) {
    console.error(`[create-payment] reading the Helpr-at-fault ruling of job ${jobId} failed:`, error?.message ?? "no ruling");
    return null;
  }
  return data.helper_id == null;
}

/** Q2082 (b): admin_rule_helpr_fault's refusals, in words for the admin. */
function helprFaultRuleError(code: string): string {
  if (code.includes("not_authorized")) return "Only an admin can rule a Helpr at fault.";
  if (code.includes("helper_not_booked")) return "That Helpr was not booked on this job (no booking and no no-show or backout report here).";
  if (code.includes("already_ruled_other_helper")) return "This job was already ruled against a different Helpr.";
  if (code.includes("job_not_paid")) return "This job was never paid, so there is nothing to refund.";
  if (code.includes("job_not_found")) return "Job not found.";
  if (code.includes("note_required") || code.includes("invalid_kind") || code.includes("helper_required")) return "Helpr at fault needs the Helpr, what happened (no-show or backout) and a note.";
  return "Couldn't record the Helpr-at-fault ruling. Try again.";
}

async function existingRefundCovering(
  stripe: Stripe,
  paymentIntentId: string,
  alreadyRefundedCents: number,
  cents: number,
  source: "admin_refund_dispute" | "admin_refund_general",
  listed?: Stripe.Refund[],
): Promise<Stripe.Refund | null> {
  if (!(cents > 0) || !(alreadyRefundedCents >= cents)) return null;
  const refunds = listed ?? (await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 })).data;
  const mine = (refunds ?? []).filter((r) =>
    (r.status === "succeeded" || r.status === "pending") &&
    r.metadata?.source === source &&
    (source !== "admin_refund_general" || r.metadata?.partial === "false"));
  return mine.find((r) => r.amount === cents) ?? [...mine].sort((a, b) => b.amount - a.amount)[0] ?? null;
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
    if (!error) {
      // Q1261 (6): charge.refunded can reach the row first (both writers
      // upsert with ignoreDuplicates), and it labels every refund
      // 'stripe_dashboard' with no initiator: this call's row then lost who
      // made the refund and why. A row that only the webhook wrote is claimed
      // here; a row another app path wrote keeps its own label. ZERO ROWS IS
      // LEGITIMATE (the zero-row-write rule's named exception): it means the
      // upsert above inserted the row, or another path owns it.
      const { error: relabelErr } = await supabaseAdmin.from("payment_refunds").update({
        source: args.source,
        initiated_by_user_id: args.initiatedByUserId,
        is_partial: args.isPartial ?? false,
        reason: args.reason ?? null,
      }).eq("stripe_refund_id", args.refund.id).eq("source", "stripe_dashboard").select("id");
      if (relabelErr) {
        console.error(`[create-payment] recordRefund — could not relabel the webhook's row for refund ${args.refund.id} (job ${args.jobId}):`, relabelErr.message);
      }
    }
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

/**
 * Q1714: tell the poster their money is back (one in-app notice and one email,
 * _shared/refundNotice.ts) and page when they could not be fully told. The
 * money already moved, so this never throws.
 */
// deno-lint-ignore no-explicit-any
async function announceRefund(supabaseAdmin: any, path: string, input: RefundNoticeInput): Promise<void> {
  const result = await sendRefundNotice(supabaseAdmin, input);
  const problem = refundNoticeProblem(result);
  if (!problem) return;
  console.error(`[create-payment] ${path}: ${input.key}: ${problem}`);
  await postSlackOpsAlert({
    kind: "custom",
    severity: "warning",
    title: "Money went back to a poster who was not fully told",
    message: `${path} ${input.key} (job ${input.jobId ?? "—"}): ${problem}. Tell them by hand.`,
    fields: { path, notice: input.key, status: result.status },
    oncePerDayKey: `refund-notice:${input.key}`,
  });
}
