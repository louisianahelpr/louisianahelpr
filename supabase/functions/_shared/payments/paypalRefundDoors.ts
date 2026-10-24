/**
 * create-payment's refund doors, for a job paid through PayPal (PayPal Plan A, phase 5).
 *
 * create-payment's refund actions are Stripe code: to them a PayPal job has no PaymentIntent and
 * reads as "nothing was paid" (cancel_escrow would cancel it and refund nothing). So, before any
 * Stripe call, create-payment asks this module about a PayPal-funded job:
 *   admin_refund_general  -> the PayPal refund engine (paypalJobRefunds.adminRefundPayPalJob), so
 *                            the admin screen works unchanged (it now sends a requestId).
 *   cancel_escrow, cancel_quote, admin_refund_dispute, admin_bill_helpr_fault
 *                         -> refused, nothing moved, with where it goes instead.
 * Any other action, a job id that is not a uuid, or a job with no PayPal payment: null (the
 * Stripe path runs exactly as before). A failed read refuses (fails closed).
 */
import { writeAdminAudit } from "../adminAuditLog.ts";
import { requireFeature } from "../featureSwitch.ts";
import { postSlackOpsAlert } from "../slack-alerts.ts";
import { PayPalClient } from "./paypalClient.ts";
import { adminRefundPayPalJob, readPayPalJobPayment } from "./paypalJobRefunds.ts";
import { paymentProviderFor, parseProviderEnv } from "./registry.ts";

export const PAYPAL_GUARDED_REFUND_ACTIONS = [
  "admin_refund_general",
  "cancel_escrow",
  "cancel_quote",
  "admin_refund_dispute",
  "admin_bill_helpr_fault",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFUSAL: Record<string, string> = {
  cancel_escrow: "This job was paid with PayPal. Cancel it with Cancel job: the refund follows through PayPal. No money was moved.",
  cancel_quote: "This job was paid with PayPal, so its quote is cancelled with Cancel job. No money was moved.",
  admin_refund_dispute: "This job was paid with PayPal. PayPal dispute settlement is not built yet (PayPal phase 7); settle it by hand. No money was moved.",
  admin_bill_helpr_fault: "This job was paid with PayPal. Helpr-at-fault billing on PayPal is not built yet (PayPal phase 7). No money was moved.",
};

/** PayPal client + Checkout provider from the PAYPAL_* secrets (sandbox only in this build). */
export function payPalFromEnv(): { client: PayPalClient; provider: ReturnType<typeof paymentProviderFor> } {
  const env = parseProviderEnv(Deno.env.get("PAYPAL_ENV"));
  const cfg = { env, clientId: Deno.env.get("PAYPAL_CLIENT_ID") ?? "", clientSecret: Deno.env.get("PAYPAL_CLIENT_SECRET") ?? "" };
  return { client: new PayPalClient(cfg), provider: paymentProviderFor("paypal_checkout", { paypal: cfg }) };
}

export async function payPalRefundDoorFor(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  user: { id: string },
  action: unknown,
  // deno-lint-ignore no-explicit-any
  body: any,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (typeof action !== "string" || !(PAYPAL_GUARDED_REFUND_ACTIONS as readonly string[]).includes(action)) return null;
  const jobId = typeof body?.jobId === "string" ? body.jobId : null;
  if (!jobId || !UUID_RE.test(jobId)) return null;
  const answer = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const found = await readPayPalJobPayment(supabaseAdmin, jobId);
  if (found.error) {
    console.error(`[create-payment] ${action}: PayPal payment read failed for job ${jobId}: ${found.error}`);
    return answer(503, { error: "Couldn't check how this job was paid. No money was moved; try again." });
  }
  if (!found.payment) return null;

  if (action !== "admin_refund_general") {
    return answer(409, { error: REFUSAL[action], paypal: true, ...(action === "cancel_escrow" ? { useCancelJob: true } : {}) });
  }
  const { data: isAdmin, error: roleErr } = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (roleErr) return answer(503, { error: "Couldn't check your admin role. No money was moved." });
  if (!isAdmin) return answer(403, { error: "Not authorized — admin only" });
  const gated = await requireFeature(supabaseAdmin, "paypal_payments", user, corsHeaders);
  if (gated) return gated;
  if (body?.helprFault != null) {
    return answer(409, { error: "Helpr-at-fault refunds on a PayPal job are not built yet (PayPal phase 7). No money was moved." });
  }
  let pp;
  try {
    pp = payPalFromEnv();
  } catch (e) {
    return answer(503, { error: `PayPal is not configured (${e instanceof Error ? e.message : String(e)}). No money was moved.` });
  }
  const res = await adminRefundPayPalJob(
    { db: supabaseAdmin, provider: pp.provider, client: pp.client, alert: postSlackOpsAlert as never },
    {
      adminId: user.id,
      jobId,
      amountCents: typeof body?.amountCents === "number" ? body.amountCents : null,
      requestId: typeof body?.requestId === "string" ? body.requestId : "",
      reason: typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "admin refund",
    },
  );
  if (res.status === 200 || res.body.recordedLate === true) {
    // Q76: the money moving, by this admin. Non-fatal (the refund is done), never silent.
    await writeAdminAudit(supabaseAdmin, {
      adminId: user.id,
      action: "paypal_admin_refund",
      targetType: "job",
      targetId: jobId,
      details: { ...res.body, reason: typeof body?.reason === "string" ? body.reason : null, request_id: body?.requestId ?? null },
      source: "create-payment",
    }, postSlackOpsAlert);
  }
  return answer(res.status, res.body);
}
