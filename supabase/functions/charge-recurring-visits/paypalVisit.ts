// PayPal phase 6: the supabase side of funding a repeat visit through the poster's saved PayPal
// method (the rules live in _shared/payments/paypalVisitFunding.ts). charge-recurring-visits
// runs its whole eligibility walk first and hands one due date here only for a series whose
// first visit was paid through PayPal; such a series never reaches the Stripe charge below it.
import { fundPayPalVisit, type SeriesParent, type VisitOutcome, type VisitStore } from "../_shared/payments/paypalVisitFunding.ts";
import { supabaseSavedChargeStore } from "../_shared/payments/paypalSavedCharge.ts";
import type { PayPalRuntime } from "../_shared/payments/paypalRuntime.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export function supabaseVisitStore(db: Db): VisitStore {
  const must = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  return {
    async visitJobFor(parentId, visitDate) {
      const { data, error } = await db.from("jobs").select("id").eq("parent_job_id", parentId).eq("date_needed", visitDate).maybeSingle();
      must("visit job read", error);
      return data ? { id: String(data.id) } : null;
    },
    async insertVisitJob(row) {
      const { data, error } = await db.from("jobs").insert(row).select("id").single();
      if (error || !data) return { ok: false, code: error?.code ?? null, message: error?.message ?? "no row returned" };
      return { ok: true, id: String(data.id) };
    },
    async linkPaymentToJob(paymentId, jobId) {
      const { data, error } = await db.from("provider_payments").update({ funds_job_id: jobId, updated_at: new Date().toISOString() }).eq("id", paymentId).is("funds_job_id", null).select("id");
      must("provider_payments funds_job_id write", error);
      if (!data || data.length === 0) throw new Error(`provider_payments ${paymentId} funds_job_id write matched 0 rows (visit ${jobId} booked)`);
    },
    async jobFundedBy(paymentId) {
      const { data, error } = await db.from("provider_payments").select("funds_job_id").eq("id", paymentId).maybeSingle();
      must("provider_payments funds_job_id read", error);
      return (data?.funds_job_id as string | null) ?? null;
    },
    async insertRefund(paymentId, idempotencyKey, amountCents, reason) {
      const cols = "id, status, provider_refund_id";
      const { data, error } = await db.from("provider_refunds").insert({ provider_payment_id: paymentId, idempotency_key: idempotencyKey, amount_cents: amountCents, reason, status: "pending" }).select(cols).single();
      if (error?.code === "23505") {
        const again = await db.from("provider_refunds").select(cols).eq("idempotency_key", idempotencyKey).single();
        must("provider_refunds re-read", again.error);
        return { id: String(again.data.id), status: String(again.data.status), providerRefundId: again.data.provider_refund_id ?? null };
      }
      must("provider_refunds insert", error);
      return { id: String(data.id), status: String(data.status), providerRefundId: data.provider_refund_id ?? null };
    },
    async markRefund(id, status, providerRefundId) {
      const { error } = await db.from("provider_refunds").update({ status, ...(providerRefundId ? { provider_refund_id: providerRefundId } : {}), updated_at: new Date().toISOString() }).eq("id", id);
      must("provider_refunds update", error);
    },
    async captureIdOf(paymentId) {
      const { data, error } = await db.from("provider_payments").select("provider_capture_id").eq("id", paymentId).single();
      must("provider_payments capture read", error);
      return String(data.provider_capture_id);
    },
  };
}

export async function fundPayPalVisitFromCron(
  db: Db,
  runtime: PayPalRuntime,
  parent: SeriesParent,
  visitDate: string,
  holderId: string,
): Promise<VisitOutcome> {
  if (!runtime.ok) return { outcome: "needs_review", reason: `paypal_not_configured: ${runtime.reason}` };
  try {
    return await fundPayPalVisit(
      {
        charge: { store: supabaseSavedChargeStore(db), provider: runtime.provider, env: runtime.env },
        store: supabaseVisitStore(db),
        provider: runtime.provider,
      },
      { parent, visitDate, holderId },
    );
  } catch (e) {
    // A database read/write failed somewhere in the walk: whatever was recorded stays recorded
    // (the 'created'/captured payment row is the claim) and the next run in the window resumes.
    return { outcome: "retry", reason: e instanceof Error ? e.message : String(e) };
  }
}
