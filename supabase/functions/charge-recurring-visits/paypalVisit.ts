// PayPal phase 6: the supabase side of funding a repeat visit through the poster's saved PayPal
// method (the rules live in _shared/payments/paypalVisitFunding.ts). charge-recurring-visits
// runs its whole eligibility walk first and hands one due date here only for a series whose
// first visit was paid through PayPal; such a series never reaches the Stripe charge below it.
//
// After a booking, the parties are booked exactly as the Stripe path books them (its
// "Charge, then create" tail): the Helpr's applications row (Activity tab, earnings, completion
// all join through it) and the two "booked" / "funded" notices, seed boundary respected, every
// failure a defect (lh-silent-failure review of phase 6, #1).
import { fundPayPalVisit, type SeriesParent, type VisitOutcome, type VisitStore } from "../_shared/payments/paypalVisitFunding.ts";
import { supabaseSavedChargeStore } from "../_shared/payments/paypalSavedCharge.ts";
import type { PayPalRuntime } from "../_shared/payments/paypalRuntime.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { refundNoticeProblem, sendRefundNotice } from "../_shared/refundNotice.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export function supabaseVisitStore(db: Db): VisitStore {
  const must = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  return {
    async visitJobFor(parentId, visitDate) {
      const { data, error } = await db.from("jobs").select("id, stripe_payment_intent_id").eq("parent_job_id", parentId).eq("date_needed", visitDate).maybeSingle();
      must("visit job read", error);
      if (!data) return null;
      const { data: f, error: fErr } = await db.from("provider_payments").select("id").eq("funds_job_id", data.id).limit(1);
      must("visit funding read", fErr);
      return { id: String(data.id), stripePaymentIntentId: (data.stripe_payment_intent_id as string | null) ?? null, fundedByPaymentId: f?.[0]?.id ? String(f[0].id) : null };
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
      const { data, error } = await db.from("provider_refunds").update({ status, ...(providerRefundId ? { provider_refund_id: providerRefundId } : {}), updated_at: new Date().toISOString() }).eq("id", id).select("id");
      must("provider_refunds update", error);
      if (!data || data.length === 0) throw new Error(`provider_refunds ${id} update matched 0 rows`);
    },
    async setPaymentStatus(paymentId, status) {
      const { data, error } = await db.from("provider_payments").update({ status, updated_at: new Date().toISOString() }).eq("id", paymentId).in("status", ["captured", "partially_refunded"]).select("id");
      must("provider_payments status write", error);
      if (!data || data.length === 0) throw new Error(`provider_payments ${paymentId} status write matched 0 rows`);
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
        readCaptureFeeCents: runtime.readCaptureFeeCents,
      },
      { parent, visitDate, holderId },
    );
  } catch (e) {
    // A database read/write failed somewhere in the walk: whatever was recorded stays recorded
    // (a funded payment row is adopted by the next run in the window); a person is told now.
    return { outcome: "needs_review", reason: `threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
  }
}

/**
 * Book the parties of a visit this run funded, as the Stripe path does. Returns the defects
 * (each also logged); an empty list means the Helpr and poster were both booked and told.
 */
export async function bookPayPalVisitParties(
  db: Db,
  parent: { id: string; title?: unknown; customer_id: string },
  childJobId: string,
  holderId: string,
  visitDate: string,
): Promise<string[]> {
  const fails: string[] = [];
  const { data: appRows, error: appErr } = await db.from("applications").upsert(
    { job_id: childJobId, helper_id: holderId, status: "accepted", message: null },
    { onConflict: "job_id,helper_id" },
  ).select("id");
  if (appErr || !appRows || appRows.length === 0) {
    fails.push(`series ${parent.id} ${visitDate}: PayPal visit ${childJobId} has no application row (${appErr?.message ?? "upsert returned zero rows"})`);
    await postSlackOpsAlert({
      kind: "custom",
      severity: "critical",
      title: "Recurring visit created without its application row",
      message: "A PayPal-funded visit is booked, but the Helpr has no application row: it will not appear in their Activity tab and the completion flow cannot resolve it. Insert the row by hand.",
      fields: { parentJobId: String(parent.id), visitJobId: childJobId, helperId: holderId, visitDate, error: appErr?.message ?? "upsert returned zero rows" },
    });
  }
  const rows = [
    {
      user_id: holderId,
      job_id: childJobId,
      title: "Your next visit is booked",
      message: `"${parent.title}" on ${visitDate} is confirmed and paid. Can't make it? Cancel this visit from My Jobs.`,
      type: "job_updates",
      link: `/jobs?job=${childJobId}`,
    },
    {
      user_id: parent.customer_id,
      job_id: childJobId,
      title: "Next visit funded",
      message: `"${parent.title}" on ${visitDate} is booked and held in escrow.`,
      type: "job_updates",
      link: `/posts?job=${childJobId}`,
    },
  ];
  // Q158/Q137: a seed series never notifies a real party; ask the trigger's own question first.
  const toSend: typeof rows = [];
  let expected = 0;
  for (const row of rows) {
    const { data: crosses, error: seedErr } = await db.rpc("notification_crosses_seed_boundary", { p_recipient: row.user_id, p_job_id: row.job_id, p_link: row.link });
    if (seedErr || typeof crosses !== "boolean") {
      fails.push(`series ${parent.id} ${visitDate}: seed boundary check failed for PayPal visit ${childJobId} (${seedErr?.message ?? "no boolean answer"})`);
      toSend.push(row);
      continue;
    }
    if (crosses) continue;
    toSend.push(row);
    expected++;
  }
  if (toSend.length > 0) {
    const { data: n, error: nErr } = await db.from("notifications").insert(toSend).select("id");
    if (nErr || !n || n.length < expected) {
      fails.push(`series ${parent.id} ${visitDate}: booking notifications not delivered for PayPal visit ${childJobId} (${nErr?.message ?? `inserted ${n?.length ?? 0} of ${expected}`})`);
    }
  }
  for (const f of fails) console.error(`[charge-recurring-visits] ${f}`);
  return fails;
}

/**
 * The poster is told money for a visit came back (an unbookable visit or a duplicate charge),
 * through the one refund notice every refund path uses (Q1714: amount, method, what was kept).
 */
export async function tellPosterVisitRefund(
  db: Db,
  parent: { id: string; title?: unknown; customer_id: string },
  visitDate: string,
  r: { providerRefundId: string | null; refundCents: number; keptCents: number },
  why: "unbooked" | "duplicate",
  env: string,
): Promise<string | null> {
  if (!(r.refundCents > 0)) return null;
  if (!r.providerRefundId) return `series ${parent.id} ${visitDate}: a ${r.refundCents}c visit refund has no PayPal refund id yet; poster not told`;
  const res = await sendRefundNotice(db, {
    key: `refund:pp_${r.providerRefundId}`,
    kind: "refund",
    paymentIntentId: null,
    jobByPayment: false,
    amountCents: r.refundCents,
    keptCents: r.keptCents,
    keptReason: r.keptCents > 0 ? "PayPal's processing fee, which PayPal does not return" : null,
    recipientId: parent.customer_id,
    jobId: parent.id,
    method: { type: "paypal" },
    extra: why === "duplicate"
      ? `You were charged twice for "${parent.title}" on ${visitDate}; this is the extra charge.`
      : `"${parent.title}" on ${visitDate} couldn't be booked.`,
    testMode: env === "sandbox",
  });
  const problem = refundNoticeProblem(res);
  return problem ? `series ${parent.id} ${visitDate}: visit refund notice: ${problem}` : null;
}
