/**
 * paypal-tip: a poster tips their Helpr through PayPal Checkout (PayPal Plan A;
 * owner 2026-10-23: tips live on day one of PayPal; auto-tip later). Behind the
 * paypal_payments switch (created OFF). The Stripe tip (create-payment action
 * "tip") is untouched: the app calls this function only when the switch is on
 * for the poster.
 *
 * Actions (POST, signed-in member):
 *   create  { jobId, amount, helperId?, tipAttemptId, native? }
 *           -> { url }  PayPal's approve page for tip + processing fee.
 *   capture { orderId }  (PayPal's `token` on the return URL)
 *           -> { state, tipStatus }  captured on return; the webhook does the same.
 *
 * Today's tip rule, kept (create-payment "tip", _shared/tipFees.ts): the Helpr
 * receives 100% of the tip; PayPal's processing cost is added on top for the
 * poster (paypalTipChargeBreakdown). The tip is then owed to the Helpr as a
 * MANUAL payout row in the admin "Pay this Helpr" queue (beside the job's own
 * payout, so the owner pays job + tip with one PayPal Send Money).
 *
 * The same checks as the Stripe tip: $3-$1,000, a completed job, only its
 * poster, a crew member named on a crew job, the ban review, the payout hold,
 * and a Helpr who can be paid (a payable PayPal email, instead of a Stripe
 * account). Server-side only: nothing in the body decides who pays or who is
 * paid, beyond naming which crew member (checked against the roster).
 *
 * Secrets: PAYPAL_ENV (sandbox only in this build), PAYPAL_CLIENT_ID,
 * PAYPAL_CLIENT_SECRET. The secret is never logged.
 */
import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";
import { PublicError, publicErrorMessage } from "../_shared/publicError.ts";
import { buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { loadBanReviewUsers } from "../_shared/banReview.ts";
import { checkPayoutHold, PAYOUT_HELD_CODE } from "../_shared/payoutHold.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { TIP_MAX_CENTS, TIP_MIN_CENTS, paypalTipChargeBreakdown } from "../_shared/tipFees.ts";
import { PayPalClient } from "../_shared/payments/paypalClient.ts";
import { parseProviderEnv, paymentProviderFor } from "../_shared/payments/registry.ts";
import { alertIfTipOwedWithoutDestination, settlePayPalTip, type TipSettleDb, type TipSettleOutcome } from "../_shared/payments/tipSettle.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYER_UNDER_REVIEW = "This payment can't go through right now. Please contact support.";
const HELPR_CANNOT_RECEIVE = "This Helpr hasn't set up where to get paid yet, so they can't receive tips right now.";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** The order key: deterministic per attempt, names the charged amount (assertOrderKeyNamesAmount), within PayPal-Request-Id's length. */
async function tipOrderKey(jobId: string, tipperId: string, helperId: string, tipCents: number, chargeCents: number, attemptId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(`${jobId}|${tipperId}|${helperId}|${tipCents}|${attemptId.toLowerCase()}`)));
  const hex = [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `lh:tip:${hex}:checkout:amt${chargeCents}:a1`;
}

function describeForPoster(outcome: TipSettleOutcome): { state: string; tipStatus: string | null; message?: string } {
  if (outcome.state === "not_approved") return { state: "not_approved", tipStatus: "pending", message: "Your tip wasn't finished on PayPal, so nothing was charged." };
  if (outcome.state === "declined") return { state: "declined", tipStatus: "failed", message: "PayPal declined that payment, so nothing was charged. You can try again with another way to pay." };
  const rec = outcome.record;
  if (rec.tip_status === "paid") return { state: "paid", tipStatus: "paid" };
  if (rec.payment_status === "capture_pending") return { state: "processing", tipStatus: "pending", message: "PayPal is still processing your tip. We'll let your Helpr know once it clears." };
  return { state: rec.payment_status, tipStatus: rec.tip_status };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 10, keyPrefix: "paypal-tip" });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonClient = createClient(supabaseUrl, (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "");
  const admin = createClient(supabaseUrl, (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing authorization header" });
    const { data: auth, error: userErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr) console.error("[paypal-tip] auth.getUser error:", userErr.message);
    const user = auth?.user;
    if (!user?.email) return json(401, { error: "Not authenticated" });
    const unconfirmed = refuseUnconfirmedEmail(user, corsHeaders);
    if (unconfirmed) return unconfirmed;
    const refused = await requireFeature(admin, "paypal_payments", user, corsHeaders);
    if (refused) return refused;

    // A body that is not JSON is answered "Invalid request" just below, never ignored.
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new PublicError("Invalid request");

    let env: "sandbox" | "live";
    let client: PayPalClient;
    try {
      env = parseProviderEnv(Deno.env.get("PAYPAL_ENV"));
      client = new PayPalClient({ env, clientId: Deno.env.get("PAYPAL_CLIENT_ID") ?? "", clientSecret: Deno.env.get("PAYPAL_CLIENT_SECRET") ?? "" });
    } catch (e) {
      console.error(`[paypal-tip] PayPal not configured: ${caughtMessage(e)}`);
      return json(503, { error: "Tips through PayPal aren't available right now. Please try again later." });
    }
    const provider = paymentProviderFor("paypal_checkout", { paypal: { env, clientId: Deno.env.get("PAYPAL_CLIENT_ID") ?? "", clientSecret: Deno.env.get("PAYPAL_CLIENT_SECRET") ?? "" } });

    // ─── CREATE ───
    if (body.action === "create") {
      const jobId = typeof body.jobId === "string" && UUID.test(body.jobId) ? body.jobId : null;
      if (!jobId) throw new PublicError("Missing jobId");
      // Required here (the Stripe path had a time-bucket fallback for old builds; this path has no old builds).
      const attemptId = typeof body.tipAttemptId === "string" && UUID.test(body.tipAttemptId) ? body.tipAttemptId : null;
      if (!attemptId) throw new PublicError("Please reopen the tip and try again.");
      const amount = body.amount;
      if (typeof amount !== "number" || !Number.isFinite(amount)) throw new PublicError("Invalid tip amount");
      const tipCents = Math.round(amount * 100);
      if (tipCents < TIP_MIN_CENTS || tipCents > TIP_MAX_CENTS) {
        throw new PublicError(`Tips must be between $${TIP_MIN_CENTS / 100} and $${(TIP_MAX_CENTS / 100).toLocaleString("en-US")}`);
      }

      const { data: job, error: jobErr } = await admin.from("jobs")
        .select("id, title, status, customer_id, helper_id, is_group_job").eq("id", jobId).maybeSingle();
      if (jobErr) {
        console.error(`[paypal-tip] job read failed for ${jobId}:`, jobErr);
        throw new PublicError("Could not load this job — please try again");
      }
      if (!job) throw new PublicError("Job not found");
      if (job.status !== "completed") throw new PublicError("Job must be completed to tip");
      if (user.id !== job.customer_id) throw new PublicError("Only the person who posted this job can tip the Helpr");

      let helperId: string;
      if (job.is_group_job) {
        const named = body.helperId;
        if (typeof named !== "string" || !UUID.test(named)) throw new PublicError("Choose which Helpr on the crew to tip");
        const { data: slot, error: slotErr } = await admin.from("group_job_helpers").select("id").eq("job_id", jobId).eq("helper_id", named).limit(1);
        if (slotErr) {
          console.error(`[paypal-tip] crew roster read failed for job ${jobId}:`, slotErr);
          throw new PublicError("Could not verify who worked this job — please try again");
        }
        if ((slot?.length ?? 0) === 0) throw new PublicError("That Helpr didn't work this job");
        helperId = named;
      } else {
        if (!job.helper_id) throw new PublicError("No Helpr assigned to this job");
        helperId = job.helper_id;
      }

      const review = await loadBanReviewUsers(admin, [user.id, helperId]);
      if (!review.ok) {
        console.error(`[paypal-tip] ban review read failed: ${review.message}`);
        throw new PublicError("Could not verify this payment — please try again");
      }
      if (review.users.has(user.id)) throw new PublicError(PAYER_UNDER_REVIEW);
      const hold = await checkPayoutHold(admin, helperId);
      if (hold.kind === "error") {
        console.error(`[paypal-tip] payout hold check failed for ${helperId}: ${hold.message}`);
        throw new PublicError("Could not verify the Helpr's payout account — please try again");
      }
      if (hold.kind === "held" || review.users.has(helperId)) {
        return json(409, { error: "This Helpr can't receive tips right now. Please try again later.", code: PAYOUT_HELD_CODE });
      }

      // Where the Helpr is paid (their PayPal email, entered once; phase 2). Without one the tip
      // would be money we hold with nowhere to send it, so no checkout opens.
      const { data: payee, error: payeeErr } = await admin.from("payee_accounts")
        .select("payable, paypal_email").eq("user_id", helperId).eq("provider", "paypal").eq("env", env).maybeSingle();
      if (payeeErr) {
        console.error(`[paypal-tip] payee read failed for ${helperId}:`, payeeErr);
        throw new PublicError("Could not verify the Helpr's payout account — please try again");
      }
      if (!payee?.payable || !payee.paypal_email) return json(400, { error: HELPR_CANNOT_RECEIVE });

      const quote = paypalTipChargeBreakdown(tipCents);
      const key = await tipOrderKey(jobId, user.id, helperId, quote.tipCents, quote.chargeCents, attemptId);
      const isNative = isNativeRequest(body);
      const order = await provider.createCheckout({
        idempotencyKey: key,
        referenceId: `tip:${jobId}`,
        amountCents: quote.chargeCents,
        description: `Tip for "${String(job.title ?? "your job")}" ($${(quote.tipCents / 100).toFixed(2)} + $${(quote.feeCents / 100).toFixed(2)} PayPal processing)`,
        returnUrl: buildRedirectUrl(`/posts?tip=paypal`, isNative),
        cancelUrl: buildRedirectUrl(`/posts`, isNative),
      });
      if (!order.approveUrl) {
        console.error(`[paypal-tip] order ${order.providerOrderId} came back ${order.status} with no approve link`);
        throw new PublicError("Couldn't start PayPal. Please try again.");
      }
      const { error: openErr } = await admin.rpc("paypal_open_tip", {
        p_job_id: jobId, p_tipper_id: user.id, p_helper_id: helperId,
        p_tip_cents: quote.tipCents, p_charge_cents: quote.chargeCents,
        p_env: env, p_idempotency_key: key, p_order_id: order.providerOrderId,
      });
      if (openErr) {
        // No row = no record of this order: never send the poster to pay it.
        console.error(`[paypal-tip] paypal_open_tip failed for order ${order.providerOrderId} (job ${jobId}): ${openErr.message}`);
        throw new PublicError("Could not record the tip — please try again");
      }
      return json(200, { url: order.approveUrl });
    }

    // ─── CAPTURE (the poster is back from PayPal) ───
    if (body.action === "capture") {
      const orderId = typeof body.orderId === "string" && /^[A-Z0-9]{5,40}$/.test(body.orderId) ? body.orderId : null;
      if (!orderId) throw new PublicError("Missing PayPal order");
      const { data: pay, error: payErr } = await admin.from("provider_payments")
        .select("id, subject_kind, payer_id").eq("provider_order_id", orderId).maybeSingle();
      if (payErr) {
        console.error(`[paypal-tip] payment read failed for order ${orderId}:`, payErr);
        throw new PublicError("Could not check your tip — please refresh in a moment");
      }
      // Only the payer finishes their own tip from the return page (the webhook needs no caller).
      if (!pay || pay.subject_kind !== "tip" || pay.payer_id !== user.id) return json(404, { error: "We couldn't find that tip." });

      const outcome = await settlePayPalTip(admin as unknown as TipSettleDb, provider, client, pay.id);
      await alertIfTipOwedWithoutDestination(outcome);
      return json(200, describeForPoster(outcome));
    }

    throw new PublicError("Unknown action");
  } catch (err) {
    const message = publicErrorMessage(err, "Something went wrong with your tip — please try again.");
    if (!(err instanceof PublicError)) console.error(`[paypal-tip] ${caughtMessage(err)}`);
    return json(err instanceof PublicError ? 400 : 500, { error: message });
  }
});
