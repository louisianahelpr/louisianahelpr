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
 * no fee number appears (membersSeeNoFeeWords, owner 2026-10-25). Item titles are member text, so they are
 * escaped in the HTML part.
 */
// `../_shared/` like the other walked shared modules, so the edge harness can swap the email layer.
import { queueEmail } from "../_shared/resend.ts";
import { getAppUrl } from "../_shared/appUrl.ts";

type SellerEmailKind = "sold" | "payout_sent";

// deno-lint-ignore no-explicit-any
type Db = any;
type Log = (step: string, detail?: Record<string, unknown>) => void;

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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
): { templateName: string; subject: string; body: string } {
  if (kind === "sold") {
    return {
      templateName: "declutter_sold",
      subject: `You sold ${items}`,
      body: `You sold ${items} for ${dollars(cents)}. The buyer has paid. Hand it over as planned; you get paid after the handover.`,
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
): Promise<void> {
  if (!sellerId) return;
  try {
    if (typeof cents !== "number" || !Number.isInteger(cents) || cents <= 0) {
      log("Declutter seller email skipped (no amount)", { kind, orderId });
      return;
    }
    const { data: profile, error } = await db.from("profiles").select("email").eq("user_id", sellerId).maybeSingle();
    const to = (profile as { email?: string | null } | null)?.email;
    if (error || !to) {
      log("Declutter seller email skipped (no address)", { kind, error: error?.message ?? null });
      return;
    }
    const items = await itemsNamed(db, orderId, log);
    const { templateName, subject, body } = sellerEmailCopy(kind, items, cents);
    const link = `${getAppUrl()}/declutter?tab=selling`;
    const result = await queueEmail(db, {
      to,
      subject,
      templateName,
      html: `<p>${escapeHtml(body)}</p><p><a href="${link}">Open Selling</a></p>`,
      text: `${body}\n\nOpen Selling: ${link}`,
    });
    if (!result.ok) log("Declutter seller email not queued", { kind, error: String(result.error) });
  } catch (e) {
    log("Declutter seller email threw", { kind, error: String(e) });
  }
}
