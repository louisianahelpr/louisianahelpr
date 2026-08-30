import { Star, ChevronDown } from "lucide-react";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { formatShortDate, formatCategory } from "@/lib/format";
import type { ProfileReview } from "./types";

type RatingFilter = "all" | "5" | "4" | "low";

type Props = {
  reviews: ProfileReview[];
  isOwnProfile: boolean;
  profileFullName: string | null;
  reviewCategoryFilter: string | null;
  reviewRatingFilter: RatingFilter;
  reviewVisibleCount: number;
  onSetReviewCategoryFilter: (value: string | null) => void;
  onSetReviewRatingFilter: (value: RatingFilter) => void;
  onSetReviewVisibleCount: (updater: (n: number) => number) => void;
  onResetVisibleCount: (value: number) => void;
  respondingToReview: string | null;
  responseText: string;
  onSetResponseText: (value: string) => void;
  onStartResponding: (reviewId: string, initial: string) => void;
  onCancelResponding: () => void;
  onSaveResponse: (reviewId: string) => void;
  savingResponse: boolean;
  reviewsHasMore: boolean;
  /** Server-side total (the count query), not just the rows loaded so far. */
  reviewsTotalCount: number;
  loadMoreReviews: () => void;
  loadingMoreReviews: boolean;
};

export const ReviewsSection = ({
  reviews,
  isOwnProfile,
  profileFullName,
  reviewCategoryFilter,
  reviewRatingFilter,
  reviewVisibleCount,
  onSetReviewCategoryFilter,
  onSetReviewRatingFilter,
  onSetReviewVisibleCount,
  onResetVisibleCount,
  respondingToReview,
  responseText,
  onSetResponseText,
  onStartResponding,
  onCancelResponding,
  onSaveResponse,
  savingResponse,
  reviewsHasMore,
  reviewsTotalCount,
  loadMoreReviews,
  loadingMoreReviews,
}: Props) => {
  const PAGE_SIZE = 5;
  // Distinct categories that appear in this helper's reviews,
  // computed once per render. Sorted alphabetically with a
  // stable "other" bucket for nulls. Drives the filter chips.
  const distinctCategories = Array.from(
    new Set(reviews.map((r) => r.jobCategory).filter((c): c is string => !!c)),
  ).sort();
  const matchesRatingBucket = (rating: number) => {
    if (reviewRatingFilter === "all") return true;
    if (reviewRatingFilter === "5") return rating === 5;
    if (reviewRatingFilter === "4") return rating === 4;
    // "low" bucket = ≤3 — pulls all critical reviews together so
    // a viewer can audit the negatives in one tap.
    return rating <= 3;
  };
  const filteredReviews = reviews.filter((r) => {
    if (reviewCategoryFilter && r.jobCategory !== reviewCategoryFilter) return false;
    if (!matchesRatingBucket(r.rating)) return false;
    return true;
  });
  const hasActiveFilter = reviewCategoryFilter !== null || reviewRatingFilter !== "all";
  const visible = filteredReviews.slice(0, reviewVisibleCount);

  // ONE pagination control, two sources. There used to be two stacked
  // buttons here — a client-side "Show 5 more (5 of 12)" sitting directly on
  // top of a server-side "Load more reviews", different visual weight,
  // unrelated counts. Now a single button reveals reviews already held in
  // memory first, and only reaches for the next server page once those run
  // out.
  const hasLocalMore = filteredReviews.length > visible.length;
  // Server pages are only offered on the unfiltered list: the filter runs
  // against rows already in memory, so a fetched page whose rows may not
  // match would make the "(x of y)" count lie.
  const hasServerMore = !hasActiveFilter && reviewsHasMore;
  const canShowMore = hasLocalMore || hasServerMore;
  // Denominator: unfiltered, the honest total is the server's count, not
  // however many rows happen to be loaded right now.
  const knownTotal = hasActiveFilter
    ? filteredReviews.length
    : Math.max(filteredReviews.length, reviewsTotalCount);
  // How many rows the next tap actually reveals. A server fetch returns a
  // full page, so PAGE_SIZE is the honest promise there too.
  const nextRevealCount = hasLocalMore
    ? Math.min(PAGE_SIZE, filteredReviews.length - visible.length)
    : PAGE_SIZE;
  const handleShowMore = () => {
    // Always widen the window — after a server fetch appends rows, the
    // slice above would otherwise still cap at the old count and the newly
    // fetched reviews would stay invisible until a second tap.
    onSetReviewVisibleCount((n) => n + PAGE_SIZE);
    if (!hasLocalMore) loadMoreReviews();
  };

  return (
    <div className="space-y-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200">
      {/* Filter row — only render when there's something to filter
          (at least one category beyond "other" OR more than one
          distinct rating). Avoids cluttering a 1-review profile. */}
      {reviews.length > 1 && (distinctCategories.length > 0 || new Set(reviews.map((r) => r.rating)).size > 1) && (
        // p-3, not the convention's p-5: this is a dense chip toolbar, not a
        // content card — p-5 gives it more presence than the reviews it
        // filters. Radius/material match the sibling cards.
        <div className="rounded-2xl liquid-glass p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ds-10 uppercase tracking-wide text-muted-foreground font-semibold">Filter</span>
            {hasActiveFilter && (
              <button
                onClick={() => {
                  onSetReviewCategoryFilter(null);
                  onSetReviewRatingFilter("all");
                  onResetVisibleCount(PAGE_SIZE);
                }}
                className="text-ds-11 underline text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          {distinctCategories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {distinctCategories.map((cat) => {
                const Icon = getCategoryIcon(cat);
                const active = reviewCategoryFilter === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      onSetReviewCategoryFilter(active ? null : cat);
                      onResetVisibleCount(PAGE_SIZE);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-ds-md text-ds-11 font-sans font-semibold transition-colors"
                    style={{
                      color: active ? "hsl(var(--parchment))" : "hsl(var(--bark))",
                      background: active ? "hsl(var(--bark))" : "hsl(var(--bark) / 0.08)",
                      border: `0.5px solid hsl(var(--bark) / ${active ? "0.6" : "0.18"})`,
                    }}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{formatCategory(cat)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {/* Star-bucket chips (#3): All / 5 / 4 / ≤3. Buckets
              hide themselves when no review matches — a profile
              with only 5★ reviews won't surface an empty "4★" tab. */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: "all" as const, label: "All", count: reviews.length, stars: 0 },
              { key: "5" as const, label: "", count: reviews.filter((r) => r.rating === 5).length, stars: 5 },
              { key: "4" as const, label: "", count: reviews.filter((r) => r.rating === 4).length, stars: 4 },
              { key: "low" as const, label: "≤3", count: reviews.filter((r) => r.rating <= 3).length, stars: 3 },
            ]).map((bucket) => {
              if (bucket.key !== "all" && bucket.count === 0) return null;
              const active = reviewRatingFilter === bucket.key;
              return (
                <button
                  key={bucket.key}
                  onClick={() => {
                    onSetReviewRatingFilter(bucket.key);
                    onResetVisibleCount(PAGE_SIZE);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-ds-md text-ds-11 font-sans font-semibold transition-colors tabular-nums"
                  style={{
                    color: active ? "hsl(var(--parchment))" : "hsl(var(--bark))",
                    background: active ? "hsl(var(--bark))" : "hsl(var(--bark) / 0.08)",
                    border: `0.5px solid hsl(var(--bark) / ${active ? "0.6" : "0.18"})`,
                  }}
                >
                  {bucket.key === "all" ? (
                    <span>{bucket.label}</span>
                  ) : (
                    <>
                      {bucket.key === "low" && <span>{bucket.label}</span>}
                      <Star className="w-3 h-3 fill-current" />
                      {bucket.key !== "low" && <span>{bucket.stars}</span>}
                    </>
                  )}
                  <span className="opacity-70">({bucket.count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {filteredReviews.length > 0 ? (
        <>
          {visible.map((r) => (
            // Keyed by review id, never array index: the category/star
            // filters reorder and re-slice this list, and an index key let
            // the inline response editor stay mounted on the wrong card.
            <div key={r.id} className="rounded-2xl liquid-glass p-5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} className={`w-3.5 h-3.5 ${s <= r.rating ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />
                    ))}
                  </div>
                  <span className="text-ds-11 font-medium text-foreground">{r.reviewerName}</span>
                </div>
                <span className="text-muted-foreground text-ds-11">{formatShortDate(r.created_at)}</span>
              </div>
              <p className="text-muted-foreground text-ds-11">For: {r.jobTitle}</p>
              {r.feedback && <p className="text-ds-13 text-foreground leading-relaxed">{r.feedback}</p>}
              {/* Existing public response — visible to everyone */}
              {r.response_text && (
                <div className="mt-3 pt-3 border-t border-[hsl(var(--bark)/0.10)]">
                  <p
                    className="text-ds-11 font-semibold uppercase tracking-[0.06em] mb-1.5"
                    style={{ color: "hsl(var(--olivewood)/0.8)" }}
                  >
                    Response from {profileFullName}
                  </p>
                  <p
                    className="text-ds-13 font-serif italic leading-relaxed"
                    style={{ color: "hsl(var(--olivewood)/0.80)" }}
                  >
                    {r.response_text}
                  </p>
                </div>
              )}
              {/* Add/Edit response — own profile only */}
              {isOwnProfile && !r.response_text && (
                <button
                  type="button"
                  className="mt-2 text-ds-11 font-sans font-semibold underline underline-offset-2"
                  style={{ color: "hsl(var(--burnt-sienna))" }}
                  onClick={() => {
                    onStartResponding(r.id, "");
                  }}
                >
                  Add Response
                </button>
              )}
              {isOwnProfile && r.response_text && (
                <button
                  type="button"
                  className="mt-2 text-ds-11 font-sans font-semibold underline underline-offset-2"
                  style={{ color: "hsl(var(--olivewood)/0.8)" }}
                  onClick={() => {
                    onStartResponding(r.id, r.response_text ?? "");
                  }}
                >
                  Edit Response
                </button>
              )}
              {/* Inline response editor */}
              {isOwnProfile && respondingToReview === r.id && (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={responseText}
                    onChange={(e) => onSetResponseText(e.target.value)}
                    aria-label="Write a public response"
                    maxLength={500}
                    rows={3}
                    className="w-full rounded-ds-md border border-[hsl(var(--bark)/0.20)] bg-background/60 px-3 py-2 text-ds-13 font-sans resize-none focus:outline-none focus:ring-1 focus:ring-[hsl(var(--bark)/0.40)]"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onSaveResponse(r.id)}
                      // Empty draft = nothing to save. Disabled outright so
                      // the button can't be tapped into a dead end (the save
                      // handler also guards, but that's a toast, not an
                      // affordance).
                      disabled={savingResponse || responseText.trim().length === 0}
                      className="btn-press px-4 py-1.5 rounded-ds-md text-ds-12 font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: "hsl(var(--burnt-sienna))" }}
                    >
                      {savingResponse ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={onCancelResponding}
                      className="btn-press px-4 py-1.5 rounded-ds-md text-ds-12 font-semibold"
                      style={{ color: "hsl(var(--olivewood)/0.8)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {canShowMore && (
            // p-3 rather than the card convention's p-5: a full-width
            // pagination control, sized as a button, not a content card.
            <button
              onClick={handleShowMore}
              disabled={loadingMoreReviews}
              className="w-full rounded-2xl liquid-glass p-3 text-ds-13 font-medium text-foreground hover:bg-muted/30 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {loadingMoreReviews ? (
                <span>Loading…</span>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  Show {nextRevealCount} More
                  <span className="text-muted-foreground">({visible.length} of {knownTotal})</span>
                </>
              )}
            </button>
          )}
        </>
      ) : (
        // p-6 over the convention's p-5: an icon-over-caption empty state
        // wants the extra breathing room, matching the other empty cards.
        <div className="rounded-2xl liquid-glass p-6 text-center">
          <Star className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-ds-11 text-muted-foreground">
            {hasActiveFilter ? "No reviews match this filter" : "No reviews yet"}
          </p>
        </div>
      )}
    </div>
  );
};
