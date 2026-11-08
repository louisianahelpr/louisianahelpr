import { trackFunnel } from "@/lib/declutter/funnel";

/**
 * H3 (audit 11-08): Stripe sends the buyer back to /declutter?view=cart&paid=1&order=<id> (success_url) or
 * /declutter?view=cart&back=1 (cancel_url, declutter-checkout). A re-render, the "What next" sheet dropping ?paid=1
 * or the app rewriting the URL does not count it again.
 */
const seen = new Set<string>();

export function trackStripeReturn(search: string): void {
  const p = new URLSearchParams(search);
  const paid = p.get("paid") === "1";
  if (!paid && p.get("back") !== "1") return;
  const order = p.get("order");
  // Not the whole query string: Declutter rewrites ?view=cart&back=1 to ?back=1&tab=buying (review 11-08). A paid
  // return counts once per order; a back once per 30 seconds.
  const key = paid ? `paid:${order ?? ""}` : `back:${Math.floor(Date.now() / 30_000)}`;
  if (seen.has(key)) return;
  seen.add(key);
  trackFunnel("returned_from_stripe", { orderId: paid ? order : null, detail: paid ? "paid" : "back" });
}
