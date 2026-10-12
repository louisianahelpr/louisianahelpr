/**
 * Q1654: the ONE notice a person gets when money goes back to them.
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
 * Its two imports (caughtMessage, functionFetch) have zero imports themselves, so any function and
 * the edge harness load the real module as it is.
 */
import { caughtMessage } from "./caughtMessage.ts";
import { fetchFunction } from "./functionFetch.ts";

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

type RefundNoticeStatus =
  | "sent"          // in-app row written (emailed says whether the email went)
  | "duplicate"     // another sender already told them about this refund
  | "in_flight"     // another sender claimed it seconds ago and is writing it now
  | "no_recipient"  // nobody to tell: no job, no payer on the payment
  | "dropped"       // the seed boundary dropped the row by design (a seed subject, a real person)
  | "unwritten"     // the insert matched zero rows for another reason: nobody was told
  | "failed";       // nothing was written: the caller must retry or page

export interface RefundNoticeResult {
  status: RefundNoticeStatus;
  emailed?: boolean;
  /** The person's own switches (or the seed boundary) held the email back: not a fault. */
  emailSkipped?: boolean;
  error?: string;
}

/**
 * What a sender must page about, or null. Every sender pages the same way
 * (review of Q1654 #1/#8): a refund nobody was told about, or a notice whose
 * email failed for a reason other than the person's own switches.
 */
export function refundNoticeProblem(r: RefundNoticeResult): string | null {
  if (r.status === "failed" || r.status === "unwritten" || r.status === "no_recipient") {
    return `the refund notice was not sent (${r.status}${r.error ? `: ${r.error}` : ""})`;
  }
  if (r.status === "sent" && !r.emailed && !r.emailSkipped) {
    return `the in-app refund notice was sent but its email was not (${r.error ?? "unknown"})`;
  }
  return null;
}

/**
 * Refunds whose own path tells the person, with words only it has (the
 * dispute decision, the admin's reason, the visit and the card fee), marked by
 * metadata those paths already put on the refund. The charge.refunded webhook
 * leaves these to their path, so the wording never depends on which sender
 * wins (review of Q1654 #1/#9); src/test/refundPathsSendTheNotice.test.ts
 * holds every path that sets one of these marks to calling sendRefundNotice.
 */
export function pathAnnouncesRefund(md: Record<string, string> | null | undefined): boolean {
  if (!md) return false;
  return !!md.dispute_id || md.source === "admin_refund_dispute" || md.source === "admin_refund_general" ||
    md.fee_withheld === "true";
}

/**
 * The amount a `release:<pi>` notice already told the person about, or null.
 * A hold captured in part releases the rest; should Stripe also show that as a
 * Refund on the charge, the webhook must not announce the same money twice
 * (second review of Q1654, N8).
 */
export async function releasedCentsAlreadyTold(
  supabase: Client,
  paymentIntentId: string | null,
): Promise<{ cents: number; createdS: number } | null> {
  if (!paymentIntentId) return null;
  const { data, error } = await supabase.from("refund_notices").select("amount_cents, notification_id, created_at")
    .eq("notice_key", `release:${paymentIntentId}`).maybeSingle();
  if (error || !data) return null;
  const row = data as { amount_cents: number; notification_id: string | null; created_at: string };
  if (!row.notification_id) return null;
  return { cents: Number(row.amount_cents), createdS: Date.parse(row.created_at) / 1000 };
}

/** Postgres errors no retry can pass: a foreign key, a CHECK, a malformed value. */
const PERMANENT = new Set(["23503", "23514", "22P02", "23502"]);
/** Marks a claim whose notification a trigger dropped by design: never taken over. */
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

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

/** Non-card payment_method_details.type values, in the words a person knows. */
const METHOD_TYPES: Record<string, string> = {
  link: "your Link account",
  cashapp: "Cash App Pay",
  amazon_pay: "Amazon Pay",
  paypal: "PayPal",
  klarna: "Klarna",
  affirm: "Affirm",
  afterpay_clearpay: "Afterpay",
  us_bank_account: "your bank account",
  revolut_pay: "Revolut Pay",
};

/** "your Visa ending in 4242", "Apple Pay (Visa ending in 4242)", or the fallback. */
function describePaymentMethod(m: PaymentMethodLabel | null | undefined): string {
  if (!m) return "your original payment method";
  const brand = m.brand ? (BRANDS[m.brand] ?? m.brand.charAt(0).toUpperCase() + m.brand.slice(1)) : null;
  const card = m.last4 ? `${brand ?? "card"} ending in ${m.last4}` : brand;
  const wallet = m.wallet ? (WALLETS[m.wallet] ?? m.wallet.replace(/_/g, " ")) : null;
  if (wallet) return card ? `${wallet} (${card})` : wallet;
  if (card) return `your ${card}`;
  if (m.type === "us_bank_account" && m.last4) return `your bank account ending in ${m.last4}`;
  // Never the raw type ("to link", review of Q1654 #4): a known name, or the fallback.
  if (m.type && METHOD_TYPES[m.type]) return METHOD_TYPES[m.type];
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
function keptSentence(keptCents: number, input: Pick<RefundNoticeInput, "keptReason" | "metadata">, job: JobRow | null): string {
  if (!(keptCents > 0)) return "";
  const kept = refundDollars(keptCents);
  const why = input.keptReason ?? input.metadata?.kept_reason ?? null;
  if (why) return ` We kept ${kept}: ${why}.`;
  const md = input.metadata ?? {};
  if (md.dispute_id || md.source === "admin_refund_dispute") {
    return ` We kept ${kept}: the part of the payment the dispute decision gave the Helpr.`;
  }
  if (md.fee_withheld === "true") return ` We kept ${kept}: the card processor's fee, which can't be returned.`;
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
function refundNoticeCopy(input: RefundNoticeInput, job: JobRow | null): { title: string; message: string } {
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
    let recipient: string | null = input.recipientId ?? job?.customer_id ??
      md.customer_id ?? md.payer_id ?? md.tipper_id ?? md.donor_id ?? md.supabase_user_id ?? md.user_id ?? null;
    // A tip's or a gift card's PaymentIntent names nobody (their payer sits on
    // the Checkout Session): their own ledgers do (review of Q1654 #7).
    for (const [table, col] of [["tips", "tipper_id"], ["gift_cards", "donor_id"]] as const) {
      if (recipient || !input.paymentIntentId || input.jobByPayment === false) break;
      const { data, error } = await supabase.from(table).select(col).eq("stripe_payment_intent_id", input.paymentIntentId).limit(1);
      if (error) return { status: "failed", error: `${table} read: ${error.message}` };
      recipient = ((data ?? [])[0] as Record<string, string> | undefined)?.[col] ?? null;
    }
    if (!recipient) return { status: "no_recipient" };

    const ref = input.key.slice(input.key.indexOf(":") + 1);
    const link = input.link ??
      (job ? `/posts?job=${job.id}&refund=${encodeURIComponent(ref)}` : `/posts?refund=${encodeURIComponent(ref)}`);

    // A notice for this refund already in the person's list (its reference
    // rides in every refund notice's link): the dedupe the claim falls back on.
    const alreadyListed = async (): Promise<boolean | null> => {
      const { data, error } = await supabase.from("notifications").select("id")
        .eq("user_id", recipient).eq("type", "payment").ilike("link", `%${ref}%`).limit(1);
      if (error) return null;
      return (data ?? []).length > 0;
    };

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
      // Taken. Finished (notification_id set): a duplicate. Fresh and not yet
      // written: the other sender is writing it now (in_flight; it pages if it
      // fails). Older than 5 minutes and never written: that sender died, so
      // it is taken over, unless the notice is in the list after all (its
      // stamp was what failed).
      const { data: held, error: heldErr } = await supabase.from("refund_notices")
        .select("notification_id, created_at").eq("notice_key", input.key).maybeSingle();
      const h = held as { notification_id: string | null; created_at: string } | null;
      if (heldErr || !h || h.notification_id) return { status: "duplicate" };
      if (Date.now() - Date.parse(h.created_at) <= 5 * 60_000) return { status: "in_flight" };
      if ((await alreadyListed()) !== false) return { status: "duplicate" };
      const { data: freed, error: freeErr } = await supabase.from("refund_notices").delete()
        .eq("notice_key", input.key).is("notification_id", null).eq("created_at", h.created_at).select("notice_key");
      if (freeErr || (freed ?? []).length === 0) return { status: "duplicate" };
      ({ error: claimErr } = await claim());
      if (claimErr?.code === "23505") return { status: "duplicate" };
    }
    if (claimErr && isMissingTable(claimErr)) {
      // Deploy lag (functions deployed before db-deploy finished): dedupe on
      // the notice's own link instead, which carries the refund reference.
      claimed = false;
      const listed = await alreadyListed();
      if (listed === null) return { status: "failed", error: "prior notice read failed" };
      if (listed) return { status: "duplicate" };
    } else if (claimErr && PERMANENT.has(claimErr.code ?? "")) {
      // A constraint no retry can pass (the recipient's account is gone: the
      // FK; a malformed id): nobody can be told, and redelivering will not
      // change that (review of Q1654 #6).
      return { status: "no_recipient", error: `claim: ${claimErr.code} ${claimErr.message}` };
    } else if (claimErr) {
      return { status: "failed", error: `claim: ${claimErr.message}` };
    }
    const release = async () => {
      if (!claimed) return;
      const { error } = await supabase.from("refund_notices").delete().eq("notice_key", input.key).is("notification_id", null);
      if (error) console.error("[refundNotice] claim release failed; the 5-minute takeover will re-send it", { key: input.key, error: error.message });
    };

    try {
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
        if (PERMANENT.has(insErr.code ?? "")) return { status: "unwritten", error: `notification: ${insErr.code} ${insErr.message}` };
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
        if (claimed) {
          await supabase.from("refund_notices").update({ notification_id: ZERO_UUID }).eq("notice_key", input.key).select("notice_key");
        }
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
      let emailSkipped = false;
      if (!ep) {
        emailError = "no SUPABASE_URL / service key to reach send-notification-email";
      } else {
        try {
          // A fresh timeout per attempt (a signal made once is already spent
          // when fetchFunction retries after a rate limit), and one deadline
          // for all of it, so a money path never waits a minute on an email
          // (second review of Q1654, N5).
          const res = await fetchFunction(`${ep.url}/functions/v1/send-notification-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${ep.key}` },
            body: JSON.stringify({ notification_id: notificationId, user_id: recipient, title, message, type: "payment", link, job_id: job?.id ?? null }),
          }, {
            deadlineAt: Date.now() + 25_000,
            fetchImpl: (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(15_000) }),
          });
          // A body that is not JSON reads as "not skipped": res.ok alone decides.
          const body = await res.json().catch(() => ({})) as { skipped?: boolean; reason?: string };
          emailed = res.ok && !body.skipped;
          if (!res.ok) emailError = `send-notification-email answered ${res.status}`;
          else if (body.skipped) { emailSkipped = true; emailError = `skipped: ${body.reason ?? "unknown"}`; }
        } catch (e) {
          emailError = caughtMessage(e);
        }
      }
      if (claimed) {
        // The email's outcome is recorded on the claim (review of Q1654 #8):
        // emailed, or why not, so an unsent one can be found and re-sent.
        const { error: emailStampErr } = await supabase.from("refund_notices")
          .update({ emailed, email_error: emailError ?? null }).eq("notice_key", input.key).select("notice_key");
        if (emailStampErr) console.error("[refundNotice] email stamp failed", { key: input.key, error: emailStampErr.message });
      }
      if (emailError) console.warn("[refundNotice] email not sent", { key: input.key, error: emailError });
      return { status: "sent", emailed, emailSkipped, ...(emailError ? { error: emailError } : {}) };
    } catch (e) {
      await release();
      throw e;
    }
  } catch (e) {
    return { status: "failed", error: caughtMessage(e) };
  }
}
