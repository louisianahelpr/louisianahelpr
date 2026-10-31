import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WhatNextSheet, type WhatNextStep } from "@/components/whatNext/WhatNextSheet";
import { fetchItem, fetchItemDropState } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { dropWhenLabel, nextPriceDrop } from "@/lib/declutter/priceDrop";
import { ListingLinkCard, copyListingLink } from "./DeclutterShareCard";

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
  const askOrGet = free ? "Someone asks a question or claims it" : "Buyers ask questions or buy";
  const drop = live ? nextPriceDrop(it) : null;
  const shareable = live && it.status === "live";
  const steps: WhatNextStep[] = live
    ? [
        { key: "listed", label: free ? "Listed for free" : <>Listed at <Money cents={it.current_price_cents} /></>, detail: "Today", state: "done" },
        ...(drop
          ? [{ key: "drop", label: `Price can drop ${dropWhenLabel(drop.at)}`, detail: <>As low as <Money cents={drop.lowestCents} />, then {drop.pct}% less each evening (rounded down to a whole dollar), never below your lowest price</>, state: "now" as const }]
          : []),
        { key: "buyers", label: askOrGet, detail: "We'll tell you each time", state: drop ? "later" : "now" },
        { key: "sold", label: free ? "When it's claimed" : "When it sells", detail: "We show you how to hand it off", state: "later" },
      ]
    : [
        { key: "sent", label: "Sent for a review", detail: "Today", state: "done" },
        { key: "review", label: "Someone from Louisiana Helpr checks it", detail: free ? "We'll let you know when it's up" : "We'll let you know when it's up for sale", state: "now" },
        { key: "buyers", label: askOrGet, detail: "We'll tell you each time", state: "later" },
      ];
  return (
    <WhatNextSheet
      open
      onClose={close}
      title={live ? (free ? "Your free listing is live" : "Your listing is live") : "Sent for a review"}
      lead={<><strong>{it.title}</strong>{live ? (free ? " is listed for free now." : " is up for sale now.") : " goes up once it's checked."}</>}
      steps={steps}
      primary={{ label: "Preview", onClick: () => navigate(`/declutter/item/${it.id}?preview=buyer`) }}
      // Board 192 (Builder 3c): share only a listing buyers can open now, never one paused or in review.
      secondary={shareable ? { label: "Copy link for local groups", onClick: () => void copyListingLink(it) } : undefined}
    >
      {shareable ? <ListingLinkCard item={it} /> : null}
    </WhatNextSheet>
  );
}
