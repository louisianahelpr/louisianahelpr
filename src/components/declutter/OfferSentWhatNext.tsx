import type { RefObject } from "react";
import { WhatNextSheet } from "@/components/whatNext/WhatNextSheet";
import { formatPrice } from "@/lib/declutter/distance";
import { BuyerTotal } from "@/components/declutter/BuyerTotal";
import { forPhrase, type NoDeliveryWay } from "@/lib/declutter/pickupWords";

const MONEY = "font-semibold tabular-nums text-[hsl(var(--accent-ink))]";
const Money = ({ cents }: { cents: number }) => <span className={MONEY}>{formatPrice(cents)}</span>;

/**
 * Board 79, "What next" after a Declutter offer, on the shared WhatNextSheet. The real rules
 * (the offer panel's own fine print): the seller has 48 hours to accept, say no or counter;
 * if they accept, the buyer has 24 hours to check out, and nothing is charged until then.
 * The pickup total is buyNowTotalCents (price + 5% + 70c); Helpr delivery is added at checkout.
 * The board's "Good for 24 hours" and "address unlocks" are not today's rules, so not shown.
 */
export function OfferSentWhatNext({ cents, onClose, onBrowse, way = "pickup", returnFocusTo }: { cents: number | null; onClose: () => void; onBrowse: () => void; way?: NoDeliveryWay; returnFocusTo?: RefObject<HTMLElement> }) {
  return (
    <WhatNextSheet
      open={cents !== null}
      onClose={onClose}
      // Send offer's form is gone by now, so the sheet has no button to give focus back to.
      onCloseAutoFocus={(e) => {
        if (!returnFocusTo?.current?.isConnected) return;
        e.preventDefault();
        returnFocusTo.current.focus({ preventScroll: true });
      }}
      title="Offer sent"
      lead="Your card isn't charged unless the seller accepts and you check out."
      steps={cents === null ? [] : [
        { key: "offered", label: <>You offered <Money cents={cents} /></>, detail: "The seller has 48 hours to answer", state: "done" },
        { key: "answer", label: "The seller accepts, counters or says no", detail: "We'll let you know", state: "now" },
        { key: "accepted", label: "If the seller accepts", detail: <>You have 24 hours to check out: <BuyerTotal priceCents={cents} className={MONEY} pendingClassName="font-normal" /> {forPhrase(way)}</>, state: "later" },
        { key: "pickup", label: way === "meetup" ? "Meet at the safe spot" : way === "none" ? "Get it delivered" : "Pick it up", detail: "Then the seller is paid", state: "later" },
      ]}
      primary={{ label: "Got it", acknowledge: true }}
      secondary={{ label: "Keep browsing", onClick: onBrowse }}
    />
  );
}
