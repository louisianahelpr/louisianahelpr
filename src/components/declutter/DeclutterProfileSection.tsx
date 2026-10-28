/**
 * Deep audit 2026-10-28 #61 (and #28's "no Declutter reviews" on the seller's profile): the Declutter reviews others
 * left a member, for builder 3 to mount on /user/:userId right under SellingNowRow (which already lists what they
 * have for sale). By side: "From buyers" (about them as a seller) and "From sellers" (about them as a buyer), each
 * with the average, the count, the most-given quick tags and the three newest comments. No reviewer names: the
 * server's read never returns who wrote a review. No visible reviews, or a viewer without Declutter (the hidden
 * switch), renders nothing; a failed read says so with Try again. A "sold" count needs a server read first.
 */
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useFeature } from "@/hooks/useFeature";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchProfileReviews, reviewSummary, type ProfileReview } from "@/lib/declutter/profile";
import { topReviewTags } from "@/lib/declutter/reviewTags";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/Chicago" });

function ReviewGroup({ title, reviews }: { title: string; reviews: ProfileReview[] }) {
  const sum = reviewSummary(reviews);
  if (!sum) return null;
  const tags = topReviewTags(reviews.map((r) => r.tags));
  const words = reviews.filter((r) => r.comment && r.comment.trim()).slice(0, 3);
  return (
    <div className="space-y-2" data-profile-reviews={title}>
      <p className="flex flex-wrap items-center gap-x-1.5 text-ds-14">
        <span className="font-semibold text-foreground">{title}</span>
        <Star className="h-3.5 w-3.5 fill-primary text-primary" aria-hidden />
        <span className="font-semibold tabular-nums">{sum.avg.toFixed(1)}</span>
        <span className="text-muted-foreground">
          <span className="sr-only"> stars from </span>
          <span aria-hidden>·</span> {sum.count} review{sum.count === 1 ? "" : "s"}
        </span>
      </p>
      {tags.length > 0 && <p className="text-ds-13 text-foreground">{tags.map((t) => `${t.label} (${t.count})`).join(" · ")}</p>}
      {words.length > 0 && (
        <ul className="space-y-2">
          {words.map((r) => (
            <li key={r.id} className="rounded-xl bg-muted/50 px-3 py-2 text-ds-14">
              <p className="[overflow-wrap:anywhere]">{r.comment!.trim()}</p>
              <p className="mt-0.5 text-ds-12 text-muted-foreground">
                {r.stars} star{r.stars === 1 ? "" : "s"} · {monthYear(r.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DeclutterProfileSection({ userId }: { userId: string }) {
  const on = useFeature("declutter");
  const reviews = useQuery({ queryKey: ["declutter", "profile-reviews", userId], queryFn: () => fetchProfileReviews(userId), enabled: on });

  if (!on || reviews.isLoading) return null;
  if (reviews.isError) {
    return (
      <section aria-label="Declutter reviews" className="rounded-2xl border border-border bg-card p-4" data-profile-declutter="error">
        <ErrorState variant="inline" title="We couldn't load their Declutter reviews." body={declutterErrorMessage(reviews.error)} onRetry={() => void reviews.refetch()} />
      </section>
    );
  }
  const all = reviews.data ?? [];
  if (all.length === 0) return null;
  return (
    // The same eyebrow and glass surface as its sibling SellingNowRow ("SELLING NOW · 3") right above it.
    <section aria-labelledby={`profile-declutter-${userId}`} className="space-y-2" data-profile-declutter="">
      <h2 id={`profile-declutter-${userId}`} className="font-sans uppercase tracking-wider text-ds-11 font-semibold" style={{ color: "hsl(var(--olivewood) / 0.75)", letterSpacing: "0.14em" }}>
        Declutter reviews · {all.length}
      </h2>
      <div className="space-y-4 rounded-2xl liquid-glass p-4">
        <ReviewGroup title="From buyers" reviews={all.filter((r) => r.reviewer_side === "buyer")} />
        <ReviewGroup title="From sellers" reviews={all.filter((r) => r.reviewer_side === "seller")} />
      </div>
    </section>
  );
}
