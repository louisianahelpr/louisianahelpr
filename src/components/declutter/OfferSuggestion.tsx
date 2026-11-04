/**
 * Q2471 (2) (owner 2026-10-29, "Declutter buyer offer helper: Make an offer shows Claude's suggested amount"): inside
 * the buyer's open offer box, Claude's fair offer for this item (declutter-ai-reply, mode "offer"), as one tap that
 * fills the amount. The buyer still reads the bill and presses Send offer; nothing is sent or saved here. A failed or
 * refused suggestion shows nothing: it is extra help, and the box works without it.
 */
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/declutter/distance";
import { requestSuggestedOffer } from "@/lib/declutter/aiReply";

export function OfferSuggestion({ itemId, onUse }: { itemId: string; onUse: (dollars: string) => void }) {
  const suggestion = useQuery({
    queryKey: ["declutter-offer-suggestion", itemId],
    queryFn: () => requestSuggestedOffer(itemId),
    staleTime: 10 * 60_000,
    retry: false,
  });
  if (suggestion.isPending) {
    return <p role="status" className="text-xs text-muted-foreground" data-offer-suggestion-loading="">Finding a fair offer…</p>;
  }
  if (suggestion.isError || !suggestion.data) return null;
  const { offerCents, reason } = suggestion.data;
  return (
    <div className="flex flex-wrap items-center gap-2" data-offer-suggestion="">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-full"
        onClick={() => onUse(String(offerCents / 100))}
      >
        Suggested offer: {formatPrice(offerCents)}
      </Button>
      {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
    </div>
  );
}
