import { WhatNextSheet } from "@/components/whatNext/WhatNextSheet";
import { formatPrice } from "@/lib/declutter/distance";
import { buyNowTotalCents } from "@/lib/declutter/money";

const Money = ({ cents }: { cents: number }) => (
  <span className="font-semibold tabular-nums text-[hsl(var(--accent-ink))]">{formatPrice(cents)}</span>
);

/**
 * Board 79, "What next" after a Declutter offer, on the shared WhatNextSheet. The real rules
 * (the offer panel's own fine print): the seller has 48 hours to accept, say no or counter;
 * if they accept, the buyer has 48 hours to check out, and nothing is charged until then.
 * The pickup total is buyNowTotalCents (price + 5% + 70c); Helpr delivery is added at checkout.
 * The board's "Good for 24 hours" and "address unlocks" are not today's rules, so not shown.
 */
export function OfferSentWhatNext({ cents, onClose, onBrowse }: { cents: number | null; onClose: () => void; onBrowse: () => void }) {
  return (
    <WhatNextSheet
      open={cents !== null}
      onClose={onClose}
      title="Offer sent"
      lead="Your card isn't charged unless the seller accepts and you check out."
      steps={cents === null ? [] : [
        { key: "offered", label: <>You offered <Money cents={cents} /></>, detail: "The seller has 48 hours to answer", state: "done" },
        { key: "answer", label: "The seller accepts, counters or says no", detail: "We'll let you know", state: "now" },
        { key: "accepted", label: "If the seller accepts", detail: <>You have 48 hours to check out: <Money cents={buyNowTotalCents(cents)} /> for pickup</>, state: "later" },
        { key: "pickup", label: "Pick it up", detail: "Then the seller is paid", state: "later" },
      ]}
      primary={{ label: "Got it", onClick: onClose }}
      secondary={{ label: "Keep browsing", onClick: onBrowse }}
    />
  );
}
