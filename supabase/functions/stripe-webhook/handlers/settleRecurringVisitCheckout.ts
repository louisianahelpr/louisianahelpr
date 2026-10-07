// seed-policy: pages for seed/E2E rows too, on purpose. Each alert here is a
// paid Checkout that needs a person (a refund or a booking by hand), and the
// money is real under the live key whoever owns the row.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { seedBoundaryDropsRow } from "../../_shared/seedBoundary.ts";

/**
 * Q210(b): the payer paid a $300+ recurring visit on-session.
 *
 * charge-recurring-visits never charges a visit of THREE_D_SECURE_MIN_CENTS or
 * more off-session (owner, 2026-09-27); it parks the visit in
 * recurring_visit_payments as 'pending' and create-payment opens a Checkout for
 * it (kind "recurring_visit"). This flips that row pending -> paid with the
 * PaymentIntent, then asks charge-recurring-visits to book the visit on it now
 * (narrowed to this series). If the kick is lost, the next daily run books it.
 *
 * Money in, nothing booked is the failure this guards: a row that is no longer
 * pending (expired by the visit-date sweep, or a mismatched amount) gets its
 * PaymentIntent refunded and ops is paged. A DB error throws so Stripe retries.
 */
export async function settleRecurringVisitCheckout(
  session: Stripe.Checkout.Session,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const meta = session.metadata as Record<string, string> | null;
  const rowId = meta?.recurring_visit_payment_id;
  if (session.payment_status !== "paid") {
    logStep("Recurring visit checkout completed unpaid — nothing to settle", { sessionId: session.id, status: session.payment_status });
    return;
  }
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!pi) {
    await postSlackOpsAlert({
      kind: "custom",
      severity: "critical",
      title: "Recurring visit checkout paid with no PaymentIntent",
      message: "A recurring-visit Checkout was paid but carries no PaymentIntent, so it can neither be booked nor refunded automatically. Reconcile and refund by hand.",
      fields: { session_id: session.id, row: rowId ?? "(none)" },
    });
    return;
  }

  // No row id: nothing can be booked for it, so it is refunded below.
  const { data: row, error: readErr } = rowId
    ? await supabase
      .from("recurring_visit_payments")
      .select("id, parent_job_id, visit_date, status, amount_cents, payer_id, stripe_payment_intent_id")
      .eq("id", rowId)
      .maybeSingle()
    : { data: null, error: null };
  if (readErr) throw new Error(`recurring_visit_payments read failed for ${rowId}: ${readErr.message}`);

  // Duplicate delivery: already settled on this same PaymentIntent.
  if (row && row.stripe_payment_intent_id === pi && row.status !== "pending") {
    logStep("Recurring visit payment already recorded (duplicate delivery)", { rowId, pi });
    return;
  }

  // Q750 (4): ending a series (end_recurring_series, a ban) or cancelling its
  // parent does not close a Checkout already open for one of its visits, so a
  // payment can still land for a series that is over. Nothing can be booked on
  // it (the cron skips an ended series and never scans a cancelled one), and
  // marking it paid would hold the money until the visit date and then return
  // it less the card fee. The platform left that Checkout open, so it comes
  // back in full now. Read only for a row that could otherwise be marked paid.
  let seriesOver = false;
  if (row && row.status === "pending") {
    const { data: parent, error: parentErr } = await supabase
      .from("jobs")
      .select("id, series_ended_on, status")
      .eq("id", row.parent_job_id)
      .maybeSingle();
    if (parentErr) throw new Error(`series read failed for recurring visit payment ${rowId}: ${parentErr.message}`);
    seriesOver = !parent || Boolean(parent.series_ended_on) || parent.status === "cancelled";
  }

  // Q843 (verified 2026-10-03, not a defect): amount_cents is budget + fee +
  // tax (DB CHECK recurring_visit_payments_amount_adds_up), and create-payment
  // charges the tax as its own "Sales tax" line with automatic_tax OFF, so a
  // taxed visit's amount_total equals amount_cents. Turning automatic_tax on
  // for that Checkout would add the tax twice and refund every taxed visit
  // here (create-payment.test.ts pins it off).
  let refundReason: string | null = null;
  if (!rowId) refundReason = "session carries no recurring_visit_payment_id";
  else if (!row) refundReason = "payment row not found";
  else if (row.status !== "pending") refundReason = `payment row is '${row.status}', not pending`;
  else if (seriesOver) refundReason = "the series ended (or its parent was cancelled) before this visit was paid";
  else if (session.amount_total !== row.amount_cents) {
    refundReason = `amount paid ${session.amount_total} != amount owed ${row.amount_cents}`;
  } else if ((session.currency ?? "").toLowerCase() !== "usd") {
    refundReason = `currency is '${session.currency}', not usd`;
  } else if (meta?.payer_id !== row.payer_id) {
    refundReason = "session payer is not the row's payer";
  }

  if (!refundReason) {
    const now = new Date().toISOString();
    const { data: flipped, error: flipErr } = await supabase
      .from("recurring_visit_payments")
      .update({ status: "paid", stripe_payment_intent_id: pi, paid_at: now, updated_at: now })
      .eq("id", rowId)
      .eq("status", "pending")
      .select("id");
    if (flipErr) throw new Error(`recurring_visit_payments paid flip failed for ${rowId}: ${flipErr.message}`);
    if (!flipped || flipped.length === 0) {
      // Lost a race with the visit-date sweep (expired) between the read and here.
      refundReason = "payment row left pending before it could be marked paid";
    }
  }

  if (refundReason) {
    logStep("ERROR: recurring visit paid but cannot be booked — refunding", { rowId, pi, refundReason });
    let alreadyRefunded = false;
    try {
      ({ alreadyRefunded } = await refundInFullOnce(stripe, pi));
    } catch (e) {
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Recurring visit paid, cannot be booked, and the refund failed",
        message: `The payer paid ${pi} for a recurring visit that cannot be booked (${refundReason}) and the refund failed. Refund ${pi} by hand.`,
        fields: { session_id: session.id, payment_intent: pi, row: rowId, error: (e as Error).message },
      });
      throw e;
    }
    // Q1247 (a): the payer is told, so the money coming back is never the
    // first they hear of it. Told right after the refund and BEFORE the row
    // write below (lh-money-escrow review: a write that threw after the
    // refund, retried by Stripe more than a day later, answers "already
    // refunded" and would never tell them). Whether to tell them is decided
    // by the NOTICE, not by the refund (second lh-money-escrow review of
    // Q1248): a first delivery can refund and die before the notice, and its
    // retry sees a replayed refund. The notice carries this payment's id in
    // its link; one that already exists is not written again.
    // The person who paid is the session's payer. The row's series and date
    // are named only when that is also the row's payer (a mismatch never
    // shows one account another's visit).
    const payerId = meta?.payer_id || (row?.payer_id as string | undefined) || null;
    const rowIsPayers = Boolean(row) && row!.payer_id === payerId;
    const { told, alreadyTold } = await tellPayerRefunded(supabase, {
      pi,
      payerId,
      parentJobId: rowIsPayers ? String(row!.parent_job_id) : null,
      visitDate: rowIsPayers ? String(row!.visit_date) : null,
      amountCents: session.amount_total ?? null,
      // A visit already paid on another PaymentIntent IS booked: this was a
      // second payment for it, and the notice says so.
      duplicate: rowIsPayers && row!.status === "paid",
    });
    // The row of a series that is over stops asking to be paid: the payer's
    // "Pay" card goes, and the cron's sweep never tells them "you weren't
    // charged" about a visit they paid for and got back. A failed write throws
    // so Stripe retries; the refund above then counts as already done.
    // ZERO ROWS IS LEGITIMATE here (the zero-row-write rule's named
    // exception): the conditional `.eq("status", "pending")` matches nothing
    // when the cron's sweep already expired this row between the read above
    // and this write, which is the same end state, so it is not checked.
    if (seriesOver) {
      const { error: expErr } = await supabase
        .from("recurring_visit_payments")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", rowId)
        .eq("status", "pending")
        .select("id");
      if (expErr) throw new Error(`recurring_visit_payments expire failed for ${rowId}: ${expErr.message}`);
    }
    // A retried delivery whose earlier run already told the payer posted its
    // ops warning right after: nothing new to say.
    if (alreadyRefunded && alreadyTold) {
      logStep("Recurring visit payment was already refunded and the payer told (retried delivery)", { rowId, pi, refundReason });
      return;
    }
    await postSlackOpsAlert({
      kind: "custom",
      severity: "warning",
      title: "Recurring visit paid but not bookable — refunded",
      message: `A recurring-visit Checkout was paid but ${refundReason}, so ${pi} was refunded in full.${
        told ? "" : " The payer could NOT be told in the app: tell them by hand."
      }`,
      fields: { session_id: session.id, payment_intent: pi, row: rowId, payer_told: told ? "yes" : "no" },
      oncePerDayKey: `recurring-visit-refunded:${pi}`,
    });
    return;
  }

  logStep("Recurring visit paid on-session", { rowId, pi, parent: row!.parent_job_id, visitDate: row!.visit_date });
  kickVisitBooking(String(row!.parent_job_id), logStep);
}

/**
 * Q1247 (a): the payer's notice for a recurring-visit payment refunded in
 * full, once per PaymentIntent (its id rides in the link, which /posts
 * ignores). `told`: written now, already there, or dropped by the seed
 * boundary by design (a seed series, a real recipient). `alreadyTold`: an
 * earlier delivery wrote it. An unreadable check is treated as not told
 * (a second notice at worst, never none).
 */
async function tellPayerRefunded(
  supabase: WebhookContext["supabase"],
  v: { pi: string; payerId: string | null; parentJobId: string | null; visitDate: string | null; amountCents: number | null; duplicate: boolean },
): Promise<{ told: boolean; alreadyTold: boolean }> {
  if (!v.payerId) return { told: false, alreadyTold: false };
  const link = `/posts?visit_refund=${encodeURIComponent(v.pi)}`;
  const { data: prior, error: priorErr } = await supabase
    .from("notifications").select("id").eq("user_id", v.payerId).eq("link", link).limit(1);
  if (!priorErr && (prior ?? []).length > 0) return { told: true, alreadyTold: true };
  const amount = typeof v.amountCents === "number" ? ` $${(v.amountCents / 100).toFixed(2)}` : "";
  const visit = `The visit${v.visitDate ? ` on ${v.visitDate}` : ""}`;
  const { data, error } = await supabase.from("notifications").insert({
    user_id: v.payerId,
    job_id: v.parentJobId,
    title: "Your visit payment was refunded",
    message: v.duplicate
      ? `${visit} was already paid, so we refunded the second payment of${amount} in full.`
      : `${visit} couldn't be booked, so we refunded the${amount} you paid for it in full.`,
    type: "job_updates",
    link,
  }).select("id");
  if (!error && data && data.length > 0) return { told: true, alreadyTold: false };
  if (!error && data && data.length === 0) {
    const dropped = (await seedBoundaryDropsRow(supabase, { user_id: v.payerId, job_id: v.parentJobId, link })) === true;
    return { told: dropped, alreadyTold: false };
  }
  return { told: false, alreadyTold: false };
}

/**
 * Q750 (3): a full refund of `pi`, where "it is already refunded" counts as
 * done. Stripe replays the first answer for the same key and params within
 * 24 hours; after that (a webhook retried more than a day later, say after the
 * refund went through and the row write failed) a second full refund is
 * refused with code `charge_already_refunded` (docs.stripe.com/error-codes),
 * and a key reused with other params is an idempotency error. Either one is
 * "done" only when the intent really carries a live refund; otherwise it is a
 * failed refund and is rethrown.
 */
async function refundInFullOnce(stripe: WebhookContext["stripe"], pi: string): Promise<{ alreadyRefunded: boolean }> {
  // Q1248: within the key's 24 hours Stripe REPLAYS the first refund as a
  // success, so a redelivered event (say after the row write threw) looked
  // like a new refund: the payer was told twice and ops warned twice. The
  // intent's refunds are listed first; a "created" refund that was already
  // on that list is the replay, and counts as already done. Unreadable, the
  // list proves nothing and the refund is treated as new (a second notice at
  // worst, never a missed refund).
  let before: string[] | null = null;
  try {
    const listed = await stripe.refunds.list({ payment_intent: pi, limit: 100 });
    before = ((listed?.data ?? []) as Stripe.Refund[]).map((r) => r.id);
  } catch {
    // Unreadable: the refund below is treated as new (see above).
    before = null;
  }
  try {
    const created = await stripe.refunds.create({ payment_intent: pi }, { idempotencyKey: `recurring-visit-refund:${pi}` });
    const replayed = Boolean(created?.id) && (before ?? []).includes(created.id);
    return { alreadyRefunded: replayed };
  } catch (e) {
    const err = e as { type?: string; code?: string } | null;
    const maybeDone = err?.code === "charge_already_refunded" ||
      err?.type === "StripeIdempotencyError" || err?.type === "idempotency_error";
    if (!maybeDone) throw e;
    const prior = await stripe.refunds.list({ payment_intent: pi, limit: 100 });
    if (!prior.data.some((r: Stripe.Refund) => r.status !== "failed" && r.status !== "canceled")) throw e;
    return { alreadyRefunded: true };
  }
}

type EdgeRuntimeLike = { waitUntil?: (p: Promise<unknown>) => void };

/** Best effort: the daily charge-recurring-visits run books it if this fails. */
function kickVisitBooking(parentJobId: string, logStep: WebhookContext["logStep"]): void {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    logStep("No SUPABASE_URL or service key; the daily run will book the paid visit", { parentJobId });
    return;
  }
  const run = fetch(`${url}/functions/v1/charge-recurring-visits?parentJobId=${encodeURIComponent(parentJobId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(55_000),
  })
    .then(async (res) => {
      if (!res.ok) logStep("Visit booking kick answered non-OK; the daily run will book it", { parentJobId, status: res.status, body: (await res.text()).slice(0, 200) });
    })
    .catch((err) => {
      logStep("Visit booking kick failed; the daily run will book it", { parentJobId, error: err instanceof Error ? err.message : String(err) });
    });
  const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(run);
}
