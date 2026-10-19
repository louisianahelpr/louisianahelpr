// HOMES in-app bank rent (20261019103751; owner D2/D9). DRAFT pending lh-money-escrow. Every step is a
// service RPC that is idempotent in SQL; any failure THROWS so stripe-webhook rolls back its dedupe row and
// Stripe redelivers.
//   checkout.session.completed (metadata.kind = "rent_bank_payment")  -> processing (an ACH debit takes days)
//   payment_intent.succeeded                                           -> succeeded: the rent record gets a
//                                                                         confirmed payment, the landlord's
//                                                                         transfer is queued (D9)
//   payment_intent.payment_failed                                      -> failed (nothing was recorded)
//   checkout.session.expired                                           -> expired
//   charge.dispute.created (an ACH return after success)               -> returned: the payment is reversed
//                                                                         and the transfer pulled back (D9)
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

const KIND = "rent_bank_payment";
const AUTOPAY_KIND = "rent_bank_autopay";

function meta(o: { metadata?: unknown } | null | undefined): Record<string, string> {
  return ((o?.metadata ?? {}) as Record<string, string>);
}

/** True for a Checkout Session or PaymentIntent rent-bank-checkout created. */
export function isRentBank(o: { metadata?: unknown } | null | undefined): boolean {
  return meta(o).kind === KIND;
}

/** True for the SETUP-mode page rent-bank-autopay opens (the tenant saves the bank autopay charges). */
export function isRentBankAutopay(o: { metadata?: unknown } | null | undefined): boolean {
  return meta(o).kind === AUTOPAY_KIND;
}

export async function saveRentBankAutopay(event: Stripe.Event, session: Stripe.Checkout.Session, { stripe, supabase, logStep }: Pick<WebhookContext, "stripe" | "supabase" | "logStep">): Promise<void> {
  const m = meta(session);
  if (session.mode !== "setup" || !m.tenancy_id || !m.payer_id || session.client_reference_id !== m.tenancy_id) {
    logStep("Rent autopay session ignored (shape)", { id: session.id });
    return;
  }
  const siId = typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!siId) throw new Error(`rent autopay session ${session.id} has no setup_intent`);
  const si = await stripe.setupIntents.retrieve(siId, { expand: ["payment_method"] });
  if (si.status !== "succeeded") {
    logStep("Rent autopay setup not succeeded", { id: si.id, status: si.status });
    return;
  }
  const pm = si.payment_method as Stripe.PaymentMethod | string | null;
  const pmId = typeof pm === "string" ? pm : pm?.id;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!pmId || !customer) throw new Error(`rent autopay setup ${si.id} is missing its bank`);
  const bank = typeof pm === "object" && pm ? pm.us_bank_account : null;
  const label = bank ? `${bank.bank_name ?? "Bank"} ending ${bank.last4 ?? ""}`.trim() : "Bank";
  const { error } = await supabase.rpc("rentals_autopay_saved", {
    p_tenancy_id: m.tenancy_id, p_tenant_id: m.payer_id, p_customer_id: customer, p_payment_method_id: pmId,
    p_bank_label: label.slice(0, 60), p_livemode: event.livemode === true,
  });
  if (error) throw new Error(`rentals_autopay_saved failed: ${error.message}`);
  logStep("Rent autopay bank saved", { tenancy: m.tenancy_id });
}

export async function settleRentBankSession(session: Stripe.Checkout.Session, { supabase, logStep }: Pick<WebhookContext, "supabase" | "logStep">): Promise<void> {
  const m = meta(session);
  if (session.mode !== "payment" || !m.bank_payment_id || session.client_reference_id !== m.bank_payment_id) {
    logStep("Rent bank session ignored (shape)", { id: session.id });
    return;
  }
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!piId) throw new Error(`rent bank session ${session.id} has no payment_intent`);
  const { error } = await supabase.rpc("rentals_bank_rent_processing", { p_id: m.bank_payment_id, p_payment_intent_id: piId });
  if (error) throw new Error(`rentals_bank_rent_processing failed: ${error.message}`);
  // A debit that already cleared (instant verification can settle fast) is recorded by its own
  // payment_intent.succeeded event; nothing to do here.
  logStep("Rent bank payment processing", { bank_payment_id: m.bank_payment_id, pi: piId });
}

export async function rentBankIntentSucceeded(pi: Stripe.PaymentIntent, { supabase, logStep }: Pick<WebhookContext, "supabase" | "logStep">): Promise<void> {
  const m = meta(pi);
  // The session's completion event may arrive after this one: attach the intent first (no-op if already).
  const { error: procErr } = await supabase.rpc("rentals_bank_rent_processing", { p_id: m.bank_payment_id, p_payment_intent_id: pi.id });
  if (procErr) throw new Error(`rentals_bank_rent_processing failed: ${procErr.message}`);
  const { data, error } = await supabase.rpc("rentals_bank_rent_succeeded", { p_payment_intent_id: pi.id });
  if (error) throw new Error(`rentals_bank_rent_succeeded failed: ${error.message}`);
  logStep("Rent bank payment succeeded", { bank_payment_id: m.bank_payment_id, pi: pi.id, result: data });
}

export async function rentBankIntentFailed(pi: Stripe.PaymentIntent, { supabase, logStep }: Pick<WebhookContext, "supabase" | "logStep">): Promise<void> {
  const m = meta(pi);
  const { error } = await supabase.rpc("rentals_bank_rent_failed", { p_id: m.bank_payment_id, p_expired: false });
  if (error) throw new Error(`rentals_bank_rent_failed failed: ${error.message}`);
  logStep("Rent bank payment failed", { bank_payment_id: m.bank_payment_id, pi: pi.id });
}

export async function rentBankSessionExpired(session: Stripe.Checkout.Session, { supabase, logStep }: Pick<WebhookContext, "supabase" | "logStep">): Promise<void> {
  const m = meta(session);
  const { error } = await supabase.rpc("rentals_bank_rent_failed", { p_id: m.bank_payment_id, p_expired: true });
  if (error) throw new Error(`rentals_bank_rent_failed (expired) failed: ${error.message}`);
  logStep("Rent bank page expired", { bank_payment_id: m.bank_payment_id });
}

/** An ACH return after success arrives as a dispute on the charge. */
export async function rentBankReturned(piId: string, reason: string, { supabase, logStep }: Pick<WebhookContext, "supabase" | "logStep">): Promise<void> {
  const { data, error } = await supabase.rpc("rentals_bank_rent_returned", { p_payment_intent_id: piId, p_reason: reason });
  if (error) throw new Error(`rentals_bank_rent_returned failed: ${error.message}`);
  logStep("Rent bank payment returned", { pi: piId, result: data });
}
