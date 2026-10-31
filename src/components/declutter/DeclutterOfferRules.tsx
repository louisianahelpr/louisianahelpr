/**
 * Smart offers (d), owner 2026-10-29 (builder 33, on builder 28's server slice 20261029162620):
 *   "Accept offers"         on/off -> declutter_set_offer_rules (off = Buy only; the item page hides Make an offer)
 *   "Lowest you'll take"    only while offers are on; Claude's suggestion (declutter-ai-reply, mode "floor") is a
 *                           tap away and saved only when the seller taps "Use" (declutter_set_listing_price)
 *   "Answer offers for me"  only while offers are on -> declutter_set_offer_rules(auto): offers at or above the
 *                           lowest price are accepted at once, lower ones get a counter at it
 * The seller's switch reads back through declutter_seller_item_private.auto_offers (20261029170419).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { fetchMyItemPrivate, setListingPrice, setOfferRules } from "@/lib/declutter/api";
import { requestSuggestedFloor, suggestedReplyErrorMessage, type SuggestedFloor } from "@/lib/declutter/aiReply";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";

export function DeclutterOfferRules({
  itemId,
  priceCents,
  acceptsOffers,
  floorCents,
  rowClassName,
}: {
  itemId: string;
  priceCents: number;
  /** declutter_items.accepts_offers; undefined (before the column is live) reads as on, the column's default. */
  acceptsOffers: boolean | undefined;
  floorCents: number | null;
  rowClassName: string;
}) {
  const qc = useQueryClient();
  const priv = useQuery({ queryKey: ["declutter", "item-private", itemId], queryFn: () => fetchMyItemPrivate(itemId) });
  const on = acceptsOffers !== false;
  const auto = priv.data?.auto_offers === true;
  const [suggestion, setSuggestion] = useState<SuggestedFloor | null>(null);
  const done = (msg: string) => {
    toast(msg);
    void qc.invalidateQueries({ queryKey: ["declutter"] });
  };
  const rules = useMutation({
    mutationFn: (v: { accepts: boolean; auto: boolean }) => setOfferRules(itemId, v.accepts, v.auto),
    onSuccess: (_d, v) => done(!v.accepts ? "Offers are off. Buyers can still buy it." : v.auto ? "Offers are answered for you." : "Offers are on."),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const suggest = useMutation({
    mutationFn: () => requestSuggestedFloor(itemId),
    onSuccess: setSuggestion,
    onError: (err) => toast.error(suggestedReplyErrorMessage(err)),
  });
  const saveFloor = useMutation({
    mutationFn: (cents: number) => setListingPrice(itemId, priceCents, cents),
    onSuccess: (_d, cents) => {
      setSuggestion(null);
      done(`Lowest price set to ${formatPrice(cents)}.`);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const busy = rules.isPending || saveFloor.isPending;

  return (
    <>
      <li className={rowClassName} data-offer-rules="">
        <span className="flex-1 min-w-0">
          <span id={`offers-on-${itemId}`} className="block text-ds-15 font-semibold">Accept offers</span>
          <span className="block text-ds-13 text-muted-foreground">{on ? "Buyers can offer less than your price" : "Off: buyers can only buy at your price"}</span>
        </span>
        <Switch aria-labelledby={`offers-on-${itemId}`} checked={on} disabled={busy} onCheckedChange={(v) => rules.mutate({ accepts: v, auto: v && auto })} />
      </li>
      {on && (
        <li className={`${rowClassName} flex-wrap`} data-offer-floor="">
          <span className="flex-1 min-w-0">
            <span className="block text-ds-15 font-semibold">Lowest you'll take</span>
            <span className="block text-ds-13 text-muted-foreground">{floorCents == null ? "Not set" : formatPrice(floorCents)}</span>
          </span>
          {!suggestion && (
            <button type="button" className="shrink-0 text-ds-14 font-semibold text-[hsl(var(--accent-ink))] underline-offset-2" onClick={() => suggest.mutate()} disabled={suggest.isPending || busy}>
              {suggest.isPending ? "Thinking…" : "Suggest one"}
            </button>
          )}
          {suggestion && (
            <span className="basis-full flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2 text-ds-13" data-floor-suggestion="">
              <span className="min-w-0">
                Suggested: <span className="font-semibold tabular-nums">{formatPrice(suggestion.floorCents)}</span>
                {suggestion.reason ? `. ${suggestion.reason}` : ""}
              </span>
              <button type="button" className="shrink-0 font-semibold text-[hsl(var(--accent-ink))]" onClick={() => saveFloor.mutate(suggestion.floorCents)} disabled={busy}>
                Use {formatPrice(suggestion.floorCents)}
              </button>
            </span>
          )}
        </li>
      )}
      {on && (
        <li className={rowClassName} data-offer-auto="">
          <span className="flex-1 min-w-0">
            <span id={`offers-auto-${itemId}`} className="block text-ds-15 font-semibold">Answer offers for me</span>
            <span className="block text-ds-13 text-muted-foreground">Accept offers at or above your lowest price; counter lower ones with it</span>
          </span>
          <Switch aria-labelledby={`offers-auto-${itemId}`} checked={auto} disabled={busy || !priv.isSuccess} onCheckedChange={(v) => rules.mutate({ accepts: true, auto: v })} />
        </li>
      )}
    </>
  );
}
