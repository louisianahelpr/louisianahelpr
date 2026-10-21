/**
 * Board 163: leave a review after a Declutter sale, both ways (spec v2 §9.32).
 * The order card shows "Leave a review"; the sheet asks "How was buying from
 * Lexi?" (or "selling to Tommy?"), olive stars, a few optional words.
 *
 * Truth calls (board vs live rules):
 *  - The board's quick chips ("As described", "Paid fast"…) are NOT shown:
 *    declutter_leave_review stores only stars and a comment, so a chip would
 *    be a claim we drop. They need a migration (hard phase).
 *  - Reviews show once both sides review, or 14 days after the handover
 *    (declutter_visible_reviews), not the board's 7.
 *  - The other person's first name comes from their public profile; without
 *    one it reads "the seller" / "the buyer", never a pronoun.
 * Stars are olive (spec §1.1: rust is money only): the same --primary as
 * src/lib/starColor.ts on the shell branch.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import UserAvatar from "@/components/UserAvatar";
import { fetchSellerCard } from "@/lib/declutter/api";
import { leaveReview } from "@/lib/declutter/handover";
import { fetchOrderOtherPerson } from "@/lib/declutter/reviews";
import { declutterErrorMessage } from "@/lib/declutter/errors";

const REVIEW_SHOWS = "Reviews show once you both leave one, or after 14 days.";

export function DeclutterReviewForm({ orderId, side, userId }: { orderId: string; side: "buyer" | "seller"; userId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const other = useQuery({ queryKey: ["declutter", "order-other", orderId], queryFn: () => fetchOrderOtherPerson(orderId, userId) });
  const otherId = other.data ?? null;
  const card = useQuery({
    queryKey: ["declutter", "seller-card", otherId],
    queryFn: () => fetchSellerCard(otherId!),
    enabled: !!otherId,
  });
  const first = (card.data?.name ?? "").trim().split(/\s+/)[0] || null;
  const who = first ?? (side === "buyer" ? "the seller" : "the buyer");
  const send = useMutation({
    mutationFn: (args: { stars: number; comment: string | null }) => leaveReview(orderId, args.stars, args.comment),
    onSuccess: () => {
      setSent(true);
      setOpen(false);
      toast.success(`Thanks. ${REVIEW_SHOWS}`);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => {
      // Reviewed before (another device, or before a reload): the card stops offering it.
      if ((err as { message?: unknown })?.message === "already_reviewed") {
        setSent(true);
        setOpen(false);
      }
      toast.error(declutterErrorMessage(err));
    },
  });

  if (sent) return <p className="text-sm text-muted-foreground" data-review-sent="">Review sent. {REVIEW_SHOWS}</p>;
  return (
    <>
      <Button type="button" className="w-full" onClick={() => setOpen(true)}>
        Leave a review
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" floor onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[90dvh] overflow-y-auto" data-review-sheet="">
          <SheetHero title="Leave a review" />
          <div className="flex flex-col items-center gap-3 pt-1 text-center">
            {otherId && <UserAvatar userId={otherId} src={card.data?.avatarUrl ?? null} name={card.data?.name ?? who} className="h-14 w-14" />}
            <p className="text-ds-20 font-bold leading-snug [overflow-wrap:anywhere]">
              How was {side === "buyer" ? "buying from" : "selling to"} {who}?
            </p>
            <div role="radiogroup" aria-label="Stars" className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={stars === n}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setStars(n)}
                >
                  <Star className={`h-8 w-8 ${n <= stars ? "fill-primary text-primary" : "text-muted-foreground"}`} aria-hidden />
                </button>
              ))}
            </div>
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
            <SheetPrimaryAction disabled={send.isPending || stars === 0} onClick={() => send.mutate({ stars, comment: comment.trim() || null })}>
              Send review
            </SheetPrimaryAction>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
