/**
 * Shop reviews (Shops H9, migration 20261105230819; spec L46, L70). After a handover either side of the order leaves
 * one review: the buyer about the shop, the shop about the buyer ("Leave a review" on the order card, the same olive
 * StarRow sheet as Declutter's). Reviews stay hidden until both sides reviewed or 14 days after the handover. The shop
 * page shows its buyers' reviews and the shop's own rating, which appears only at 3 or more reviews. A low review is
 * never hidden for being low (16 CFR 465.7). Q1948 (L46): each review on the page has "Report" (ReportDialog type
 * 'shop_review'); the database takes only a review the member is shown, never their own words, and an admin can take it
 * down from the reports queue (shops_admin_remove_review, migration 20261112094500).
 */
import { lazy, Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StarRow } from "@/components/reviewPanel/StarRow";
import { ErrorState } from "@/components/ui/ErrorState";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { focusSheetItself } from "@/components/declutter/focusSheetItself";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { fetchMyOrderReview, fetchShopReviews, leaveShopReview, myOrderReviewKey, shopReviewsKey } from "@/lib/shops/reviews";
import { ShopCard } from "./ShopProfile";
import { ShopRating } from "./shopsUi";
import { ReviewStars } from "@/components/profile/reviewCard";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enShopsBrowse";

const ReportDialog = lazy(() => import("@/components/ReportDialog"));

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/Chicago" });

/** "Leave a review" on a handed-over order's card, for either side. Nothing before the handover. */
export function ShopOrderReview({ orderId, handedOver }: { orderId: string; handedOver: boolean }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: myOrderReviewKey(orderId), queryFn: () => fetchMyOrderReview(orderId), enabled: handedOver });
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const send = useMutation({
    mutationFn: () => leaveShopReview(orderId, stars, comment.trim() || null),
    onSuccess: () => {
      setOpen(false);
      toast(t("shb.rev.thanks"));
      void qc.invalidateQueries({ queryKey: myOrderReviewKey(orderId) });
      void qc.invalidateQueries({ queryKey: ["shops", "reviews"] });
    },
    onError: (err) => {
      if ((err as { message?: unknown })?.message === "already_reviewed") void qc.invalidateQueries({ queryKey: myOrderReviewKey(orderId) });
      toast.error(shopsErrorMessage(err));
    },
  });
  if (!handedOver || !state.data) return null;
  if (state.data.mine) return <p className="text-ds-13 text-muted-foreground" data-shop-review-sent="">{t("shb.rev.sent")}</p>;
  if (!state.data.can_review) return null;
  const buyer = state.data.side === "buyer";
  return (
    <>
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)} data-shop-review-open="">
        {t("shb.rev.leave")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-shop-review-sheet="">
          <SheetHero title={t("shb.rev.leave")} />
          <div className="flex flex-col items-center gap-3 pt-1 text-center">
            <p className="text-ds-20 font-bold leading-snug">{buyer ? t("shb.rev.howShop") : t("shb.rev.howBuyer")}</p>
            <StarRow value={stars} onChange={setStars} label={t("shb.rev.stars")} />
          </div>
          <div className="space-y-2 pt-4">
            <label htmlFor={`shop-review-${orderId}`} className="block text-ds-15 font-semibold">
              {t("shb.rev.words")} <span className="font-normal text-muted-foreground">{t("shb.rev.optional")}</span>
            </label>
            <Textarea
              id={`shop-review-${orderId}`}
              className="w-full min-w-0 rounded-2xl border border-input bg-card px-4 py-3 text-ds-15 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              maxLength={1000}
              rows={3}
              value={comment}
              placeholder={buyer ? t("shb.rev.phShop") : t("shb.rev.phBuyer")}
              onChange={(e) => setComment(e.target.value)}
            />
            <p className="text-ds-13 text-muted-foreground">{t("shb.rev.shows")}</p>
          </div>
          <SheetFooter>
            <SheetPrimaryAction disabled={send.isPending || stars === 0} onClick={() => send.mutate()}>
              {t("shb.rev.send")}
            </SheetPrimaryAction>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The shop page's reviews: its buyers' public reviews and the shop's own rating (shown at 3 or more). */
export function ShopReviewsCard({ shopId }: { shopId: string }) {
  const { t } = useLanguage();
  const reviews = useQuery({ queryKey: shopReviewsKey(shopId), queryFn: () => fetchShopReviews(shopId) });
  const [reporting, setReporting] = useState<string | null>(null);
  const d = reviews.data;
  return (
    <ShopCard id="shop-reviews" title={t("shb.rev.title")}>
      {reviews.isError ? (
        <ErrorState variant="inline" title={t("shb.rev.loadFailed")} body={shopsErrorMessage(reviews.error)} onRetry={() => void reviews.refetch()} />
      ) : reviews.isPending || !d ? (
        <p className="text-ds-13 text-muted-foreground" role="status">{t("shb.rev.loading")}</p>
      ) : d.reviews.length === 0 ? (
        <p className="text-ds-13 text-muted-foreground">{t("shb.rev.none")}</p>
      ) : (
        <div className="space-y-3" data-shop-reviews="">
          <ShopRating rating={d.rating} count={d.review_count} />
          <ul className="divide-y divide-border">
            {d.reviews.map((r) => (
              // S052 (Shops audit 11-12): the profile review row's star icons (ReviewStars, "N of 5 stars" for screen
              // readers) and date on top, the words under them; it was the gray text "5 stars · Nov 2026" under them.
              // The buyer's first name needs shops_shop_reviews to return it (a server change, not made here).
              <li key={r.id} className="py-2 text-ds-14" data-shop-review-row="">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <ReviewStars rating={r.stars} />
                    <span className="text-ds-12 text-muted-foreground">{monthYear(r.created_at)}</span>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="shrink-0 pl-4 pr-0 text-ds-13 font-normal text-muted-foreground" onClick={() => setReporting(r.id)} data-report="shop_review">
                    {t("shb.rev.report")}
                  </Button>
                </div>
                {r.comment && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{r.comment}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {reporting && (
        <Suspense fallback={null}>
          <ReportDialog open onClose={() => setReporting(null)} reportedType="shop_review" reportedId={reporting} />
        </Suspense>
      )}
    </ShopCard>
  );
}
