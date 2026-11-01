/**
 * The cart's hold line. Buy now used to ask in a "Reserve it for 48 hours" sheet here (with a strike warning) and then
 * a "Reserved for you" step; audit DB-5 (owner 2026-10-30: "Buy now goes straight to checkout, with no strike for
 * backing out before paying") removed both: Buy now now opens that seller's checkout in Buying (DeclutterOfferPanel),
 * and a Buy now line that is never paid just goes back up (declutter_deadline_sweep, 20261030064929).
 */
import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchBundleRule } from "@/lib/declutter/bundle";
import { holdHasNoStrike } from "@/lib/declutter/buyNowHold";
import type { CartLine } from "@/lib/declutter/api";
import { NextStep, type NextStepValue } from "@/components/ui/NextStep";

/**
 * The cart's hold line for one seller's checkout (lead 2026-10-28): "Reserved for you, not paid yet" and the time
 * left, then when it must be paid by and what happens if not (the server's 48-hour rule, 20261014210518). The
 * bundle hint shows only when this seller has a bundle discount (the same read as the item page's bundle row), with a
 * link to the seller's other items (BUY-12).
 * DB-5: when every line is Buy now or free (holdHasNoStrike), running out is no strike; a checkout holding an
 * accepted offer keeps the strike words, because that line still carries one. And Buy now lands on
 * ?checkout=<seller>: this seller's checkout (the section around the hold line) scrolls into view once it is shown.
 */
/** The cart's next step: choose a way to get it, then pay (or confirm a free item), before the hold runs out. */
export function cartNextStep(allFree: boolean, timeLeft: string): NextStepValue {
  return { who: "you", text: allFree ? "Choose how you get it, then confirm" : "Choose how you get it, then pay", by: timeLeft || null };
}

export function CartHold({ sellerId, checkoutBy, allFree, lines, timeLeft }: {
  sellerId: string; checkoutBy: string; allFree: boolean; lines: readonly CartLine[]; timeLeft: string;
}) {
  const rule = useQuery({ queryKey: ["declutter", "bundle-rule", sellerId], queryFn: () => fetchBundleRule(sellerId) });
  const by = new Date(checkoutBy).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  const noStrike = holdHasNoStrike(lines);
  const ref = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();
  const focused = params.get("checkout") === sellerId;
  useEffect(() => {
    if (focused) ref.current?.closest<HTMLElement>("[data-checkout-seller]")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [focused]);
  return (
    <div ref={ref} className="space-y-0.5" data-cart-hold="">
      {/* The next-step line (owner 2026-11-01: "people aren't told what to do next"): the buyer's move here is the
          checkout under this line, with the time left as its deadline. */}
      <NextStep value={cartNextStep(allFree, timeLeft)} />
      <p className="text-ds-13 text-muted-foreground">
        {allFree ? "Reserved for you. " : "Reserved for you, not paid yet. "}
        {/* DA-12: a free item goes back up with no strike when its 48 hours run out (declutter_deadline_sweep).
            DB-5: so does a Buy now line; only an accepted offer still carries a strike. */}
        {allFree ? `Confirm it by ${by}. If you don't, it goes back up. No strike.`
          : noStrike ? `Pay by ${by}. If you don't, it goes back up for sale. No strike.`
            : `Check out by ${by}. If you don't, you get a strike and the item goes back up for sale.`}
        {/* BUY-12 (audit 10-30): the hint had no way to do it from the cart; the seller's profile lists what else they
            have for sale (SellingNowRow on /user/:id). */}
        {!allFree && rule.data ? (
          <>
            {" Add more from this seller first to save with their bundle discount. "}
            <Link to={`/user/${sellerId}`} data-cart-bundle-more="" className="link-standard font-semibold text-foreground">
              See their other items
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
