import { useState, useMemo } from "react";
import { Star, Info, ArrowDownAZ, ArrowUpAZ, CalendarClock } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { formatTimestamp } from "@/lib/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Review {
  rating: number;
  punctuality: number | null;
  quality: number | null;
  communication: number | null;
  feedback: string | null;
  created_at: string;
  reviewerName: string;
  jobTitle: string;
}

interface ReviewsTabProps {
  reviews: Review[];
  loading: boolean;
  avgRating: number | null;
  reviewCount: number;
  onBack: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}

const MiniStars = ({ value, size = "sm" }: { value: number; size?: "sm" | "xs" }) => {
  const cls = size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3";
  return (
    <div role="img" aria-label={`${value.toFixed(1)} out of 5 stars`} className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={cls}
          style={{
            color: s <= Math.round(value) ? "hsl(var(--burnt-sienna))" : "hsl(var(--olivewood) / 0.25)",
            fill: s <= Math.round(value) ? "hsl(var(--burnt-sienna))" : "transparent",
          }}
        />
      ))}
    </div>
  );
};

type SortKey = "newest" | "highest" | "lowest";

const sortOptions: { value: SortKey; label: string; icon: typeof Star }[] = [
  { value: "newest", label: "Newest", icon: CalendarClock },
  { value: "highest", label: "Highest first", icon: ArrowDownAZ },
  { value: "lowest", label: "Lowest first", icon: ArrowUpAZ },
];

export function ReviewsTab({ reviews, loading, avgRating, reviewCount, onBack, onLoadMore, hasMore, loadingMore }: ReviewsTabProps) {
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const catAvg = (key: keyof Review) => {
    const vals = reviews.map((r) => Number(r[key])).filter((n) => Number.isFinite(n) && n > 0);
    return vals.length > 0 ? vals.reduce((s, n) => s + n, 0) / vals.length : 0;
  };
  const punctualityAvg = catAvg("punctuality");
  const qualityAvg = catAvg("quality");
  const communicationAvg = catAvg("communication");
  const hasCategoryData = punctualityAvg > 0 || qualityAvg > 0 || communicationAvg > 0;

  // Sort lives in the tab (not the parent) so flipping order is instant
  // without a re-fetch. Default newest matches the source query.
  const sortedReviews = useMemo(() => {
    const list = [...reviews];
    if (sortBy === "highest") return list.sort((a, b) => b.rating - a.rating);
    if (sortBy === "lowest") return list.sort((a, b) => a.rating - b.rating);
    return list.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [reviews, sortBy]);

  const activeSort = sortOptions.find((o) => o.value === sortBy) ?? sortOptions[0];
  const ActiveSortIcon = activeSort.icon;

  return (
    <div className="space-y-4">
      <ProfileTabHeader
        title="My reviews"
        onBack={onBack}
      />

      {/* No zero-state hero. It rendered an empty "— out of 5" card saying
          "No rating yet…" directly above the EmptyState below, which says
          "No reviews yet" and explains the same thing again — two headings
          narrating one emptiness, simultaneously on screen. The EmptyState
          (with its illustration and the how-reviews-work popover) is the
          better of the two, so it carries the zero case alone. */}

      {/* Hero summary — big rating number + stars + count. Anchors the
          page so the reader has the at-a-glance signal before they scroll
          into individual reviews. Hides when there are no reviews. */}
      {reviewCount > 0 && avgRating != null && (
        <div className="rounded-2xl liquid-glass px-5 py-4 flex items-center gap-4">
          <div className="shrink-0 text-center">
            <p
              className="font-display italic font-bold tabular-nums leading-none text-ds-32"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
            >
              {avgRating.toFixed(1)}
            </p>
            <p
              className="font-serif italic mt-1 text-ds-11"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              out of 5
            </p>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-0.5 mb-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className="w-4 h-4"
                  style={{
                    color: n <= Math.round(avgRating) ? "hsl(var(--burnt-sienna))" : "hsl(var(--olivewood) / 0.25)",
                    fill: n <= Math.round(avgRating) ? "hsl(var(--burnt-sienna))" : "transparent",
                  }}
                />
              ))}
            </div>
            <p
              className="font-serif italic text-ds-14"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Based on{" "}
              <span className="font-display not-italic font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                {reviewCount}
              </span>{" "}
              completed job{reviewCount !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      )}

      {hasCategoryData && (
        <div className="rounded-2xl liquid-glass p-5 grid grid-cols-3 gap-3">
          {[
            { label: "Punctuality", v: punctualityAvg },
            { label: "Quality", v: qualityAvg },
            { label: "Communication", v: communicationAvg },
          ].map((cat) => (
            <div key={cat.label} className="text-center">
              <p className="font-serif italic uppercase mb-1.5 text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
                {cat.label}
              </p>
              <div className="flex justify-center mb-1"><MiniStars value={cat.v} /></div>
              <p className="font-display italic font-bold tabular-nums text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
                {cat.v > 0 ? cat.v.toFixed(1) : "—"}
              </p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        // Content-shaped skeleton: hero summary card (matches the real
        // populated hero geometry: big rating number + star row + count
        // line) plus two review-row placeholders so the page doesn't
        // collapse to a single line of text mid-fetch.
        <div className="space-y-3">
          <div className="rounded-2xl liquid-glass px-5 py-4 flex items-center gap-4">
            <div className="shrink-0 text-center space-y-2">
              <Skeleton className="h-9 w-12" />
              <Skeleton className="h-2.5 w-12 mx-auto" />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-0.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-4 w-4 rounded-sm" />
                ))}
              </div>
              <Skeleton className="h-3.5 w-3/5" />
            </div>
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="rounded-ds-md liquid-glass p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {[0, 1, 2, 3, 4].map((s) => (
                      <Skeleton key={s} className="h-3.5 w-3.5 rounded-sm" />
                    ))}
                  </div>
                  <Skeleton className="h-3 w-8" />
                </div>
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={Star}
          illustration={<EmptyStateIllustration variant="reviews" />}
          title="No reviews yet"
          body="Complete a job and your customer's words will show up here."
          action={
            /* How-reviews-work disclosure — opens a small popover with
               the 4 rating dimensions so new helprs know what's being
               scored. No external page, no extra route. */
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-ds-11 font-sans font-semibold active:opacity-70 transition-opacity"
                  style={{ color: "hsl(var(--bark))" }}
                >
                  <Info className="w-3.5 h-3.5" /> How reviews work
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[min(92vw,320px)] rounded-2xl border border-border/40 shadow-2xl bg-card p-4"
                align="center"
              >
                <p className="text-display-eyebrow mb-2">After every job</p>
                <p className="font-display italic font-bold leading-tight mb-2 text-ds-16" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                  Customers score you on four things.
                </p>
                <ul className="space-y-1.5 font-serif italic text-ds-11 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  <li><span className="font-sans not-italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Overall</span> · the 1–5 star summary</li>
                  <li><span className="font-sans not-italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Punctuality</span> · did you show up on time?</li>
                  <li><span className="font-sans not-italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Quality</span> · was the work done well?</li>
                  <li><span className="font-sans not-italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Communication</span> · were you easy to reach?</li>
                </ul>
                <p className="font-serif italic text-ds-11 mt-3 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Posters can leave written feedback too. Everything shows up here within minutes.
                </p>
              </PopoverContent>
            </Popover>
          }
        />
      ) : (
        <div className="space-y-3">
          {/* Sort pills — Newest by default, with Highest/Lowest for
              triage when the feed has volume (e.g. responding to the
              worst recent review). */}
          <div className="flex items-center justify-end gap-2 px-1">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all"
                  style={{
                    background: "hsla(0, 0%, 100%, 0.65)",
                    border: "1px solid hsl(var(--olivewood) / 0.18)",
                    color: "hsl(var(--olivewood))",
                  }}
                >
                  <ActiveSortIcon className="w-3.5 h-3.5" />
                  {activeSort.label}
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[min(92vw,200px)] rounded-2xl border border-border/40 shadow-2xl bg-card p-1.5"
                align="end"
              >
                {sortOptions.map((opt) => {
                  const active = opt.value === sortBy;
                  const OptIcon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSortBy(opt.value)}
                      className={`w-full flex items-center gap-2 px-2.5 h-9 rounded-md text-ds-13 font-sans font-medium transition-colors ${
                        active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary/70"
                      }`}
                    >
                      <OptIcon className="w-3.5 h-3.5" />
                      {opt.label}
                    </button>
                  );
                })}
              </PopoverContent>
            </Popover>
          </div>
          {sortedReviews.map((review, i) => (
            <div key={i} className="rounded-ds-md liquid-glass p-4 space-y-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <Star
                        key={s}
                        className="w-3.5 h-3.5"
                        style={{
                          color: s < review.rating ? "hsl(var(--burnt-sienna))" : "hsl(var(--olivewood) / 0.25)",
                          fill: s < review.rating ? "hsl(var(--burnt-sienna))" : "transparent",
                        }}
                      />
                    ))}
                  </div>
                  <span className="font-display italic font-bold tabular-nums text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
                    {review.rating}/5
                  </span>
                </div>
                <span className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  {formatTimestamp(review.created_at)}
                </span>
              </div>
              {(review.punctuality || review.quality || review.communication) && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {review.punctuality && (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="font-serif italic uppercase text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>Punctuality</span>
                      <MiniStars value={review.punctuality} size="xs" />
                    </div>
                  )}
                  {review.quality && (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="font-serif italic uppercase text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>Quality</span>
                      <MiniStars value={review.quality} size="xs" />
                    </div>
                  )}
                  {review.communication && (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="font-serif italic uppercase text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>Comms</span>
                      <MiniStars value={review.communication} size="xs" />
                    </div>
                  )}
                </div>
              )}
              {review.feedback && (
                <p className="font-serif italic leading-relaxed text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
                  &ldquo;{review.feedback}&rdquo;
                </p>
              )}
              <div className="flex items-center gap-2 font-serif italic pt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <span>By <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{review.reviewerName}</span></span>
                <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                <span>{review.jobTitle}</span>
              </div>
            </div>
          ))}
          {hasMore && (
            <Button
              variant="outline"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="w-full mt-2"
            >
              {loadingMore ? "Loading…" : "Load more reviews"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
