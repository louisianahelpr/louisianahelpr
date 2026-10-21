/**
 * Board 117 / Q2267: "Wanted near you" and the seller's "I have this" (owner approved 2026-10-21; lead-approved
 * privacy design). Only posts whose poster turned replies on, near the reader, through declutter_wanted_browse:
 * the poster as First L., the words, "Up to", whole miles from a point snapped to a few miles. Never an address.
 * A reply is an OFFER from one of your live listings (photos and condition come from the listing), at most their
 * Wanted price and at most your listing's price; it waits for the poster in their offers like any offer.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { dollarsToCents, fetchMyReplyListings, fetchWantedNear, replyToWanted, type WantedNear } from "@/lib/declutter/wanted";

const firstName = (posterName: string) => (posterName === "A neighbor" ? "them" : posterName.split(" ")[0]);
const money = "font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]";

function IHaveThisSheet({ post, userId, onClose }: { post: WantedNear | null; userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  // Only a listing for sale now, taking offers, can answer (the server checks the same).
  const mine = useQuery({ queryKey: ["declutter", "reply-listings", userId], queryFn: () => fetchMyReplyListings(userId), enabled: !!post });
  const listings = mine.data ?? [];
  const [itemId, setItemId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const item = listings.find((i) => i.id === itemId) ?? null;
  const limit = post && item ? Math.min(post.max_price_cents, item.current_price_cents) : null;
  const cents = dollarsToCents(price);
  const tooHigh = cents !== null && limit !== null && cents > limit;
  const who = post ? firstName(post.poster_name) : "";
  const send = useMutation({
    mutationFn: () => replyToWanted(post!.id, itemId!, cents!),
    onSuccess: () => {
      toast.success(`Sent. ${who === "them" ? "They have" : `${who} has`} 48 hours to accept.`);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      onClose();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const pick = (id: string) => {
    setItemId(id);
    const it = listings.find((i) => i.id === id);
    if (post && it) setPrice(String(Math.min(post.max_price_cents, it.current_price_cents) / 100));
  };
  return (
    <Sheet open={!!post} onOpenChange={(o) => { if (!o && !send.isPending) { setItemId(null); setPrice(""); onClose(); } }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[90dvh] overflow-y-auto" data-i-have-this="">
        <SheetHero title="I have this" />
        {post && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <p className="text-ds-12 font-semibold uppercase tracking-wide text-[hsl(var(--sage-ink))]">Wanted</p>
              <p className="text-ds-15 font-semibold [overflow-wrap:anywhere]">{post.what}</p>
              <p className="text-ds-13 text-muted-foreground">
                {post.poster_name} · up to <span className={money}>{formatPrice(post.max_price_cents)}</span> · about {post.miles} mi away
              </p>
            </div>
            {mine.isLoading ? null : listings.length === 0 ? (
              <p className="text-ds-14">
                Answer with one of your listings. <Link to="/declutter/sell" className="font-semibold underline underline-offset-2">List the item first</Link>, then come back.
              </p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="text-ds-15 font-semibold">Which of your listings?</legend>
                {listings.map((it) => (
                  <label key={it.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-border px-4 py-2">
                    <input type="radio" name="wanted-reply-item" checked={itemId === it.id} onChange={() => pick(it.id)} />
                    <span className="min-w-0 flex-1 truncate text-ds-14" title={it.title}>{it.title}</span>
                    <span className={`shrink-0 text-ds-14 ${money}`}>{formatPrice(it.current_price_cents)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {item && (
              <div className="space-y-1">
                <label htmlFor="wanted-reply-price" className="block text-ds-15 font-semibold">Your price</label>
                <div className="flex h-12 items-center gap-1 rounded-2xl border border-input glass-field px-4 focus-within:ring-2 focus-within:ring-ring">
                  <span aria-hidden className={money}>$</span>
                  <input id="wanted-reply-price" inputMode="decimal" className={`w-full min-w-0 bg-transparent outline-none ${money}`}
                    value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
                </div>
                <p className={`text-ds-13 ${tooHigh ? "text-destructive" : "text-muted-foreground"}`} role={tooHigh ? "alert" : undefined}>
                  At most {formatPrice(limit!)}: their Wanted price and your listing's price.
                </p>
                {cents !== null && !tooHigh && (
                  // Sellers keep the whole price; the buyer pays the buyer's fee (spec v2 §9.11). No pronouns.
                  <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-reply-note="">
                    You keep the whole <strong className="tabular-nums text-[hsl(var(--sienna-ink))]">{formatPrice(cents)}</strong>. If {who} accepts, {who === "them" ? "they pay" : `${who} pays`} and you're paid after the handover.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <SheetFooter>
          <SheetPrimaryAction disabled={!item || cents === null || cents < 100 || tooHigh || send.isPending} onClick={() => send.mutate()}>
            {cents !== null && item && !tooHigh ? `Send to ${who === "them" ? "the buyer" : who} · ${formatPrice(cents)}` : "Send"}
          </SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function WantedNearSection({ at, userId }: { at: { lat: number; lng: number }; userId: string }) {
  const near = useQuery({ queryKey: ["declutter", "wanted-near", at.lat, at.lng], queryFn: () => fetchWantedNear(at) });
  const [replying, setReplying] = useState<WantedNear | null>(null);
  // Nothing to show is the empty state: the section stays out of the way (and before the migration, [] hides it).
  if (near.isError || !near.data || near.data.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="wanted-near-title" data-wanted-near="">
      <h2 id="wanted-near-title" className="text-base font-semibold">Wanted near you</h2>
      <ul className="space-y-2">
        {near.data.map((w) => (
          <li key={w.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-ds-15 font-semibold" title={w.what}>{w.what}</p>
              <p className="text-ds-13 text-muted-foreground">
                Up to <span className={money}>{formatPrice(w.max_price_cents)}</span> · {w.poster_name} · {w.miles} mi
              </p>
            </div>
            {w.replied ? (
              <span className="shrink-0 text-ds-13 text-muted-foreground">Answered</span>
            ) : (
              <Button type="button" size="sm" className="shrink-0" onClick={() => setReplying(w)}>I have this</Button>
            )}
          </li>
        ))}
      </ul>
      <IHaveThisSheet post={replying} userId={userId} onClose={() => setReplying(null)} />
    </section>
  );
}
