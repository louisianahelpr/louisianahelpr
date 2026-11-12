import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WhatNextSheet, type WhatNextStep } from "@/components/whatNext/WhatNextSheet";
import { fetchItem, fetchItemDropState } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { dropWhenLabel, nextPriceDrop } from "@/lib/declutter/priceDrop";
import { ListingLinkCard, copyListingLink } from "./DeclutterShareCard";
import "@/lib/i18n/enDeclutter";
import { t } from "@/lib/i18n/language";

/** Router state DeclutterSellView hands the Selling tab after a publish (board 80). */
type JustListed = { itemId: string; status: string };

const Money = ({ cents }: { cents: number }) => (
  <span className="font-semibold tabular-nums text-[hsl(var(--accent-ink))]">{formatPrice(cents)}</span>
);

/**
 * Board 80, "What next" after listing, on the shared WhatNextSheet. Opens once on the
 * Selling tab after a publish. Every figure is read back from the item itself: the price,
 * and the next price drop from priceDrop.ts (the cron's real time, offers-only, 12 hours
 * after going live, "next possible drop"); a listing the drop rule never touches shows no
 * drop step. A listing sent for review says so instead of "live".
 */
export function ListedWhatNext() {
  const location = useLocation();
  const navigate = useNavigate();
  const listed = (location.state as { justListed?: JustListed } | null)?.justListed ?? null;
  const item = useQuery({
    queryKey: ["declutter", "just-listed", listed?.itemId],
    enabled: !!listed,
    queryFn: async () => {
      const [row, drop] = await Promise.all([fetchItem(listed!.itemId), fetchItemDropState(listed!.itemId)]);
      return row ? { ...row, ...(drop ?? {}) } : null;
    },
  });
  const close = () => navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  const it = item.data;
  if (!listed || !it) return null;
  const live = listed.status === "live";
  // A giveaway reads as one (audit posting 1030 #12): claimed, never bought.
  const free = it.current_price_cents === 0;
  const askOrGet = free ? t("decl.lwn.askFree") : t("decl.lwn.askPaid");
  const drop = live ? nextPriceDrop(it) : null;
  const shareable = live && it.status === "live";
  const steps: WhatNextStep[] = live
    ? [
        { key: "listed", label: free ? t("decl.lwn.listedFree") : <>{t("decl.lwn.listedAt")} <Money cents={it.current_price_cents} /></>, detail: t("decl.lwn.today"), state: "done" },
        ...(drop
          // Audit 11-10 F332: a drop that can only come later is never the "Now" step (buyers can buy now), and the
          // first step is said in dollars: on a $4 item, 5% rounded down to a whole dollar is $1 off, not 5%.
          ? [{ key: "drop", label: <>{t("decl.lwn.dropTo")} <Money cents={drop.lowestCents} /> {dropWhenLabel(drop.at)}</>, detail: t("decl.lwn.dropDetail", { less: formatPrice(it.current_price_cents - drop.lowestCents), pct: drop.pct }), state: "later" as const }]
          : []),
        { key: "buyers", label: askOrGet, detail: t("decl.lwn.tellEach"), state: "now" },
        { key: "sold", label: free ? t("decl.lwn.whenClaimed") : t("decl.lwn.whenSells"), detail: t("decl.lwn.handOff"), state: "later" },
      ]
    : [
        { key: "sent", label: t("decl.lwn.sent"), detail: t("decl.lwn.today"), state: "done" },
        { key: "review", label: t("decl.lwn.checks"), detail: free ? t("decl.lwn.upFree") : t("decl.lwn.upPaid"), state: "now" },
        { key: "buyers", label: askOrGet, detail: t("decl.lwn.tellEach"), state: "later" },
      ];
  return (
    <WhatNextSheet
      open
      onClose={close}
      title={live ? (free ? t("decl.lwn.titleFree") : t("decl.lwn.titleLive")) : t("decl.lwn.sent")}
      lead={<><strong>{it.title}</strong>{" "}{live ? (free ? t("decl.lwn.leadFree") : t("decl.lwn.leadLive")) : t("decl.lwn.leadReview")}</>}
      steps={steps}
      primary={{ label: t("decl.lwn.preview"), onClick: () => navigate(`/declutter/item/${it.id}?preview=buyer`) }}
      // Board 192 (Builder 3c): share only a listing buyers can open now, never one paused or in review.
      secondary={shareable ? { label: t("decl.lwn.copy"), onClick: () => void copyListingLink(it) } : undefined}
    >
      {shareable ? <ListingLinkCard item={it} /> : null}
    </WhatNextSheet>
  );
}
