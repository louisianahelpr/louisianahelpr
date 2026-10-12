/**
 * Q1652: the ONE notice a person gets when money goes back to them.
 *
 * Owner report 2026-10-12: "was i refunded for mow and weed eat yard? i dont
 * think i got an email that i was refunded". Measured: void-cancelled-payments
 * refunded $100.00 of the $112.00 (re_3UOcZ8Kp2H4b7tEC1cVCF92O) and nobody was
 * told. The charge.refunded webhook only wrote "Refund processed" on a FULL
 * refund, in-app only; a partial refund and a released card hold told no one,
 * and no refund path sent an email at all.
 *
 * Every refund the platform makes (void-cancelled-payments, cancel_escrow,
 * admin refunds, dispute splits, crew and series refunds, Dashboard refunds)
 * raises charge.refunded, so the webhook calls this once per live refund. A
 * hold released without a charge raises no such event, so every path that
 * releases one (paymentIntents.cancel, a partial capture) calls it itself.
 * src/test/refundPathsSendTheNotice.test.ts holds both halves.
 *
 * Exactly once per refund: the sender claims `refund:<re_id>` (or
 * `release:<pi_id>`) in public.refund_notices BEFORE it writes anything, so the
 * webhook, its redeliveries and the path that made the refund race on one
 * primary key. A sender whose notification write fails gives the claim back,
 * so a retry still tells them.
 *
 * The email goes through send-notification-email as type "payment", the same
 * type the old "Refund processed" row used: the person's own Email switches
 * and the seed boundary apply there exactly as for every other money notice.
 *
 * ZERO imports on purpose (like insertNotifications.ts), so any function and
 * the edge harness can load it as it is.
 */

// deno-lint-ignore no-explicit-any
type Client = any;

/** What the person paid with, as Stripe's charge describes it. */
export interface PaymentMethodLabel {
  brand?: string | null;
  last4?: string | null;
  /** card.wallet.type: apple_pay, google_pay, link, ... */
  wallet?: string | null;
  /** payment_method_details.type when it is not a card: us_bank_account, cashapp, ... */
  type?: string | null;
}

export interface RefundNoticeInput {
  /** `refund:<Stripe refund id>` or `release:<PaymentIntent id>`. */
  key: string;
  /** refund = money returned from a charge; release = an uncaptured hold let go. */
  kind: "refund" | "release";
  paymentIntentId: string | null;
  /** The money going back, in cents. */
  amountCents: number;
  /** What the payment kept (charge total less every refund so far), in cents. */
  keptCents?: number | null;
  /** Why it was kept, when the caller knows better than the job row does. */
  keptReason?: string | null;
  /** Refund metadata from Stripe (source, dispute_id, fee_withheld, kept_reason). */
  metadata?: Record<string, string> | null;
  method?: PaymentMethodLabel | null;
  /** Who gets it. Resolved from the job (or `metadataRecipient`) when absent. */
  recipientId?: string | null;
  jobId?: string | null;
  /**
   * false: never look the job up by `paymentIntentId` (the caller already
   * decided which job, if any, this person may see named).
   */
  jobByPayment?: boolean;
  /** One extra sentence for this path (a gift card given back, a visit). */
  extra?: string | null;
  /** Where the notice opens; defaults to the job on /posts. */
  link?: string | null;
  /**
   * The payment's own metadata (job_id, customer_id, payer_id, ...), read
   * only when no job was found and no recipient was given.
   */
  loadMetadata?: () => Promise<Record<string, string> | null>;
  /** Where send-notification-email lives; read from Deno.env when absent. */
  endpoint?: { url: string; key: string } | null;
}

export type RefundNoticeStatus =
  | "sent"          // in-app row written (emailed says whether the email went)
  | "duplicate"     // another sender already told them about this refund
  | "no_recipient"  // nobody to tell: no job, no payer on the payment
  | "dropped"       // the seed boundary dropped the row by design (a seed subject, a real person)
  | "unwritten"     // the insert matched zero rows for another reason: nobody was told
  | "failed";       // nothing was written: the caller must retry or page

export interface RefundNoticeResult {
  status: RefundNoticeStatus;
  emailed?: boolean;
  error?: string;
}

interface JobRow {
  id: string;
  customer_id: string | null;
  title: string | null;
  status: string | null;
  cancellation_fee: number | string | null;
  customer_fee_amount: number | string | null;
  dispute_status: string | null;
}

const JOB_COLS = "id, customer_id, title, status, cancellation_fee, customer_fee_amount, dispute_status";

/** "$100" or "$41.87": the poster's money is never rounded (formatExactDollars). */
export function refundDollars(cents: number): string {
  const c = Math.round(Number.isFinite(cents) ? cents : 0);
  const whole = c % 100 === 0;
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const WALLETS: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  samsung_pay: "Samsung Pay",
  link: "Link",
  amex_express_checkout: "Amex Express Checkout",
  masterpass: "Masterpass",
  visa_checkout: "Visa Checkout",
};

const BRANDS: Record<string, string> = {
  amex: "American Express",
  diners: "Diners Club",
  discover: "Discover",
  jcb: "JCB",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
};

/** "your Visa ending in 4242", "Apple Pay (Visa ending in 4242)", or the fallback. */
export function describePaymentMethod(m: PaymentMethodLabel | null | undefined): string {
  if (!m) return "your original payment method";
  const brand = m.brand ? (BRANDS[m.brand] ?? m.brand.charAt(0).toUpperCase() + m.brand.slice(1)) : null;
  const card = m.last4 ? `${brand ?? "card"} ending in ${m.last4}` : brand;
  const wallet = m.wallet ? (WALLETS[m.wallet] ?? m.wallet.replace(/_/g, " ")) : null;
  if (wallet) return card ? `${wallet} (${card})` : wallet;
  if (card) return `your ${card}`;
  if (m.type === "us_bank_account") return m.last4 ? `your bank account ending in ${m.last4}` : "your bank account";
  if (m.type && m.type !== "card") return m.type.replace(/_/g, " ");
  return "your original payment method";
}

/** The label from a Stripe Charge (webhook object or an expanded latest_charge). */
// deno-lint-ignore no-explicit-any
export function paymentMethodFromCharge(charge: any): PaymentMethodLabel | null {
  const d = charge?.payment_method_details;
  if (!d) return null;
  if (d.card) {
    return { brand: d.card.brand ?? null, last4: d.card.last4 ?? null, wallet: d.card.wallet?.type ?? null, type: "card" };
  }
  const t = typeof d.type === "string" ? d.type : null;
  const own = t ? d[t] : null;
  return { type: t, last4: own?.last4 ?? null, brand: null, wallet: null };
}

const cents = (dollars: number | string | null | undefined): number => {
  const n = Number(dollars ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * Why the payment kept what it kept, in words the poster can check against
 * their receipt. The caller's reason wins; then the refund's own metadata;
 * then what the job says happened to it.
 */
export function keptSentence(keptCents: number, input: Pick<RefundNoticeInput, "keptReason" | "metadata">, job: JobRow | null): string {
  if (!(keptCents > 0)) return "";
  const kept = refundDollars(keptCents);
  const why = input.keptReason ?? input.metadata?.kept_reason ?? null;
  if (why) return ` We kept ${kept}: ${why}.`;
  const md = input.metadata ?? {};
  if (md.dispute_id || md.source === "admin_refund_dispute" || (job?.dispute_status ?? null)) {
    return ` We kept ${kept}: the part of the payment the dispute decision gave the Helpr.`;
  }
  if (md.fee_withheld === "true") return ` We kept ${kept}: the service fee, which isn't refunded.`;
  if (job?.status === "cancelled") {
    const feeCents = Math.min(keptCents, Math.max(0, cents(job.cancellation_fee)));
    const restCents = keptCents - feeCents;
    const serviceCents = cents(job.customer_fee_amount);
    const parts: string[] = [];
    if (feeCents > 0) parts.push(`${refundDollars(feeCents)} cancellation fee paid to your Helpr`);
    if (restCents > 0) {
      parts.push(restCents === serviceCents
        ? `${refundDollars(restCents)} service fee, which isn't refunded when a job is cancelled`
        : `${refundDollars(restCents)} in service and card processing fees, which aren't refunded when a job is cancelled`);
    }
    if (parts.length === 1 && restCents === serviceCents && feeCents === 0) {
      return ` We kept ${kept}: the service fee, which isn't refunded when a job is cancelled.`;
    }
    return ` We kept ${kept}: ${parts.join(" and ")}.`;
  }
  return ` The other ${kept} of your payment was not part of this refund. Contact support if you expected it back.`;
}

/** Title and body. Exported so the guard and the tests read the words the poster reads. */
export function refundNoticeCopy(input: RefundNoticeInput, job: JobRow | null): { title: string; message: string } {
  const amount = refundDollars(input.amountCents);
  const what = job?.title ? ` for "${job.title}"` : "";
  const to = describePaymentMethod(input.method);
  const ref = input.key.slice(input.key.indexOf(":") + 1);
  const kept = keptSentence(Number(input.keptCents ?? 0), input, job);
  const extra = input.extra ? ` ${input.extra.trim()}` : "";
  if (input.kind === "release") {
    return {
      title: `Payment hold released: ${amount}`,
      message:
        `We released the ${amount} hold${what} on ${to} (reference ${ref}). You were not charged that amount; ` +
        `your bank usually removes the hold within 5-10 business days.${kept}${extra}`,
    };
  }
  return {
    title: `Refund issued: ${amount}`,
    message:
      `We refunded ${amount}${what} to ${to} (refund reference ${ref}). ` +
      `It usually shows on your statement within 5-10 business days.${kept}${extra}`,
  };
}

function envEndpoint(): { url: string; key: string } | null {
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env;
  const url = env?.get?.("SUPABASE_URL");
  const key = env?.get?.("SECRET_KEY") ?? env?.get?.("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? { url, key } : null;
}

const isMissingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /refund_notices/.test(e.message ?? "") && /does not exist|schema cache/.test(e.message ?? ""));

/**
 * Tell the person their money is on its way back. Never throws: the money has
 * already moved, so a notice failure is reported in the result ("failed") for
 * the caller to retry (the webhook throws so Stripe redelivers) or page.
 */
export async function sendRefundNotice(supabase: Client, input: RefundNoticeInput): Promise<RefundNoticeResult> {
  try {
    if (!/^(refund|release):[A-Za-z0-9_]+$/.test(input.key)) return { status: "failed", error: `bad notice key ${input.key}` };
    if (!(input.amountCents > 0)) return { status: "no_recipient", error: "nothing went back" };

    // The job: by id when the caller has it, else by the payment it was funded
    // with, else by the job the payment's own metadata names (a second payment
    // on an already-funded job is not the job's PaymentIntent).
    const readJob = async (col: "id" | "stripe_payment_intent_id", v: string): Promise<{ job: JobRow | null; error?: string }> => {
      const { data, error } = await supabase.from("jobs").select(JOB_COLS).eq(col, v).maybeSingle();
      if (error) return { job: null, error: error.message };
      return { job: (data as JobRow | null) ?? null };
    };
    let job: JobRow | null = null;
    const byPayment = input.jobByPayment !== false && !!input.paymentIntentId;
    if (input.jobId || byPayment) {
      const r = await readJob(input.jobId ? "id" : "stripe_payment_intent_id", (input.jobId ?? input.paymentIntentId)!);
      if (r.error) return { status: "failed", error: `job read: ${r.error}` };
      job = r.job;
    }
    let md: Record<string, string> = { ...(input.metadata ?? {}) };
    if (!job && !input.recipientId && input.loadMetadata) {
      md = { ...((await input.loadMetadata()) ?? {}), ...md };
      if (md.job_id) {
        const r = await readJob("id", md.job_id);
        if (r.error) return { status: "failed", error: `job read: ${r.error}` };
        job = r.job;
      }
    }
    const recipient = input.recipientId ?? job?.customer_id ??
      md.customer_id ?? md.payer_id ?? md.tipper_id ?? md.supabase_user_id ?? md.user_id ?? null;
    if (!recipient) return { status: "no_recipient" };

    const ref = input.key.slice(input.key.indexOf(":") + 1);
    const link = input.link ??
      (job ? `/posts?job=${job.id}&refund=${encodeURIComponent(ref)}` : `/posts?refund=${encodeURIComponent(ref)}`);

    // 1. Claim. The primary key is the dedupe: the loser stops here.
    let claimed = true;
    const claim = () => supabase.from("refund_notices").insert({
      notice_key: input.key,
      user_id: recipient,
      job_id: job?.id ?? null,
      payment_intent_id: input.paymentIntentId,
      amount_cents: Math.round(input.amountCents),
    }).select("notice_key");
    let { error: claimErr } = await claim();
    if (claimErr?.code === "23505") {
      // Taken. A claim that never got its notification (the sender died
      // between the two writes) is taken over after 5 minutes, so the person
      // is still told; anything newer or finished is the other sender's.
      const { data: held, error: heldErr } = await supabase.from("refund_notices")
        .select("notification_id, created_at").eq("notice_key", input.key).maybeSingle();
      const h = held as { notification_id: string | null; created_at: string } | null;
      const stale = !heldErr && h && !h.notification_id && Date.now() - Date.parse(h.created_at) > 5 * 60_000;
      if (!stale) return { status: "duplicate" };
      const { data: freed, error: freeErr } = await supabase.from("refund_notices").delete()
        .eq("notice_key", input.key).is("notification_id", null).eq("created_at", h!.created_at).select("notice_key");
      if (freeErr || (freed ?? []).length === 0) return { status: "duplicate" };
      ({ error: claimErr } = await claim());
      if (claimErr?.code === "23505") return { status: "duplicate" };
    }
    if (claimErr && isMissingTable(claimErr)) {
      // Deploy lag (functions deployed before db-deploy finished): dedupe on
      // the notice's own link instead, which carries the refund id.
      claimed = false;
      const { data: prior, error: priorErr } = await supabase
        .from("notifications").select("id").eq("user_id", recipient).eq("link", link).limit(1);
      if (priorErr) return { status: "failed", error: `prior notice read: ${priorErr.message}` };
      if ((prior ?? []).length > 0) return { status: "duplicate" };
    } else if (claimErr) {
      return { status: "failed", error: `claim: ${claimErr.message}` };
    }
    const release = async () => {
      if (!claimed) return;
      const { error } = await supabase.from("refund_notices").delete().eq("notice_key", input.key);
      if (error) console.error("[refundNotice] claim release failed; this refund will not be re-sent", { key: input.key, error: error.message });
    };

    // 2. The in-app notice.
    const { title, message } = refundNoticeCopy({ ...input, metadata: md }, job);
    const { data: rows, error: insErr } = await supabase.from("notifications").insert({
      user_id: recipient,
      job_id: job?.id ?? null,
      title,
      message,
      type: "payment",
      link,
    }).select("id");
    if (insErr) {
      await release();
      return { status: "failed", error: `notification: ${insErr.message}` };
    }
    const notificationId = (rows as Array<{ id: string }> | null)?.[0]?.id ?? null;
    if (!notificationId) {
      // Zero rows with no error: a BEFORE INSERT trigger dropped it. The seed
      // boundary does that on purpose (a seed job never tells a real person),
      // and the email would be refused for the same reason. Anything else is
      // reported. The claim stays either way: a retry would be dropped again.
      const { data: seed, error: seedErr } = await supabase.rpc("notification_crosses_seed_boundary", {
        p_recipient: recipient, p_job_id: job?.id ?? null, p_link: link,
      });
      if (!seedErr && seed === true) return { status: "dropped" };
      return { status: "unwritten", error: "the notification insert matched zero rows" };
    }

    // Stamped at once, so the stale-claim takeover above never re-sends it.
    if (claimed) {
      const { error: stampErr } = await supabase.from("refund_notices")
        .update({ notification_id: notificationId }).eq("notice_key", input.key).select("notice_key");
      if (stampErr) console.error("[refundNotice] notification stamp failed (notice was sent)", { key: input.key, error: stampErr.message });
    }

    // 3. The email, through the one sender that honours the person's switches.
    const ep = input.endpoint ?? envEndpoint();
    let emailed = false;
    let emailError: string | undefined;
    if (!ep) {
      emailError = "no SUPABASE_URL / service key to reach send-notification-email";
    } else {
      try {
        const res = await fetch(`${ep.url}/functions/v1/send-notification-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ep.key}` },
          body: JSON.stringify({ notification_id: notificationId, user_id: recipient, title, message, type: "payment", link, job_id: job?.id ?? null }),
          signal: AbortSignal.timeout(20_000),
        });
        // A body that is not JSON reads as "not skipped": res.ok alone decides.
        const body = await res.json().catch(() => ({})) as { skipped?: boolean; reason?: string };
        emailed = res.ok && !body.skipped;
        if (!res.ok) emailError = `send-notification-email answered ${res.status}`;
        else if (body.skipped) emailError = `skipped: ${body.reason ?? "unknown"}`;
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
      }
    }
    if (claimed && emailed) {
      const { error: emailStampErr } = await supabase.from("refund_notices")
        .update({ emailed: true }).eq("notice_key", input.key).select("notice_key");
      if (emailStampErr) console.error("[refundNotice] emailed stamp failed (email was sent)", { key: input.key, error: emailStampErr.message });
    }
    if (emailError) console.warn("[refundNotice] email not sent", { key: input.key, error: emailError });
    return { status: "sent", emailed, ...(emailError ? { error: emailError } : {}) };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
