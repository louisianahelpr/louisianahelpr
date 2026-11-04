/**
 * Q2268 bundle requests (Board 161, migration 20261104103528), both sides:
 *  - BundleAsk (the item page, under "More from this seller"): the buyer ticks this item and others of the same
 *    seller and taps "Ask for these": one ask, the seller has 48 hours to answer.
 *  - BundleRequestsSection side="seller" (Selling, with the offers to answer): each open ask with its items ticked,
 *    and Accept all / Accept picked / Decline. Accepted items go to the buyer's cart (24 hours to pay, BUY-1).
 *  - BundleRequestsSection side="buyer" (Buying): what became of each ask from the last 7 days.
 * Nothing is charged on any of these screens; the buyer pays at the existing one-seller checkout.
 * Before the migration is on the server every read is null and nothing shows.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { DeclutterItem } from "@/lib/declutter/api";
import { bundleErrorMessage } from "@/lib/declutter/bundleErrors";
import { itemPriceLabel } from "@/lib/declutter/distance";
import {
  BUNDLE_MAX_ITEMS,
  BUNDLE_MIN_ITEMS,
  answerBundle,
  bundleAskMissing,
  bundleTotalCents,
  buyerStatusWords,
  fetchBundleRequests,
  requestBundle,
  whenWords,
  withdrawBundle,
  type BundleRequest,
} from "@/lib/declutter/bundleRequest";

const KEY = ["declutter", "bundle-requests"] as const;

function useBundleRequests(side: "buyer" | "seller", userId: string | null) {
  return useQuery({
    queryKey: [...KEY, side, userId],
    queryFn: () => fetchBundleRequests(side, userId as string),
    enabled: !!userId,
  });
}

/** Selling's "To answer" chip counts the open asks too (the same read and key the section uses: no extra request). */
export function useBundleAsksToAnswer(userId: string | null): number {
  return useBundleRequests("seller", userId).data?.length ?? 0;
}

/** Items a bundle ask can hold: on sale now, with a price (free items are claimed on their own). */
function askable(it: DeclutterItem): boolean {
  return it.status === "live" && it.current_price_cents >= 100;
}

/** The buyer's "Ask for these" on an item page: this item plus the seller's other live items. */
export function BundleAsk({ item, others, viewerId }: { item: DeclutterItem; others: DeclutterItem[]; viewerId: string | null }) {
  const qc = useQueryClient();
  const choices = useMemo(() => [item, ...others].filter(askable).slice(0, BUNDLE_MAX_ITEMS), [item, others]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set([item.id]));
  const [missing, setMissing] = useState(false);
  const mine = useBundleRequests("buyer", viewerId);
  const openAsk = (mine.data ?? []).find((r) => r.seller_id === item.seller_id && r.status === "open" && new Date(r.respond_by).getTime() > Date.now());
  const ask = useMutation({
    mutationFn: () => requestBundle([...picked]),
    onSuccess: () => {
      toast("Asked. The seller has 48 hours to answer. Nothing is charged until you pay.");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => {
      if (bundleAskMissing(err)) { setMissing(true); return; }
      toast.error(bundleErrorMessage(err));
    },
  });
  if (!viewerId || viewerId === item.seller_id || missing || mine.data === null || choices.length < BUNDLE_MIN_ITEMS || !askable(item)) return null;
  if (openAsk) {
    return (
      <p data-bundle-ask-open="" className="rounded-2xl border border-border bg-card p-3 text-sm">
        <span className="font-semibold">You asked this seller for {openAsk.items.length} items.</span>{" "}
        {buyerStatusWords(openAsk)} See it in Buying.
      </p>
    );
  }
  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="wrap"
        data-bundle-ask-start=""
        onClick={() => setOpen(true)}
        className="w-full justify-start gap-3 border border-dashed border-border px-4 py-3 text-left text-sm font-normal"
      >
        <Layers className="text-primary" aria-hidden />
        <span><span className="font-semibold">Want several?</span> Ask the seller for them in one request.</span>
      </Button>
    );
  }
  const pickedItems = choices.filter((c) => picked.has(c.id));
  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <section data-bundle-ask="" aria-labelledby="bundle-ask-title" className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="space-y-1">
        <h2 id="bundle-ask-title" className="text-base font-semibold">Ask for several items</h2>
        <p className="text-sm text-muted-foreground">
          Pick 2 or more. The seller accepts all or some within 48 hours; accepted items go to your cart for one checkout and one pickup.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {choices.map((c) => (
          <li key={c.id}>
            <label className="flex min-h-11 items-center gap-3 py-2 text-sm">
              <Checkbox checked={picked.has(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} aria-label={c.title} />
              <span className="min-w-0 flex-1 line-clamp-2 break-words">{c.title}</span>
              <span className="shrink-0 font-semibold tabular-nums">{itemPriceLabel(c.current_price_cents)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Not now</Button>
        <Button
          type="button"
          data-bundle-ask-send=""
          className="btn-grad-primary"
          disabled={pickedItems.length < BUNDLE_MIN_ITEMS || ask.isPending}
          onClick={() => ask.mutate()}
        >
          {pickedItems.length < BUNDLE_MIN_ITEMS ? "Pick 2 or more" : `Ask for these ${pickedItems.length} (${itemPriceLabel(bundleTotalCents(pickedItems.map((p) => ({ price_cents: p.current_price_cents }))))})`}
        </Button>
      </div>
    </section>
  );
}

function ItemLines({ r, pick, onPick }: { r: BundleRequest; pick?: Set<string>; onPick?: (id: string, on: boolean) => void }) {
  return (
    <ul className="divide-y divide-border">
      {r.items.map((i) => (
        <li key={i.item_id} data-bundle-request-item="">
          <label className="flex min-h-11 items-center gap-3 py-2 text-sm">
            {pick && onPick && (
              <Checkbox checked={pick.has(i.item_id)} onCheckedChange={(v) => onPick(i.item_id, v === true)} aria-label={i.title ?? "An item"} />
            )}
            <span className="min-w-0 flex-1 line-clamp-2 break-words">{i.title ?? "An item"}</span>
            {!pick && i.outcome && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {i.outcome === "accepted" ? "In your cart" : i.outcome === "unavailable" ? "Sold meanwhile" : "Not picked"}
              </span>
            )}
            <span className="shrink-0 font-semibold tabular-nums">{itemPriceLabel(i.price_cents)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function SellerRequest({ r }: { r: BundleRequest }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState<Set<string>>(() => new Set(r.items.map((i) => i.item_id)));
  const answer = useMutation({
    mutationFn: (ids: string[] | null) => answerBundle(r.id, ids),
    onSuccess: (n, ids) => {
      // -1: the buyer has no card saved; they were asked to save one and the request stays open (review 11-04).
      toast(ids !== null && ids.length === 0 ? "Declined. The buyer is told."
        : n < 0 ? "The buyer has no card saved yet. We asked them to add one; answer again once they do."
        : `Accepted ${n}. The buyer has 24 hours to pay.`);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(bundleErrorMessage(err)),
  });
  const all = pick.size === r.items.length;
  const onPick = (id: string, on: boolean) => setPick((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <li data-bundle-request-seller={r.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm">
        <span className="font-semibold">A buyer wants {r.items.length} of your items</span> ({itemPriceLabel(bundleTotalCents(r.items))} in all).
        {" "}Answer by {whenWords(r.respond_by)}.
      </p>
      <ItemLines r={r} pick={pick} onPick={onPick} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" data-bundle-accept-all="" className="btn-grad-primary" disabled={answer.isPending} onClick={() => answer.mutate(null)}>
          Accept all
        </Button>
        <Button
          type="button"
          variant="outline"
          data-bundle-accept-picked=""
         
          disabled={answer.isPending || all || pick.size === 0}
          onClick={() => answer.mutate([...pick])}
        >
          {all || pick.size === 0 ? "Pick some" : `Accept ${pick.size} picked`}
        </Button>
        <Button type="button" variant="ghost" data-bundle-decline="" disabled={answer.isPending} onClick={() => answer.mutate([])}>
          Decline
        </Button>
      </div>
    </li>
  );
}

function BuyerRequest({ r }: { r: BundleRequest }) {
  const qc = useQueryClient();
  const live = r.status === "open" && new Date(r.respond_by).getTime() > Date.now();
  const back = useMutation({
    mutationFn: () => withdrawBundle(r.id),
    onSuccess: () => { toast("Taken back. The seller won't see it anymore."); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (err) => toast.error(bundleErrorMessage(err)),
  });
  return (
    <li data-bundle-request-buyer={r.id} data-bundle-status={r.status} className="space-y-2 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm"><span className="font-semibold">You asked for {r.items.length} items.</span> {buyerStatusWords(r)}</p>
      <ItemLines r={r} />
      {live && (
        <Button type="button" variant="outline" data-bundle-withdraw="" disabled={back.isPending} onClick={() => back.mutate()}>
          Take it back
        </Button>
      )}
    </li>
  );
}

/** Selling: the asks left to answer. Buying: what became of each ask (7 days). Nothing at all when there is none. */
export function BundleRequestsSection({ side, userId }: { side: "buyer" | "seller"; userId: string | null }) {
  const q = useBundleRequests(side, userId);
  const rows = q.data ?? [];
  // A failed read says nothing here: the offers and orders around it are what the tab is for.
  if (!rows.length) return null;
  return (
    <section className="space-y-2" aria-label={side === "seller" ? "Bundle requests to answer" : "Your bundle requests"} data-bundle-requests={side}>
      <h2 className="text-base font-semibold">{side === "seller" ? "Bundle requests to answer" : "Your bundle requests"}</h2>
      <ul className="space-y-3">
        {rows.map((r) => (side === "seller" ? <SellerRequest key={r.id} r={r} /> : <BuyerRequest key={r.id} r={r} />))}
      </ul>
    </section>
  );
}
