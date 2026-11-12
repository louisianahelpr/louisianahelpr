import type { RefObject } from "react";
import { WhatNextSheet } from "@/components/whatNext/WhatNextSheet";
import { formatPrice } from "@/lib/declutter/distance";
import { BuyerTotal } from "@/components/declutter/BuyerTotal";
import { forPhrase, type NoDeliveryWay } from "@/lib/declutter/pickupWords";
import { t } from "@/lib/i18n/language";

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
      title={t("osw.title")}
      lead={t("osw.lead")}
      steps={cents === null ? [] : [
        { key: "offered", label: <>{t("osw.youOffered")} <Money cents={cents} /></>, detail: t("osw.48h"), state: "done" },
        { key: "answer", label: t("osw.answer"), detail: t("osw.letKnow"), state: "now" },
        { key: "accepted", label: t("osw.ifAccepts"), detail: <>{t("osw.checkout")} <BuyerTotal priceCents={cents} className={MONEY} pendingClassName="font-normal" /> {forPhrase(way)}</>, state: "later" },
        { key: "pickup", label: t(way === "meetup" ? "osw.meet" : way === "none" ? "osw.delivered" : "osw.pickup"), detail: t("osw.thenPaid"), state: "later" },
      ]}
      primary={{ label: t("osw.gotIt"), acknowledge: true }}
      secondary={{ label: t("osw.keepBrowsing"), onClick: onBrowse }}
    />
  );
}
