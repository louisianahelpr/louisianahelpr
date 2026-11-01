import { useState, useMemo } from "react";
import { Star, Info, ArrowDownAZ, ArrowUpAZ, CalendarClock } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
/* Board 179: each review's row is AboutYouRowCard (reviewsTab/reviewsAboutYou.tsx), which draws
   its stars with the SHARED ReviewStars from reviewCard.tsx (reviewCardOneDesign.test.tsx). */
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { TAB_TITLES } from "@/pages/profile/types";
import { STAR_ON } from "@/lib/starColor";
import {
  AboutYouChips,
  AboutYouRowCard,
  aboutYouRows,
  useDeclutterReviewsAboutYou,
  type AboutYouFilter,
} from "@/components/profile/reviewsTab/reviewsAboutYou";

interface Review {
  rating: number;
  feedback: string | null;
  created_at: string;
  reviewerName: string;
  jobTitle: string;
  side: "helpr" | "poster" | null;
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

type SortKey = "newest" | "highest" | "lowest";

const sortOptions: { value: SortKey; label: string; icon: typeof Star }[] = [
  { value: "newest", label: "Newest", icon: CalendarClock },
  { value: "highest", label: "Highest first", icon: ArrowDownAZ },
  { value: "lowest", label: "Lowest first", icon: ArrowUpAZ },
];

export function ReviewsTab({ reviews, loading: jobsLoading, avgRating, reviewCount, onBack, onLoadMore, hasMore, loadingMore }: ReviewsTabProps) {
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [filter, setFilter] = useState<AboutYouFilter>("all");
  // Board 179: Declutter reviews join the job reviews in ONE list. One loading gate for both
  // reads, so the list never arrives in two waves; a failed Declutter read shows the job reviews.
  const declutterQuery = useDeclutterReviewsAboutYou();
  const loading = jobsLoading || declutterQuery.isLoading;
  const allRows = useMemo(() => aboutYouRows(reviews, declutterQuery.data ?? []), [reviews, declutterQuery.data]);
  // One overall rating only (owner, 2026-08-30 for display, 2026-09-07 for
  // collection). The punctuality / quality / communication columns are gone.

  // Sort lives in the tab (not the parent) so flipping order is instant
  // without a re-fetch. Default newest matches the source query.
  const sortedRows = useMemo(() => {
    const list = allRows.filter((r) => filter === "all" || r.side === filter);
    if (sortBy === "highest") return list.sort((a, b) => b.rating - a.rating);
    if (sortBy === "lowest") return list.sort((a, b) => a.rating - b.rating);
    return list; // aboutYouRows is newest first
  }, [allRows, filter, sortBy]);

  const activeSort = sortOptions.find((o) => o.value === sortBy) ?? sortOptions[0];
  const ActiveSortIcon = activeSort.icon;

  return (
    <ProfileTabBody>
      <ProfileTabHeader
        title={TAB_TITLES.reviews}
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
      {/* `!loading` (Q169): the count comes from a query that lands before
          the review list, so the real hero appeared ABOVE the loading
          skeleton — which already draws a hero bone — and pushed it 123px
          down (CLS 0.079 at 375). Hero and list now arrive together. */}
      {!loading && reviewCount > 0 && avgRating != null && (
        <div className="rounded-2xl liquid-glass px-5 py-4 flex items-center gap-4">
          <div className="shrink-0 text-center">
            <p
              className="font-sans font-bold tabular-nums leading-none text-ds-32"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
            >
              {avgRating.toFixed(1)}
            </p>
            <p
              className="font-sans mt-1 text-ds-11"
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
                    color: n <= Math.round(avgRating) ? STAR_ON : "hsl(var(--olivewood) / 0.25)",
                    fill: n <= Math.round(avgRating) ? STAR_ON : "transparent",
                  }}
                />
              ))}
            </div>
            <p
              className="font-sans text-ds-14"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              {/* What it counts: reviews (audit #60), not "completed jobs". */}
              <span className="font-sans font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                {reviewCount}
              </span>{" "}
              review{reviewCount !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      )}

      {/* Per-category breakdown card removed (owner, 2026-08-30: "remove i
          think we should just do 1 overall rating"). It split the same four
          reviews into Punctuality / Quality / Communication averages that sat
          directly under the overall score — three more numbers saying the same
          thing, and on a handful of reviews the sub-averages are noise anyway.
          The overall rating card above is the one number. Individual reviews
          still show their own category rows further down. */}

      {loading ? (reviewCount === 0 ? (
        // DATA-AWARE (owner, Q722): the count lands before the list. Zero, or
        // not known yet (reads as 0), draws the zero state's silhouette: the
        // same block the tab's chunk fallback drew, so a cold visit to an
        // account with no reviews holds one shape from first paint to the
        // "No reviews yet" card. The populated skeleton below is drawn only
        // when the count says there ARE reviews.
        <ProfileTabBodyReserve key="reviews-loading-empty" tab="reviews" />
      ) : (
        // Content-shaped skeleton: hero summary card (matches the real
        // populated hero geometry: big rating number + star row + count
        // line) plus two review-row placeholders so the page doesn't
        // collapse to a single line of text mid-fetch.
        // key: a DIFFERENT element from the loaded list below (Q169). Both
        // are div.space-y-3, so React reused this one for the list and the
        // browser saw the skeleton slide 123px down under the new hero.
        <div key="reviews-loading" className="space-y-3">
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
            <div key={i} className="rounded-ds-md liquid-glass p-card space-y-2.5">
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
      )) : allRows.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={Star}
          illustration={<EmptyStateIllustration variant="reviews" />}
          title="No reviews yet"
          body="Complete a job and your first review will show up here."
          action={
            /* How-reviews-work disclosure — opens a small popover with
               the 4 rating dimensions so new helprs know what's being
               scored. No external page, no extra route. */
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-0 gap-1.5 text-ds-11 font-sans font-semibold tracking-normal active:opacity-70 [&_svg]:size-3.5"
                  style={{ color: "hsl(var(--bark))" }}
                >
                  <Info /> How reviews work
                </Button>
              </PopoverTrigger>
              <PopoverContent
                // Radix gives PopoverContent role="dialog", so without a name a
                // screen reader announces this disclosure as bare "dialog".
                aria-label="How reviews work"
                className="w-[min(92vw,320px)] rounded-2xl border border-border/40 shadow-2xl bg-card p-4"
                align="center"
              >
                <p className="font-display font-bold leading-tight mb-2 text-ds-16" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                  Everyone who hires you leaves one overall rating.
                </p>
                <ul className="space-y-1.5 font-sans text-ds-11 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  <li><span className="font-sans not-italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Overall</span> · a 1–5 star summary of the whole job</li>
                </ul>
                <p className="font-sans text-ds-11 mt-3 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  They can leave written feedback too. Everything shows up here within minutes.
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
          {/* Board 179: the side chips and the sort share one row; the chips scroll, the sort stays. */}
          <div className="flex items-center gap-2">
            <AboutYouChips rows={allRows} value={filter} onChange={setFilter} />
          <div className="ml-auto shrink-0 flex items-center justify-end gap-2 px-1">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all"
                  style={{
                    // The card surface's OWN colour, not literal white: in dark
                    // theme `hsla(0 0% 100% / .65)` painted a pale grey pill that
                    // read as disabled (Q179). --card is pure white in light, so
                    // light mode is unchanged. Guard: noLiteralWhiteSurfaces.test.ts.
                    background: "hsl(var(--card) / 0.65)",
                    border: "1px solid hsl(var(--olivewood) / 0.18)",
                    color: "hsl(var(--olivewood))",
                  }}
                >
                  <ActiveSortIcon className="w-3.5 h-3.5" />
                  {activeSort.label}
                </button>
              </PopoverTrigger>
              <PopoverContent
                // Radix gives PopoverContent role="dialog"; without a name a
                // screen reader announces this sort menu as bare "dialog".
                // Same reason as the disclosure popover above.
                aria-label="Sort reviews"
                className="w-[min(92vw,200px)] rounded-2xl border border-border/40 shadow-2xl bg-card p-1.5"
                align="end"
              >
                {sortOptions.map((opt) => {
                  const active = opt.value === sortBy;
                  const OptIcon = opt.icon;
                  return (
                    <button
                      aria-pressed={active}
                      key={opt.value}
                      type="button"
                      onClick={() => setSortBy(opt.value)}
                      className={`w-full flex items-center gap-2 px-2.5 h-9 rounded-md text-ds-13 font-sans font-medium transition-colors ${
                        active ? "btn-grad-primary text-[hsl(var(--parchment))]" : "text-foreground hover:bg-secondary/70"
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
          </div>
          {sortedRows.map((row) => (
            <AboutYouRowCard key={row.key} row={row} />
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
    </ProfileTabBody>
  );
}
