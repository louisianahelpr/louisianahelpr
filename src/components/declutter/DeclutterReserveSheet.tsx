/**
 * "Buy now" as an in-app sheet, never a browser confirm() (lead walkthrough 2026-10-28; boards 159/160 did the same
 * for the handover moments). WHAT buying does is unchanged (owner 2026-10-28: keep the 48-hour hold, so a buyer can
 * add more from the same seller and pay once; not paying in 48 hours is a strike and the item goes back up, the
 * server rule of 20261014210518). The sheet says that plainly, before and after:
 *   1. ask:      "Reserve it for 48 hours", the pickup total, "Not paid yet"; Reserve it / Not now.
 *   2. reserved: "Reserved for you", "Not paid yet", check out within 48 hours; Go to checkout / Keep browsing.
 * Members see no fee numbers (only the total), as everywhere in Declutter.
 */
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { fetchBundleRule } from "@/lib/declutter/bundle";
import { BuyerTotal } from "./BuyerTotal";

export type ReserveStep = "ask" | "reserved" | null;

export function ReserveSheet({
  step,
  title,
  priceCents,
  sellerId,
  pending,
  onReserve,
  onClose,
  onCheckout,
}: {
  step: ReserveStep;
  title: string;
  priceCents: number;
  sellerId: string;
  pending: boolean;
  onReserve: () => void;
  onClose: () => void;
  onCheckout: () => void;
}) {
  const webDesktop = useIsWebDesktop();
  // The same read as the item page's bundle row (DeclutterBundleRow), so it is usually already in.
  const rule = useQuery({ queryKey: ["declutter", "bundle-rule", sellerId], queryFn: () => fetchBundleRule(sellerId), enabled: step !== null });
  const more = rule.data
    ? "Add more from this seller first to pay once and save with their bundle discount."
    : "Add more from this seller first to pay for them together.";
  return (
    <Sheet open={step !== null} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <SheetContent
        side="bottom"
        floor={!webDesktop}
        // An opaque surface like WhatNextSheet's: the item page must not show through the money words.
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[440px]" : ""}`}
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-reserve-sheet={step ?? ""}
      >
        {step === "reserved" ? (
          <>
            <SheetHero title="Reserved for you" />
            <p className="text-ds-15 font-semibold text-foreground">Not paid yet.</p>
            <p className="mt-1 text-ds-14 text-muted-foreground">
              Check out within 48 hours. {more} If you don't check out in time, you get a strike and it goes back up for sale.
            </p>
            <SheetFooter className="mt-4">
              <SheetSecondaryAction onClick={onClose}>Keep browsing</SheetSecondaryAction>
              <SheetPrimaryAction onClick={onCheckout}>Go to checkout</SheetPrimaryAction>
            </SheetFooter>
          </>
        ) : (
          <>
            <SheetHero title="Reserve it for 48 hours" />
            <dl className="mt-1 space-y-1 rounded-[20px] border border-border bg-background p-3 text-ds-14" data-reserve-bill="">
              <div className="min-w-0">
                <dt className="sr-only">Item</dt>
                <dd className="truncate" title={title}>{title}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
                <dt className="font-bold text-foreground">Total with pickup</dt>
                <dd className="text-ds-18 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]"><BuyerTotal priceCents={priceCents} /></dd>
              </div>
            </dl>
            <p className="mt-3 text-ds-15 font-semibold text-foreground">You pay at checkout. Not paid yet.</p>
            <p className="mt-1 text-ds-14 text-muted-foreground">
              Your card isn't charged now. Delivery, if you choose it, is added at checkout. {more}
            </p>
            <SheetFooter className="mt-4">
              <SheetSecondaryAction onClick={onClose} disabled={pending}>Not now</SheetSecondaryAction>
              <SheetPrimaryAction onClick={onReserve} disabled={pending}>Reserve it</SheetPrimaryAction>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The cart's hold line for one seller's checkout (lead 2026-10-28): "Reserved for you, not paid yet" and the time
 * left, then when it must be paid by and what happens if not (the server's 48-hour rule, 20261014210518). The
 * bundle hint shows only when this seller has a bundle discount (the same read as the item page's bundle row).
 */
export function CartHold({ sellerId, checkoutBy, allFree, timeLeft }: { sellerId: string; checkoutBy: string; allFree: boolean; timeLeft: string }) {
  const rule = useQuery({ queryKey: ["declutter", "bundle-rule", sellerId], queryFn: () => fetchBundleRule(sellerId) });
  const by = new Date(checkoutBy).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="space-y-0.5" data-cart-hold="">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-ds-15 font-semibold text-foreground">
        <span>{allFree ? "Reserved for you" : "Reserved for you, not paid yet"}</span>
        <span className="text-ds-13 font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{timeLeft}</span>
      </p>
      <p className="text-ds-13 text-muted-foreground">
        {allFree ? "Confirm it by" : "Check out by"} {by}. If you don't, you get a strike and the item goes back up{allFree ? "" : " for sale"}.
        {!allFree && rule.data ? " Add more from this seller first to save with their bundle discount." : ""}
      </p>
    </div>
  );
}
