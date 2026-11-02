/**
 * Board 117 / Q2267: "Wanted near you" and the seller's "I have this" (owner approved 2026-10-21; lead-approved
 * privacy design). Every open post near the reader (a Wanted is always visible to sellers near the poster, owner
 * 2026-10-30), through declutter_wanted_browse:
 * the poster as First L., the words, "Up to", whole miles from a point snapped to a few miles. Never an address.
 * A reply is an OFFER from one of your live listings (photos and condition come from the listing), at most their
 * Wanted price and at most your listing's price; it waits for the poster in their offers like any offer.
 * Nothing listed that fits: "List it now" opens the shared sell flow, which answers this post once the new listing
 * is live (quickListHref / answerAfterListing, owner 2026-10-30).
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { ErrorState } from "@/components/ui/ErrorState";
import { photoPublicUrl } from "@/lib/declutter/api";
import { FallbackImg } from "./FallbackImg";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";
import { blockWantedPoster, canAnswerWanted, dollarsToCents, fetchMyReplyListings, fetchWantedFromAlert, fetchWantedNear, quickListHref, replyToWanted, type WantedNear } from "@/lib/declutter/wanted";
import { focusSheetItself } from "./focusSheetItself";
import { ConfirmSheet } from "./DeclutterConfirmSheet";

const ReportDialog = lazy(() => import("@/components/ReportDialog"));


const firstName = (posterName: string) => (posterName === "A neighbor" ? "them" : posterName.split(" ")[0]);
const money = "font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]";

/**
 * Audit 10-30 #8: Report and Block on a post. A report reaches an admin. A block never cancels a job from here: when the
 * two of you share one, the server refuses and nothing changes (declutter_block_wanted_poster).
 */
function WantedPostSafety({ post, onBlocked }: { post: WantedNear; onBlocked?: () => void }) {
  const qc = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const block = useMutation({
    mutationFn: () => blockWantedPoster(post.id),
    onSuccess: () => {
      toast("Blocked. You won't see each other's Wanted posts.");
      setBlocking(false);
      onBlocked?.();
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => { setBlocking(false); toast.error(declutterErrorMessage(err)); },
  });
  const quiet = "inline-flex min-h-11 items-center text-ds-13 font-medium text-muted-foreground underline underline-offset-2";
  return (
    <div className="flex gap-4" data-wanted-safety="">
      <button type="button" className={quiet} onClick={() => setReporting(true)}>Report</button>
      <button type="button" className={quiet} onClick={() => setBlocking(true)}>Block</button>
      {reporting && (
        <Suspense fallback={null}>
          <ReportDialog open={reporting} onClose={() => setReporting(false)} reportedType="declutter_wanted" reportedId={post.id} />
        </Suspense>
      )}
      <ConfirmSheet open={blocking} title="Block this person?" confirmLabel="Block" pending={block.isPending} onConfirm={() => block.mutate()} onClose={() => setBlocking(false)} testId="wanted-block">
        You won't see each other's Wanted posts, and you can't buy from or message each other. If you have a job together, this stops and nothing changes: block them from that job, where you see any fee first.
      </ConfirmSheet>
    </div>
  );
}

function IHaveThisSheet({ post, userId, onClose, startItemId = null }: { post: WantedNear | null; userId: string; onClose: () => void; startItemId?: string | null }) {
  const qc = useQueryClient();
  // Any listing of yours for sale now can answer (audit W7); the server also checks it is inside the post's distance.
  const mine = useQuery({ queryKey: ["declutter", "reply-listings", userId, post?.id ?? null], queryFn: () => fetchMyReplyListings(userId, post!.id), enabled: !!post });
  // Audit 10-30 #12: only what Send would take is a choice; the sheet says why the others aren't.
  const listings = (mine.data ?? []).filter((i) => canAnswerWanted(i) && !i.refuses);
  const freeLeftOut = (mine.data ?? []).some((i) => !canAnswerWanted(i));
  const tooFar = (mine.data ?? []).filter((i) => canAnswerWanted(i) && i.refuses === "too_far");
  const hasOffer = (mine.data ?? []).filter((i) => canAnswerWanted(i) && i.refuses === "open_offer");
  const [bigPhoto, setBigPhoto] = useState<number | null>(null);
  const photos = post?.photo_paths?.length ? post.photo_paths : post?.photo_path ? [post.photo_path] : [];
  const [itemId, setItemId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const item = listings.find((i) => i.id === itemId) ?? null;
  const limit = post && item ? Math.min(post.max_price_cents, item.current_price_cents) : null;
  const cents = dollarsToCents(price);
  const tooHigh = cents !== null && limit !== null && cents > limit;
  const who = post ? firstName(post.poster_name) : "";
  // Audit 10-30 #6: every way out of the sheet clears the pick, or the next post opens with this listing and price.
  const clearPick = () => { setItemId(null); setPrice(""); };
  const send = useMutation({
    mutationFn: () => replyToWanted(post!.id, itemId!, cents!),
    onSuccess: () => {
      toast(`Sent. ${who === "them" ? "They have" : `${who} has`} 48 hours to accept.`);
      clearPick();
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
  // Audit 10-30 #5: from the seller's alert, their listing is already picked (when it can still answer).
  const startAt = post && startItemId && listings.some((i) => i.id === startItemId) ? startItemId : null;
  useEffect(() => {
    if (startAt) pick(startAt);
    // pick is rebuilt each render; the listing it was asked for is the trigger.
  }, [startAt]);
  return (
    <Sheet open={!!post} onOpenChange={(o) => { if (!o && !send.isPending) { clearPick(); onClose(); } }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-i-have-this="">
        <SheetHero title="I have this" />
        {post && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <p className="text-ds-12 font-semibold uppercase tracking-wide text-[hsl(var(--sage-ink))]">Wanted</p>
              <p className="text-ds-15 font-semibold [overflow-wrap:anywhere]">{post.what}</p>
              <p className="text-ds-13 text-muted-foreground">
                {/* The server already shortens (member_display_name); its own "A neighbor" fallback is a label: formatName keeps it as is. */}
                {formatName(post.poster_name === "A neighbor" ? null : post.poster_name)} · up to <span className={money}>{formatPrice(post.max_price_cents)}</span> · about {post.miles} mi away
              </p>
              {/* Audit 10-30 #19: every photo the poster added, each tap opens the shared full-screen viewer. */}
              {photos.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Photos" data-wanted-sheet-photos="">
                  {photos.map((p, i) => (
                    <li key={p}>
                      <button type="button" className="block h-20 w-20 overflow-hidden rounded-xl" aria-label={`See photo ${i + 1} of ${post.what}`} onClick={() => setBigPhoto(i)}>
                        <FallbackImg src={photoPublicUrl(p)} alt="" className="h-full w-full bg-photo-empty object-cover" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <PhotoLightbox photos={photos.map((p) => photoPublicUrl(p))} lightboxIndex={bigPhoto} setLightboxIndex={setBigPhoto} />
              <WantedPostSafety post={post} onBlocked={() => { clearPick(); onClose(); }} />
            </div>
            {mine.isLoading ? null : listings.length === 0 ? (
              <p className="text-ds-14">Nothing listed yet? List it now: add photos and a price, and it answers {who} as soon as it's live.</p>
            ) : (
              // Audit W1: the shared radio cards (labels wrap, nothing wider than the sheet), not hand-built rows.
              <div className="min-w-0 space-y-2">
                <p className="text-ds-15 font-semibold" id="wanted-reply-pick">Which of your listings?</p>
                <RadioCardList
                  label="Which of your listings?"
                  value={itemId ?? ""}
                  onChange={(v) => pick(v)}
                  options={listings.map((it) => ({ value: it.id, label: it.title, sub: <span className={money}>{itemPriceLabel(it.current_price_cents)}</span> }))}
                />
              </div>
            )}
            {!mine.isLoading && freeLeftOut && (
              <p className="text-ds-13 text-muted-foreground" data-wanted-free-note="">Free listings can't answer a Wanted, because there's no price to offer.</p>
            )}
            {tooFar.length > 0 && (
              <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]" data-wanted-too-far="">Too far for this post: {tooFar.map((i) => i.title).join(", ")}.</p>
            )}
            {hasOffer.length > 0 && (
              <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]" data-wanted-has-offer="">Has an open offer, so it can answer once that closes: {hasOffer.map((i) => i.title).join(", ")}.</p>
            )}
            {!mine.isLoading && (
              <Button asChild variant="outline" className="w-full" data-quick-list="">
                <Link to={quickListHref(post)}>{listings.length === 0 ? "List it now" : "List something new for this"}</Link>
              </Button>
            )}
            {item && (
              <div className="space-y-1">
                <label htmlFor="wanted-reply-price" className="block text-ds-15 font-semibold">Your price</label>
                <div className="flex h-12 items-center gap-1 rounded-2xl border border-input glass-field px-4 focus-within:ring-2 focus-within:ring-ring">
                  <span aria-hidden className={money}>$</span>
                  <input id="wanted-reply-price" inputMode="decimal" className={`w-full min-w-0 bg-transparent outline-none focus-visible:outline-none focus-visible:ring-0 ${money}`}
                    value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
                </div>
                <p className={`text-ds-13 ${tooHigh ? "text-destructive-ink" : "text-muted-foreground"}`} role={tooHigh ? "alert" : undefined}>
                  Up to {formatPrice(limit!)}, the lower of their Wanted price and your listing's price.
                </p>
                {cents !== null && !tooHigh && (
                  // Sellers keep the whole price; the buyer pays the buyer's fee (spec v2 §9.11). No pronouns.
                  <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-reply-note="">
                    You keep the whole <strong className="tabular-nums text-[hsl(var(--sienna-ink))]">{formatPrice(cents)}</strong>. If {who} accepts, {who === "them" ? "they pay" : `${who} pays`} and you're paid after the handover.
                  </p>
                )}
                {/* A3-80: before Send, how long the buyer has and what happens to the listing meanwhile. The reply is an
                    offer with 48 hours to answer (declutter_reply_to_wanted); anyone taking the item voids every open
                    offer on it (declutter_take_item). */}
                <p className="text-ds-13 text-muted-foreground" data-reply-meanwhile="">
                  {who === "them" ? "They have" : `${who} has`} 48 hours to accept. Your listing stays up at {formatPrice(item.current_price_cents)}; if someone else buys it first, this answer ends.
                </p>
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
  // Audit 10-30 #5: the seller's alert opens I have this on that post, with their listing picked.
  const [params, setParams] = useSearchParams();
  const answerId = params.get("answer");
  const answerItem = params.get("item");
  const [startItemId, setStartItemId] = useState<string | null>(null);
  const fromAlert = useQuery({
    queryKey: ["declutter", "wanted-from-alert", answerId, answerItem],
    queryFn: () => fetchWantedFromAlert(answerId!, answerItem!),
    enabled: !!answerId && !!answerItem,
  });
  useEffect(() => {
    if (!answerId || !answerItem || fromAlert.isLoading) return;
    if (fromAlert.data && !fromAlert.data.replied) {
      setStartItemId(answerItem);
      setReplying(fromAlert.data);
    } else if (fromAlert.data?.replied) {
      toast("You already answered this post.");
    } else {
      toast.error(fromAlert.isError ? declutterErrorMessage(fromAlert.error) : "That post has closed, or your listing is no longer close enough to answer it.");
    }
    // Used up once read, so Back or a reload doesn't open it again.
    const next = new URLSearchParams(params);
    next.delete("answer");
    next.delete("item");
    setParams(next, { replace: true });
  }, [answerId, answerItem, fromAlert.isLoading, fromAlert.data, fromAlert.isError, fromAlert.error, params, setParams]);
  // The Wanted tab is a hub (owner 2026-10-30): this section always stands, with its own empty state and error.
  return (
    <section className="space-y-2" aria-labelledby="wanted-near-title" data-wanted-near="">
      <h2 id="wanted-near-title" className="text-base font-semibold">Wanted near you</h2>
      {near.isError ? (
        <ErrorState variant="inline" title="We couldn't load posts near you." body={declutterErrorMessage(near.error)} onRetry={() => void near.refetch()} />
      ) : near.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Looking near you…</p>
      ) : (near.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground" data-wanted-near-empty="">No one near you has posted a Wanted yet. When someone does, you can answer it with one of your listings.</p>
      ) : (
      <ul className="space-y-2">
        {(near.data ?? []).map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-x-3 rounded-2xl border border-border bg-card px-4 py-3">
            {/* Owner 2026-10-30: the post's first photo of what they're looking for (20261030064727). */}
            {w.photo_path && (
              <FallbackImg src={photoPublicUrl(w.photo_path)} alt={w.what} className="h-14 w-14 shrink-0 rounded-xl bg-photo-empty object-cover" data-wanted-near-photo="" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-ds-15 font-semibold" title={w.what}>{w.what}</p>
              <p className="text-ds-13 text-muted-foreground">
                Up to <span className={money}>{formatPrice(w.max_price_cents)}</span> · {formatName(w.poster_name === "A neighbor" ? null : w.poster_name)} · {w.miles} mi
              </p>
            </div>
            {w.replied ? (
              <span className="shrink-0 text-ds-13 text-muted-foreground">Answered</span>
            ) : (
              <Button type="button" size="sm" className="shrink-0" onClick={() => setReplying(w)}>I have this</Button>
            )}
            <div className="w-full"><WantedPostSafety post={w} /></div>
          </li>
        ))}
      </ul>
      )}
      <IHaveThisSheet post={replying} userId={userId} startItemId={startItemId} onClose={() => { setReplying(null); setStartItemId(null); }} />
    </section>
  );
}
