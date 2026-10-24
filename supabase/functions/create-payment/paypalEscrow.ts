/**
 * create-payment's PayPal path (PayPal Plan A, phase 3; design §6 row 3).
 *
 * ROUTING (index.ts): `escrow` goes here when the paypal_payments switch is on
 * for the caller (featureEnabledForUser, fail closed: a read error is OFF and
 * the request takes the Stripe path, unchanged). `paypal_capture` (the return
 * page) is PayPal-only and answers 403 when the switch is off.
 *
 *   escrow          the same pre-checks the Stripe path makes (who pays, a
 *                   closed or decided job, the payment state, the price caps, an
 *                   agreed quote's price), the fee stamp, the tax line, then a
 *                   PayPal order (openJobCheckout) and its approve link as `url`.
 *   paypal_capture  the poster is back from PayPal: capture the approved order
 *                   (settleJobPayment re-reads it from PayPal) and say where it
 *                   stands. The webhook does the same; both make one capture.
 *
 * Not on PayPal yet (refused with a plain sentence, never charged another way):
 * gift cards (Stripe-era stored value, phase 9), Pay in 4, repeating jobs
 * (later visits need a saved card, phase 6), the jobs_poster_fee model, and a
 * taxable category until a tax rate source is chosen (_shared/jobSalesTax.ts).
 *
 * Fees (lead 2026-10-23, from pp-phase5): the Helpr pays 8% + $0.70 on a
 * PayPal job. A job that already carries a Helpr fee stamp keeps it; otherwise
 * it is stamped 8/70. The poster pays the job price (plus the one-time setup
 * fee on a first job, as today), no service fee.
 */
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { PublicError } from "../_shared/publicError.ts";
import { featureEnabledForUser, requireFeature } from "../_shared/featureSwitch.ts";
import { loadBanReviewUsers } from "../_shared/banReview.ts";
import { escrowCancelQuoteRequestId, refuseQuoteJobPriceMismatch } from "../_shared/jobEscrowGuards.ts";
import { jobBudgetOutOfRange, urgentFeeOverCap, MAX_JOB_BUDGET_DOLLARS, MIN_JOB_BUDGET_DOLLARS, MAX_URGENT_FEE_DOLLARS } from "../_shared/jobBudgetLimits.ts";
import { feeQuoteRefusal } from "../_shared/jobCheckout.ts";
import { flatFeePercentOf, helprFlatFeeCents, isFlatFeeJob, PAYPAL_HELPR_FEE_CENTS, PAYPAL_HELPR_FEE_PERCENT, type FeeModelStamp } from "../_shared/helprFlatFee.ts";
import { allocateCents } from "../_shared/crewShares.ts";
import { POSTER_SERVICE_FEE_PERCENT } from "../_shared/posterFees.ts";
import { PAYPAL_TAXABLE_CATEGORY_MESSAGE, payPalJobSalesTax } from "../_shared/jobSalesTax.ts";
import { buildRedirectUrl } from "../_shared/appUrl.ts";
import { paymentProviderFor, parseProviderEnv } from "../_shared/payments/registry.ts";
import { ProviderApiError } from "../_shared/payments/types.ts";
import {
  currentJobPayment,
  openJobCheckout,
  settleJobPayment,
  type JobCheckoutCtx,
  type JobOrderBreakdown,
  type JobPaymentRow,
} from "../_shared/payments/paypalJobCheckout.ts";
import { followUpJobSettle } from "../_shared/payments/jobSettleFollowUp.ts";
import { cancellationFeePercent, computeCancellationFee, helperIsCommitted, hoursUntilJob } from "../_shared/cancellationFee.ts";
import { posterCancelSplit } from "../_shared/posterCancelSplit.ts";
import { refundsSeriesVisitInFull } from "../_shared/seriesRefund.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";

const PAYPAL_SWITCH = "paypal_payments";

// deno-lint-ignore no-explicit-any
type Db = any;

interface Args {
  db: Db;
  user: { id: string; email?: string };
  // deno-lint-ignore no-explicit-any
  body: any;
  isNative: boolean;
  corsHeaders: Record<string, string>;
}

const FUNDING_CLOSED = new Set(["completed", "cancelled"]);
const RE_MINTABLE = new Set(["unpaid", "abandoned", "failed"]);
const PROCESSING = "A payment for this job is still being processed. Give it a moment and refresh before trying again.";
const UNAVAILABLE = "Payments are temporarily unavailable. Please try again in a few minutes.";

/** Whether this caller pays through PayPal. Fail closed: a switch read error is off. */
export async function payPalPaymentsOn(db: Db, user: { id: string }): Promise<boolean> {
  return await featureEnabledForUser(db, PAYPAL_SWITCH, user);
}

function json(body: Record<string, unknown>, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { headers: { ...cors, "Content-Type": "application/json" }, status });
}

/** The PayPal side of the job-checkout state machine, or null when PayPal is not configured. */
function checkoutCtx(db: Db): JobCheckoutCtx | null {
  try {
    const env = parseProviderEnv(Deno.env.get("PAYPAL_ENV"));
    const provider = paymentProviderFor("paypal_checkout", {
      paypal: { env, clientId: Deno.env.get("PAYPAL_CLIENT_ID") ?? "", clientSecret: Deno.env.get("PAYPAL_CLIENT_SECRET") ?? "" },
    });
    return { db, provider, env };
  } catch (e) {
    // Unset or invalid PAYPAL_* secrets, or live keys in a sandbox-only build: no money moves.
    console.error(`[create-payment] PayPal not configured: ${caughtMessage(e)}`);
    return null;
  }
}

/** One Helpr fee per crew member, on that member's share of budget + bonus, from the job's stamp. */
function crewFlatFeeCents(budgetCents: number, urgentCents: number, helprs: number, stamp: FeeModelStamp): number {
  const k = Math.max(1, Math.floor(helprs || 1));
  let total = 0;
  for (let i = 0; i < k; i++) {
    total += helprFlatFeeCents(allocateCents(budgetCents, k, i) + allocateCents(urgentCents, k, i), stamp);
  }
  return total;
}

export async function handlePayPalEscrow({ db, user, body, isNative, corsHeaders }: Args): Promise<Response> {
  const { jobId, giftCardId } = body ?? {};
  if (!jobId || typeof jobId !== "string") throw new PublicError("Missing jobId");

  const { data: job, error: jobError } = await db.from("jobs").select("*").eq("id", jobId).single();
  if (jobError || !job) throw new PublicError("Job not found");
  if (job.customer_id !== user.id) throw new PublicError("Not authorized");
  const review = await loadBanReviewUsers(db, [user.id]);
  if (!review.ok) throw new Error(`ban review read failed: ${review.message}`);
  if (review.users.has(user.id)) throw new PublicError("This payment can't go through right now. Please contact support.");

  if (FUNDING_CLOSED.has(String(job.status))) throw new PublicError("This job is closed, so it can no longer be paid for.");
  const { data: decided, error: decidedErr } = await db.from("disputes").select("id").eq("job_id", jobId).eq("status", "decided").limit(1);
  if (decidedErr) {
    console.error(`[create-payment] decided-dispute read failed for job ${jobId}; refusing PayPal escrow:`, decidedErr);
    throw new PublicError("Could not check this job's dispute status. Please try again in a moment.");
  }
  if (decided && decided.length > 0) throw new PublicError("This job's dispute has been decided, so it can no longer be paid for.");
  if (!RE_MINTABLE.has(job.payment_status ?? "unpaid")) {
    throw new PublicError("This job's payment has already been processed. Open the job to see its payment status.");
  }
  // A Stripe-era payment on the row may still hold money at Stripe: never take a second payment over it.
  if (job.stripe_payment_intent_id) {
    console.error(`[create-payment] job ${jobId} carries Stripe payment ${job.stripe_payment_intent_id}; refusing a PayPal payment over it`);
    throw new PublicError("This job has a payment with our previous payment processor. Contact support and we'll sort it out.");
  }

  if (jobBudgetOutOfRange(job.budget)) {
    throw new PublicError(
      `Job budgets run from $${MIN_JOB_BUDGET_DOLLARS.toLocaleString("en-US")} to $${MAX_JOB_BUDGET_DOLLARS.toLocaleString("en-US")}. Edit the budget, or split a bigger project into separate jobs.`,
    );
  }
  if (urgentFeeOverCap(job.is_urgent, job.urgent_fee)) {
    throw new PublicError(`The urgent bonus can be at most $${MAX_URGENT_FEE_DOLLARS.toLocaleString("en-US")}. Post the job again with a smaller bonus.`);
  }

  // Not on PayPal yet: refused, never charged another way.
  if (giftCardId) throw new PublicError("Gift cards can't be used with PayPal yet. Pay with PayPal instead.");
  const payInFour = body?.payInFour === true || (typeof body?.feeQuote === "object" && body?.feeQuote !== null && body.feeQuote.payInFour === true);
  if (payInFour) throw new PublicError("Pay in 4 isn't available with PayPal. Pay with PayPal instead.");
  if (job.recurrence_days != null) throw new PublicError("Repeating jobs can't be paid with PayPal yet.");

  // Server-authoritative urgent bonus: the stored fee, never below the $5 floor (as the Stripe path).
  const URGENT_FEE_FLOOR_CENTS = 500;
  const urgentCents = job.is_urgent
    ? Math.min(Math.max(Math.round(Number(job.urgent_fee ?? 0) * 100), URGENT_FEE_FLOOR_CENTS), MAX_URGENT_FEE_DOLLARS * 100)
    : 0;
  const budgetCents = Math.round(Number(job.budget) * 100);
  const jobPriceCents = budgetCents + urgentCents;
  // The app's quote (when sent) must be the flat model at this price: a client on the poster-fee
  // model is refused, never charged a total it did not show.
  const quoteRefusal = feeQuoteRefusal(body?.feeQuote, { model: "flat", payInFour: false, jobPriceCents });
  if (quoteRefusal) throw new PublicError(quoteRefusal);

  await refuseQuoteJobPriceMismatch(db, jobId, job.budget);
  const cancelQuoteRequestId = escrowCancelQuoteRequestId(body.returnPath);

  const tax = payPalJobSalesTax(job.category, budgetCents);
  if (!tax.ok) throw new PublicError(PAYPAL_TAXABLE_CATEGORY_MESSAGE);

  const ctx = checkoutCtx(db);
  if (!ctx) throw new PublicError(UNAVAILABLE);

  // ─── Fee stamp (lead 2026-10-23): keep the Helpr stamp the job carries, else 8% + 70c ───
  // A poster-fee stamp (the Stripe-era jobs_poster_fee model) is never kept: the PayPal path
  // does not use that model. Pinned to the price and unfunded state read above; zero rows
  // means the job moved, and nothing is charged.
  const keepStamp = isFlatFeeJob(job) && job.poster_fee_flat_cents == null;
  // The job's own stamp as it is stored (helprFlatFeeCents reads it the way every payout path does:
  // a NULL percent is the model default, never 0).
  const stamp: FeeModelStamp = keepStamp
    ? { helper_fee_flat_cents: job.helper_fee_flat_cents, helper_fee_percent: job.helper_fee_percent }
    : { helper_fee_flat_cents: PAYPAL_HELPR_FEE_CENTS, helper_fee_percent: PAYPAL_HELPR_FEE_PERCENT };
  const helprs = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const flatFeeCents = crewFlatFeeCents(budgetCents, urgentCents, helprs, stamp);
  {
    let q = db.from("jobs").update({
      ...(keepStamp ? {} : stamp),
      // Pinned to every fact the fee was priced from (status, price, crew size, the bonus switch).
      ...(job.poster_fee_flat_cents != null ? { poster_fee_flat_cents: null } : {}),
      platform_fee_percent: POSTER_SERVICE_FEE_PERCENT,
      customer_fee_amount: 0,
      platform_fee_amount: flatFeeCents / 100,
    }).eq("id", jobId).eq("status", job.status).eq("budget", job.budget)
      .or("payment_status.is.null,payment_status.in.(unpaid,abandoned,failed)")
      .is("stripe_payment_intent_id", null);
    q = job.urgent_fee == null || Number(job.urgent_fee) === 0 ? q.or("urgent_fee.is.null,urgent_fee.eq.0") : q.eq("urgent_fee", job.urgent_fee);
    q = job.category == null ? q.is("category", null) : q.eq("category", job.category);
    q = job.is_urgent == null ? q.is("is_urgent", null) : q.eq("is_urgent", job.is_urgent);
    q = job.helpers_needed == null ? q.is("helpers_needed", null) : q.eq("helpers_needed", job.helpers_needed);
    q = job.is_group_job == null ? q.is("is_group_job", null) : q.eq("is_group_job", job.is_group_job);
    const { data: stamped, error: stampErr } = await q.select("id");
    if (stampErr) {
      console.error(`[create-payment] PayPal fee stamp failed for job ${jobId}:`, stampErr);
      throw new PublicError("Pricing configuration is temporarily unavailable — please try again in a moment");
    }
    if (!stamped || stamped.length === 0) throw new PublicError("This job changed while checkout was opening. Please try again.");
  }

  // The one-time setup fee on a poster's first job, exactly as the Stripe path charges it.
  const { data: settings, error: settingsErr } = await db.from("platform_settings").select("onboarding_fee_cents").limit(1).single();
  if (settingsErr || settings?.onboarding_fee_cents == null) {
    console.error("[create-payment] platform_settings read failed — refusing to price a PayPal escrow:", settingsErr);
    throw new PublicError("Pricing configuration is temporarily unavailable — please try again in a moment");
  }
  const { data: posterProfile, error: profileErr } = await db.from("profiles").select("onboarding_fee_paid").eq("user_id", user.id).single();
  // Only charged when it is PROVABLY unpaid (a read failure never re-charges it).
  if (profileErr) console.error("[create-payment] poster profile read failed — skipping the setup fee:", profileErr);
  const onboardingFeeCents = posterProfile && !posterProfile.onboarding_fee_paid && Number(settings.onboarding_fee_cents) > 0
    ? Number(settings.onboarding_fee_cents)
    : 0;

  const breakdown: JobOrderBreakdown = {
    budget: Number(job.budget),
    urgent_fee: Number(job.urgent_fee ?? 0),
    is_urgent: Boolean(job.is_urgent),
    category: job.category ?? null,
    helpers_needed: job.helpers_needed ?? null,
    recurrence_days: null,
    job_price_cents: jobPriceCents,
    onboarding_fee_cents: onboardingFeeCents,
    item_cents: jobPriceCents + onboardingFeeCents,
    tax_cents: tax.taxCents,
    taxable_base_cents: tax.taxableBaseCents,
    helper_fee_percent: keepStamp ? (flatFeePercentOf(job) ?? PAYPAL_HELPR_FEE_PERCENT) : PAYPAL_HELPR_FEE_PERCENT,
    helper_fee_flat_cents: Number(stamp.helper_fee_flat_cents),
  };

  let result;
  try {
    result = await openJobCheckout(ctx, {
      jobId,
      payerId: user.id,
      breakdown,
      description: `Helpr Job: ${String(job.title ?? "").slice(0, 100)}`,
      returnUrl: buildRedirectUrl(`/payment-success?job_id=${jobId}&provider=paypal`, isNative),
      cancelUrl: cancelQuoteRequestId === null
        ? buildRedirectUrl(`/post-job`, isNative)
        : buildRedirectUrl(`/quotes/request/${cancelQuoteRequestId}`, isNative),
    });
  } catch (e) {
    const msg = caughtMessage(e);
    console.error(`[create-payment] PayPal checkout failed for job ${jobId}: ${msg}`);
    if (/price_changed/.test(msg)) throw new PublicError("This job's pay changed while checkout was opening. Please try again so you pay the new amount.");
    if (/job_already_paid/.test(msg)) throw new PublicError("This job's payment has already been processed. Open the job to see its payment status.");
    if (/job_closed/.test(msg)) throw new PublicError("This job is closed, so it can no longer be paid for.");
    if (/feature_disabled/.test(msg)) throw new PublicError(UNAVAILABLE);
    throw new PublicError("We couldn't open the payment page just now. Please try again.");
  }
  // Any capture this request made on an order the poster had already approved is followed up
  // like the return page's and the webhook's: the fan-out on a fresh funding, an alert on money at risk.
  for (const s of result.settled) await followUpJobSettle(db, jobId, s, "checkout", postSlackOpsAlert);
  if (result.kind === "processing") console.warn(`[create-payment] PayPal escrow for job ${jobId}: ${result.why}`);
  if (result.kind === "redirect") return json({ url: result.approveUrl, provider: "paypal" }, 200, corsHeaders);
  if (result.kind === "funded") return json({ url: buildRedirectUrl(`/payment-success?job_id=${jobId}`, isNative), provider: "paypal" }, 200, corsHeaders);
  throw new PublicError(PROCESSING);
}

/** What the return page is told. Only `funded` lets it say the money is held. */
type CaptureStatus = "funded" | "processing" | "not_approved" | "declined" | "replaced" | "none";

export async function handlePayPalCapture({ db, user, body, corsHeaders }: Args): Promise<Response> {
  const refused = await requireFeature(db, PAYPAL_SWITCH, user, corsHeaders);
  if (refused) return refused;
  const { jobId } = body ?? {};
  if (!jobId || typeof jobId !== "string") throw new PublicError("Missing jobId");
  const { data: job, error: jobError } = await db.from("jobs").select("id, customer_id").eq("id", jobId).maybeSingle();
  if (jobError) throw new Error(`job read failed: ${jobError.message}`);
  // The same answer for "not yours" and "no such job": no oracle.
  if (!job || job.customer_id !== user.id) throw new PublicError("Not authorized");

  const ctx = checkoutCtx(db);
  if (!ctx) throw new PublicError(UNAVAILABLE);
  const row = await currentJobPayment(ctx, jobId);
  if (!row) return json({ status: "none" satisfies CaptureStatus }, 200, corsHeaders);
  let outcome;
  try {
    outcome = await settleJobPayment(ctx, row);
  } catch (e) {
    // PayPal busy with the same capture (409 PREVIOUS_REQUEST_IN_PROGRESS: the webhook got there first,
    // measured on sandbox 2026-10-23), a 5xx, or a transport failure: the claim stands and the webhook
    // finishes it. The page keeps reading payment_status, so it says only what is true.
    if (e instanceof ProviderApiError && (e.retryable || e.issue === "PREVIOUS_REQUEST_IN_PROGRESS")) {
      console.warn(`[create-payment] paypal_capture for job ${jobId}: PayPal answered ${e.httpStatus} ${e.issue ?? ""}; the webhook will finish it`);
      return json({ status: "processing" satisfies CaptureStatus }, 200, corsHeaders);
    }
    throw e;
  }
  await followUpJobSettle(db, jobId, outcome, "return_page", postSlackOpsAlert);
  // "replaced" only when the poster must pay again because the job changed under the order; any
  // other retirement (already paid another way, closed) is left to the payment_status read.
  const status: CaptureStatus =
    outcome.kind === "funded" ? "funded"
    : outcome.kind === "not_approved" ? "not_approved"
    : outcome.kind === "declined" ? "declined"
    : outcome.kind === "retired" && (outcome.reason === "price_changed" || outcome.reason === "setup_fee_already_paid") ? "replaced"
    : "processing";
  return json({ status }, 200, corsHeaders);
}

/**
 * The Stripe-era actions (release, refunds, cancel, tip, a Stripe escrow after a switch-read
 * error...) know nothing about PayPal money. Until phases 4 and 5 route them for PayPal jobs,
 * any of them on a job with a live PayPal payment (an order open, being captured, or captured)
 * is refused before it runs: a cancel would otherwise mark a paid job cancelled and refund
 * nothing, and a Stripe checkout could charge a job PayPal is capturing (lh-money-escrow #6,
 * lh-silent-failure #7). null = no PayPal payment on the job: the action goes on unchanged.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The poster, the hired Helpr, a crew member, or (for an admin_* action) an admin. Fail closed on a read error. */
async function mayAskAboutJob(db: Db, user: { id: string }, action: unknown, jobId: string): Promise<boolean> {
  const { data: job, error } = await db.from("jobs").select("customer_id, helper_id").eq("id", jobId).maybeSingle();
  if (error || !job) return false;
  if (job.customer_id === user.id || job.helper_id === user.id) return true;
  const { data: crew, error: crewErr } = await db.from("group_job_helpers").select("helper_id").eq("job_id", jobId).eq("helper_id", user.id).limit(1);
  if (!crewErr && Array.isArray(crew) && crew.length > 0) return true;
  if (typeof action === "string" && action.startsWith("admin_")) {
    const { data: roles, error: roleErr } = await db.from("user_roles").select("user_id").eq("user_id", user.id).eq("role", "admin");
    return !roleErr && Array.isArray(roles) && roles.length > 0;
  }
  return false;
}

export async function refuseStripeActionOnPayPalJob(
  db: Db,
  user: { id: string },
  action: unknown,
  jobId: unknown,
  corsHeaders: Record<string, string>,
  quote?: (row: JobPaymentRow) => Promise<Response>,
): Promise<Response | null> {
  // Not a uuid: no job, so no PayPal payment; the action answers it as it always has.
  if (typeof jobId !== "string" || !UUID_RE.test(jobId)) return null;
  const { data, error } = await db.rpc("paypal_job_payment_state", { p_job_id: jobId });
  if (error) {
    // Before the phase-3 migration is live the function is missing: then no PayPal payment can exist.
    if ((error as { code?: string }).code === "PGRST202") return null;
    console.error(`[create-payment] PayPal state read failed for job ${jobId} (${String(action)}); refusing: ${error.message}`);
    return json({ error: "We couldn't check this job's payment just now. Please try again in a moment." }, 503, corsHeaders);
  }
  const state = data as { current?: JobPaymentRow | null; captured_any?: boolean } | null;
  const current = state?.current ?? null;
  if (!current && state?.captured_any !== true) return null;
  // Only a party to the job (poster, hired Helpr, crew) or an admin learns that its payment is
  // PayPal's: anyone else gets the actions' own "Not authorized", so no member can probe which
  // jobs (while the switch is at testers: which posters) pay through PayPal (lh-authz-rls re-review A).
  if (!(await mayAskAboutJob(db, user, action, jobId))) throw new PublicError("Not authorized");
  // The cancel QUOTE reads money and moves none: answered from the PayPal payment itself.
  if (action === "cancel_quote" && quote && current) return await quote(current);
  console.warn(`[create-payment] ${String(action)} refused on job ${jobId}: it has a PayPal payment (${current?.status ?? "a recorded capture"})`);
  return json({ error: "This job's payment is through PayPal, and this isn't available for it yet. Contact support and we'll handle it." }, 409, corsHeaders);
}

/**
 * create-payment `cancel_quote` for a job paid through PayPal (phase 6 ask, lead 2026-10-23):
 * what a poster cancel would keep and give back, by the SAME ladder and split the Stripe quote
 * uses (computeCancellationFee, posterCancelSplit) on the PayPal capture: the captured amount,
 * PayPal's own fee on it (PayPal keeps its fee on a refund), refunds already made and the tax
 * the order carried. Same answer shape as the Stripe quote; any fact it cannot read is
 * "unquoted" (no number), never a guess. Moves no money.
 */
export async function handlePayPalCancelQuote(
  { db, user, body, corsHeaders }: Args,
  row: JobPaymentRow,
): Promise<Response> {
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  const nowIso = new Date().toISOString();
  const { data: job, error: jobErr } = await db.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (jobErr) {
    console.error(`[create-payment] PayPal cancel_quote job read failed for ${jobId}: ${jobErr.message}`);
    return json({ error: "Couldn't work out the refund right now. Try again." }, 503, corsHeaders);
  }
  // Only the poster: anyone else is told nothing about the job (no oracle), as the Stripe quote.
  if (!job || job.customer_id !== user.id) return json({ error: "Job not found" }, 404, corsHeaders);
  if (!["open", "accepted", "in_progress", "revision_requested"].includes(String(job.status)) || job.helper_completed_at) {
    return json({ can_cancel: false, quoted_at: nowIso }, 200, corsHeaders);
  }
  let feePercent: number | null = null;
  const unquoted = (reason: string, feeCents: number | null) =>
    json({ can_cancel: true, fee_cents: feeCents, fee_percent: feePercent, back_to_you_cents: null, unquoted_reason: reason, charge_state: null, quoted_at: nowIso }, 200, corsHeaders);
  if (job.is_group_job) return unquoted("crew", null);
  const feeCents = Math.round(computeCancellationFee({ ...job, cancelled_at: nowIso }) * 100);
  feePercent = feeCents > 0 && job.date_needed
    ? cancellationFeePercent(helperIsCommitted(job), hoursUntilJob(job.date_needed, nowIso, job.start_time ?? null))
    : 0;
  if (job.payment_status !== "escrow" || !["captured", "partially_refunded"].includes(row.status)) return unquoted("not_in_escrow", feeCents);
  const paypalFeeCents = Number((row.breakdown as Record<string, unknown> | null)?.paypal_fee_cents);
  if (!Number.isInteger(paypalFeeCents) || paypalFeeCents < 0) return unquoted("unreadable", feeCents);
  const { data: refunds, error: refundErr } = await db.from("provider_refunds")
    .select("amount_cents, status").eq("provider_payment_id", row.id);
  if (refundErr) return unquoted("unreadable", feeCents);
  const alreadyRefundedCents = ((refunds ?? []) as Array<{ amount_cents: number; status: string }>)
    .filter((r) => r.status !== "failed" && r.status !== "cancelled")
    .reduce((sum, r) => sum + Number(r.amount_cents), 0);
  if (alreadyRefundedCents > 0) return unquoted("earlier_refund", feeCents);
  const owedFeeCents = refundsSeriesVisitInFull(job) ? 0 : feeCents;
  const split = posterCancelSplit({
    // sellerFault: a Declutter setup job is never paid through PayPal (Declutter stays on Stripe, phase 9).
    job, sellerFault: false, cancellationFeeCents: owedFeeCents, blockFeeCents: 0,
    charge: {
      state: "captured",
      capturedCents: Number(row.amount_cents),
      actualFeeCents: paypalFeeCents,
      alreadyRefundedCents,
      taxCents: Number((row.breakdown as Record<string, unknown> | null)?.tax_cents ?? 0),
    },
  });
  if (split.state !== "captured" || !split.feesFitCard) return unquoted("fees_exceed_payment", feeCents);
  return json({ can_cancel: true, fee_cents: feeCents, fee_percent: feePercent, back_to_you_cents: split.backCents, unquoted_reason: null, charge_state: "captured", quoted_at: nowIso }, 200, corsHeaders);
}

