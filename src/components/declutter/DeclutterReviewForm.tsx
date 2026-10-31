/**
 * Board 163: leave a review after a Declutter sale, both ways (spec v2 §9.32).
 * The order card shows "Leave a review"; the sheet asks "How was buying from
 * Lexi?" (or "selling to Tommy?"), olive stars, a few optional words.
 *
 * Truth calls (board vs live rules):
 *  - The board's quick chips (Q2265, migration 20261021023530): a fixed list
 *    per side (src/lib/declutter/reviewTags.ts = declutter_review_tags_for),
 *    stored with the review and shown under the same blind rule.
 *  - Reviews show once both sides review, or 14 days after the handover
 *    (declutter_visible_reviews), not the board's 7.
 *  - The other person's first name comes from their public profile; without
 *    one it reads "the seller" / "the buyer", never a pronoun.
 * Stars are olive (spec §1.1: rust is money only): the same --primary as
 * src/lib/starColor.ts on the shell branch.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StarRow } from "@/components/reviewPanel/StarRow";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import UserAvatar from "@/components/UserAvatar";
import { leaveReview } from "@/lib/declutter/handover";
import { useOrderOtherPerson } from "./useOrderOtherPerson";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { REVIEW_TAGS } from "@/lib/declutter/reviewTags";
import { fetchRefundRequestView, refundedInFull, refundHoldsTheItem, type RefundRequestView } from "@/lib/declutter/refundRequests";
import { clearReviewPrompt, reviewPromptWaiting } from "@/lib/declutter/reviewPrompt";
import { focusSheetItself } from "./focusSheetItself";

const REVIEW_SHOWS = "Reviews show once you both leave one, or after 14 days.";

/**
 * Deep audit 2026-10-28 SH-4 (#16): "Leave a review" came back after a reload (the sent state lived only in the
 * component) and reopened an empty form that failed with already_reviewed. The server has no read of "did I review
 * this order" for members yet (declutter_reviews is service-role only), so this device remembers each order it saw
 * reviewed (a send, or the server's already_reviewed); another device still learns it on its first try.
 */
const reviewedKey = (orderId: string, side: "buyer" | "seller") => `declutter-reviewed:${orderId}:${side}`;
function rememberedReviewed(orderId: string, side: "buyer" | "seller"): boolean {
  try {
    return localStorage.getItem(reviewedKey(orderId, side)) === "1";
  } catch (err) {
    // Storage blocked (private mode): the button shows, and the server still refuses a second review.
    console.warn("[declutter] could not read the reviewed mark", err);
    return false;
  }
}
function rememberReviewed(orderId: string, side: "buyer" | "seller") {
  try {
    localStorage.setItem(reviewedKey(orderId, side), "1");
  } catch (err) {
    console.warn("[declutter] could not save the reviewed mark", err);
  }
}

/**
 * Audit 1028 part 2, D2-15: a solid "Leave a review" under an open refund request pulled the eye from the refund
 * itself. While a request is still being worked out the button is the outline one. The refund panel's own read
 * (same key, same fetch, so one request on the wire), only when the card shows the refund panel.
 * Audit BUY-31: while the item is going back, with Louisiana Helpr, or under an open problem, no review is asked for.
 * It comes back when that ends and the order still stands.
 */
const REFUND_STILL_OPEN: ReadonlySet<string> = new Set(["open", "offered"]);
const refundStillOpen = (v: RefundRequestView | undefined) => !!v?.request && REFUND_STILL_OPEN.has(v.request.status);

export function DeclutterReviewForm({ orderId, side, userId, refundPanel = false, problemOpen = false }: {
  orderId: string;
  side: "buyer" | "seller";
  userId: string;
  /** The card shows the refund panel for this order (its switch is on and the order has items). */
  refundPanel?: boolean;
  /** An open problem on this order (BUY-31). */
  problemOpen?: boolean;
}) {
  const refund = useQuery({
    queryKey: ["declutter", "refund-request", orderId],
    queryFn: () => fetchRefundRequestView(orderId),
    enabled: refundPanel,
  });
  const qc = useQueryClient();
  // UX-7: right after this buyer's "I got it" the sheet opens by itself (src/lib/declutter/reviewPrompt.ts).
  const [open, setOpen] = useState(() => side === "buyer" && !rememberedReviewed(orderId, side) && reviewPromptWaiting(orderId));
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [sent, setSent] = useState(() => rememberedReviewed(orderId, side));
  const { otherId, name, avatarUrl, who } = useOrderOtherPerson(orderId, userId, side);
  const send = useMutation({
    mutationFn: (args: { stars: number; comment: string | null; tags: string[] }) => leaveReview(orderId, args.stars, args.comment, args.tags),
    onSuccess: (r) => {
      rememberReviewed(orderId, side);
      setSent(true);
      setOpen(false);
      toast(r.tagsDropped ? `Thanks. Your tags couldn't be saved yet. ${REVIEW_SHOWS}` : `Thanks. ${REVIEW_SHOWS}`);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => {
      // Reviewed before (another device, or before a reload): the card stops offering it.
      if ((err as { message?: unknown })?.message === "already_reviewed") {
        rememberReviewed(orderId, side);
        setSent(true);
        setOpen(false);
      }
      toast.error(declutterErrorMessage(err));
    },
  });

  useEffect(() => {
    if (open || sent) clearReviewPrompt(orderId);
  }, [open, sent, orderId]);

  if (sent) return <p className="text-sm text-muted-foreground" data-review-sent="">Review sent. {REVIEW_SHOWS}</p>;
  // NIGHT-SELL-soldstates-7: a sale refunded in full was undone, so the card asks for no review.
  if (problemOpen || refundHoldsTheItem(refund.data?.request?.status) || refundedInFull(refund.data)) return null;
  return (
    <>
      {/* Full width on a phone; from sm it sizes to its words like the card's other buttons (deep audit #51: a ~1100px bar at 1440). */}
      <Button type="button" variant={refundStillOpen(refund.data) ? "outline" : "default"} className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        Leave a review
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-review-sheet="">
          <SheetHero title="Leave a review" />
          <div className="flex flex-col items-center gap-3 pt-1 text-center">
            {otherId && <UserAvatar userId={otherId} src={avatarUrl} name={name ?? who} className="h-14 w-14" />}
            <p className="text-ds-20 font-bold leading-snug [overflow-wrap:anywhere]">
              How was {side === "buyer" ? "buying from" : "selling to"} {who}?
            </p>
            <StarRow value={stars} onChange={setStars} label="Stars" />
          </div>
          {/* Board 163: quick tags, this side's fixed list; selected ones wear the primary olive. */}
          <div role="group" aria-label="Quick tags" className="flex flex-wrap justify-center gap-2 pt-4" data-review-tags="">
            {REVIEW_TAGS[side].map(([tag, label]) => {
              const on = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  className={`min-h-11 rounded-full px-4 text-ds-14 font-semibold ${on ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "border border-border bg-card"}`}
                  onClick={() => setTags((t) => (on ? t.filter((x) => x !== tag) : [...t, tag]))}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="space-y-2 pt-4">
            <label htmlFor={`dcl-review-${orderId}`} className="block text-ds-15 font-semibold">
              A few words <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id={`dcl-review-${orderId}`}
              className="w-full min-w-0 rounded-2xl border border-input bg-card px-4 py-3 text-ds-15 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              maxLength={1000}
              rows={3}
              value={comment}
              placeholder="Shown on their profile"
              onChange={(e) => setComment(e.target.value)}
            />
            <p className="text-ds-13 text-muted-foreground">{REVIEW_SHOWS}</p>
          </div>
          <SheetFooter>
            <SheetPrimaryAction disabled={send.isPending || stars === 0} onClick={() => send.mutate({ stars, comment: comment.trim() || null, tags })}>
              Send review
            </SheetPrimaryAction>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
