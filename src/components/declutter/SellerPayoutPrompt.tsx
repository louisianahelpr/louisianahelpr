import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePayoutSetupHireAllowed } from "@/hooks/usePayoutSetupHireAllowed";
import { usePayoutSetupBlock } from "@/hooks/usePayoutSetupPaused";
import { useStripeConnectStatus } from "@/hooks/useStripeConnectStatus";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import { fetchMyCart, type CartLine } from "@/lib/declutter/api";
import { fetchMyPayouts, type MyPayout } from "@/lib/declutter/handover";
import { formatPrice } from "@/lib/declutter/distance";
import { DeclutterNotice } from "./declutterUi";

/**
 * The Declutter money that really waits for this seller (owner 2026-10-28, shots 12 + 19: the banner said "You have
 * money waiting" on a first listing with nothing sold, because it asked only payout_setup_hire_allowed_for_me, which
 * is also true for a Helpr on a funded JOB). Counted from the seller's own Declutter rows: each paid sale (a paid cart
 * line on a paid or handed-over order, never a free claim) whose payout is not sent yet: its payout's amount while
 * that is pending or failed, or the sale's price while no payout row exists yet. A payout sent (succeeded) or with
 * nothing due counts nothing.
 * `titles` names every item in that money (audit 1030 DC-14: the banner summed two sales but named only the first).
 */
export function declutterMoneyWaiting(cart: CartLine[], payouts: MyPayout[]): { cents: number; titles: string[] } {
  const payoutBy = new Map(payouts.map((p) => [p.order_id, p]));
  const sales = new Map<string, { cents: number; titles: string[] }>();
  for (const l of cart) {
    if (l.my_side !== "seller" || l.status !== "paid" || !l.order_id || l.price_cents <= 0) continue;
    if (l.order_status !== "paid" && l.order_status !== "handed_over") continue;
    const s = sales.get(l.order_id) ?? { cents: 0, titles: [] };
    s.cents += l.price_cents;
    s.titles.push(l.item_title);
    sales.set(l.order_id, s);
  }
  let cents = 0;
  const titles: string[] = [];
  for (const [orderId, s] of sales) {
    const p = payoutBy.get(orderId);
    const owed = !p ? s.cents : p.status === "pending" || p.status === "failed" ? p.amount_cents : 0;
    if (owed <= 0) continue;
    cents += owed;
    titles.push(...s.titles);
  }
  return { cents, titles };
}

/** "Oak chair", "Oak chair and Blue mug", "Oak chair, Blue mug and 1 more": every item the money is for, counted. */
export function soldWords(titles: string[]): string {
  if (titles.length <= 2) return titles.join(" and ");
  if (titles.length === 3) return `${titles[0]}, ${titles[1]} and ${titles[2]}`;
  return `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`;
}

/**
 * The one payout prompt for Declutter sellers: the Sell and Move screens and the Selling tab's sold group (owner
 * 2026-10-27: list first, set up at first sale; 2026-10-28: make the first-sale moment clear). Shown only when ALL
 * of these hold:
 *   - the server lets this member set up payouts (payout_setup_hire_allowed_for_me: money is owed to them);
 *   - Declutter money really waits for them (declutterMoneyWaiting: a paid sale not paid out yet);
 *   - Stripe says their payouts are not ready (useStripeConnectStatus "setup");
 * then the paused notice while setup is paused for everyone, else the prompt with the sale and its amount.
 * A member who is owed nothing on Declutter sees nothing (and Stripe is not even asked): listing never waits on
 * payouts. No fee numbers (owner rule): the amount is the sale money itself.
 */
export function SellerPayoutPrompt() {
  const owed = usePayoutSetupHireAllowed();
  if (!owed) return null;
  return <DeclutterMoneyPrompt />;
}

function DeclutterMoneyPrompt() {
  const { user } = useCurrentUser();
  const userId = user?.id ?? "";
  // The same reads (and keys) the Selling tab uses, so the prompt adds no request there.
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart, enabled: !!userId });
  const payouts = useQuery({ queryKey: ["declutter", "payouts", userId], queryFn: () => fetchMyPayouts(userId), enabled: !!userId });
  if (!cart.data || !payouts.data) return null;
  const waiting = declutterMoneyWaiting(cart.data, payouts.data);
  if (waiting.cents <= 0) return null;
  return <OwedPayoutPrompt cents={waiting.cents} titles={waiting.titles} />;
}

function OwedPayoutPrompt({ cents, titles }: { cents: number; titles: string[] }) {
  // The one reader every payout-setup entry point uses (payoutSetupPausedEntryPoints guard). Money is owed
  // here, so its only possible "no" is the pause for everyone.
  const paused = usePayoutSetupBlock() === "paused";
  const { payoutPrompt } = useStripeConnectStatus();
  if (payoutPrompt.kind !== "setup") return null;
  if (paused) return <PayoutSetupPausedNotice />;
  return (
    <div data-declutter-payout-prompt="">
      <DeclutterNotice tone="warn" title={`Set up payouts to get your ${formatPrice(cents)}.`}>
        {titles.length ? `You sold ${soldWords(titles)}. ` : ""}The money is held safely until payouts are set up, one short step.{" "}
        <Link to="/profile?tab=payment" className="underline font-semibold">Set up payouts</Link>
      </DeclutterNotice>
    </div>
  );
}
