/**
 * The seller's Declutter money emails (Declutter audits 2026-10-28: deep audit #57, audit 2 SH2-3 / A2-3).
 *
 * Before this the seller got no email at all: only the buyer got declutter_receipt and declutter_refund. Spec
 * row 44 (docs/specs/declutter-auctions.md) says email for won/sold, receipts and refunds, so:
 *   - "sold"        (declutter_sold):        the buyer paid an order (stripe-webhook, declutter_mark_order_paid
 *                                            answered 'paid'): "You sold "Lamp"".
 *   - "payout_sent" (declutter_payout_sent): declutter-money sent the seller's payout and recorded it
 *                                            (declutter_payout_executed): "Your payout is on its way".
 *
 * Both go through queueEmail (_shared/resend.ts): the same queue, send log and suppression of test addresses as
 * the buyer's receipt. Best-effort: never throws, the money already moved and is recorded.
 *
 * Copy: the item price and the payout amount are amounts the seller gets or the buyer paid; no fee is named and
 * no fee number appears (membersSeeNoFeeWords, owner 2026-10-25). Item titles are member text; React escapes them.
 *
 * AUD31-35 (10-31): these emails (and the buyer's Declutter receipt, stripe-webhook) were one raw <p> with no brand,
 * greeting, sign-off or settings footer. Both parts now come from the branded notice email (NotificationEmail, the
 * one every bell email uses) through declutterEmailParts. "You sold" names the delivery money too when the seller
 * delivers (the payout is items + delivery then: declutter_complete_handover's v_rate).
 */
// `../_shared/` like the other walked shared modules, so the edge harness can swap the email layer.
import { queueEmail } from "../_shared/resend.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import * as React from "npm:react@18.3.1";
import { NotificationEmail } from "../_shared/email-templates/notification.tsx";
import { renderEmail } from "../_shared/email-templates/render.ts";

type SellerEmailKind = "sold" | "payout_sent";

// deno-lint-ignore no-explicit-any
type Db = any;
type Log = (step: string, detail?: Record<string, unknown>) => void;

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The member's first name for the greeting ("Hey Sam,"); "" gives "Hey there,". */
const firstName = (fullName: string | null | undefined): string => (fullName ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * Both parts of a Declutter money email, from the branded notice email: brand header, "Hey <name>,", the words, a
 * button naming where it goes, the Louisiana Helpr sign-off and the notification-settings footer.
 */
export async function declutterEmailParts(
  opts: { title: string; message: string; path: string; actionLabel: string; fullName?: string | null },
): Promise<{ html: string; text: string }> {
  const site = getAppUrl();
  return await renderEmail(React.createElement(NotificationEmail, {
    title: opts.title,
    message: opts.message,
    actionUrl: `${site}${opts.path}`,
    actionLabel: opts.actionLabel,
    userName: firstName(opts.fullName),
    prefsUrl: `${site}/profile?tab=notifications`,
    host: site.replace(/^https?:\/\//, ""),
  }));
}

/** "Lamp" / "Lamp" and "Chair" / "Lamp" and 2 more items, from the SQL that words the sale notices; "your item" if unreadable. */
async function itemsNamed(db: Db, orderId: string, log: Log): Promise<string> {
  const { data, error } = await db.rpc("declutter_order_items_named", { p_order_id: orderId });
  if (error || typeof data !== "string" || data.trim() === "") {
    log("Declutter seller email: items unreadable, says \"your item\"", { orderId, error: error?.message ?? null });
    return "your item";
  }
  return data;
}

/** The email for `kind`. */
function sellerEmailCopy(
  kind: SellerEmailKind,
  items: string,
  cents: number,
  deliveryCents: number,
): { templateName: string; subject: string; body: string } {
  if (kind === "sold") {
    // AUD31-35: a seller who delivers is paid the delivery too; the email names it, as checkout did.
    const plus = deliveryCents > 0 ? `, plus ${dollars(deliveryCents)} for delivering it` : "";
    return {
      templateName: "declutter_sold",
      subject: `You sold ${items}`,
      body: `You sold ${items} for ${dollars(cents)}${plus}. The buyer has paid. Hand it over as planned; you get paid after the handover.`,
    };
  }
  return {
    templateName: "declutter_payout_sent",
    subject: "Your payout is on its way",
    body: `Your ${dollars(cents)} payout for ${items} was sent. It lands in your bank on your usual payout schedule.`,
  };
}

/**
 * Emails the seller. `cents`: the item price for "sold" (declutter_orders.items_cents), the amount sent for
 * "payout_sent" (declutter_payouts.amount_cents). Never throws.
 */
export async function emailSeller(
  db: Db,
  sellerId: string | null | undefined,
  orderId: string,
  kind: SellerEmailKind,
  cents: number | null | undefined,
  log: Log,
  /** "sold" only: the delivery money a seller who delivers is paid on top (declutter_orders.delivery_cents). */
  deliveryCents: number | null | undefined = 0,
): Promise<void> {
  if (!sellerId) return;
  try {
    if (typeof cents !== "number" || !Number.isInteger(cents) || cents <= 0) {
      log("Declutter seller email skipped (no amount)", { kind, orderId });
      return;
    }
    const { data: profile, error } = await db.from("profiles").select("email, full_name").eq("user_id", sellerId).maybeSingle();
    const to = (profile as { email?: string | null } | null)?.email;
    const fullName = (profile as { full_name?: string | null } | null)?.full_name;
    if (error || !to) {
      log("Declutter seller email skipped (no address)", { kind, error: error?.message ?? null });
      return;
    }
    const items = await itemsNamed(db, orderId, log);
    const extra = kind === "sold" && typeof deliveryCents === "number" && Number.isInteger(deliveryCents) && deliveryCents > 0
      ? deliveryCents : 0;
    const { templateName, subject, body } = sellerEmailCopy(kind, items, cents, extra);
    const { html, text } = await declutterEmailParts({
      title: subject, message: body, path: "/declutter?tab=selling", actionLabel: "Open Selling", fullName,
    });
    const result = await queueEmail(db, { to, subject, templateName, html, text });
    if (!result.ok) log("Declutter seller email not queued", { kind, error: String(result.error) });
  } catch (e) {
    log("Declutter seller email threw", { kind, error: String(e) });
  }
}
