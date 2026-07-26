import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { formatName } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { formatCategory } from "@/lib/format";

/**
 * PublicReviewWall — a vertical stack of the helper's most recent
 * visible reviews, shown on their public profile (and a condensed
 * variant on helper card surfaces).
 *
 * Trust-signal complement to the numeric star average: a row of "5/5,
 * 'Maria S. · 3 days ago: Showed up early…'" snippets does far more to
 * convert a hesitant poster than `4.9 ★ (23)` alone. Closes #86.
 *
 * Respects the same `feedback_visible_at <= now()` filter every other
 * review surface uses — anti-retaliation reveal stays intact.
 *
 * Pure-cosmetic surface: no schema changes, no RPC, no permissions.
 * Hidden on the helper's own profile by callers — the helper sees their
 * reviews on the Earnings tab.
 */

const DEFAULT_LIMIT = 5;
const CONDENSED_LIMIT = 2;
const SNIPPET_MAX = 140;

interface ReviewRow {
  id: string;
  rating: number;
  feedback: string | null;
  created_at: string;
  reviewer_id: string;
  job_id: string;
}

interface JobRow {
  id: string;
  category: string | null;
}

interface ReviewerProfileRow {
  user_id: string;
  full_name: string | null;
}

export interface ResolvedReview {
  id: string;
  rating: number;
  feedback: string | null;
  createdAt: string;
  reviewerName: string;
  jobCategory: string | null;
}

interface PublicReviewWallProps {
  /** Helper whose reviews to display. */
  helperId: string;
  /**
   * Condensed mode renders 2 reviews max with a tighter layout — used
   * on helper cards / saved-helper rows. Default is the full wall.
   */
  variant?: "full" | "condensed";
  /**
   * Optional click handler for "See all N reviews" — when omitted, the
   * link is suppressed (the full wall doesn't need it; the condensed
   * variant uses it to deep-link into the full profile reviews tab).
   */
  onSeeAll?: () => void;
  /** Total review count, to gate the "See all N reviews" link. */
  totalReviewCount?: number;
  className?: string;
}

/**
 * Truncate a feedback string at `max` chars on a word boundary. Pure
 * function so the unit test can exercise it without rendering.
 */
export function truncateFeedback(text: string, max: number = SNIPPET_MAX): {
  truncated: string;
  isTruncated: boolean;
} {
  if (text.length <= max) return { truncated: text, isTruncated: false };
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  // Fall back to a hard cut if the snippet has no whitespace at all.
  const cut = lastSpace > max * 0.6 ? lastSpace : max;
  return { truncated: slice.slice(0, cut).trimEnd() + "…", isTruncated: true };
}

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`w-3.5 h-3.5 ${
            n <= rating
              ? "fill-[hsl(var(--gold-warm))] text-[hsl(var(--gold-warm))]"
              : "text-[hsl(var(--olivewood)/0.25)]"
          }`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function ReviewQuote({
  review,
  condensed,
}: {
  review: ResolvedReview;
  condensed: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { truncated, isTruncated } = useMemo(
    () => truncateFeedback(review.feedback ?? ""),
    [review.feedback],
  );

  // Relative time: "3 days ago", "about 1 hour ago", etc.
  const relative = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(review.createdAt), { addSuffix: true });
    } catch {
      return "recently";
    }
  }, [review.createdAt]);

  return (
    <article
      data-testid="public-review-item"
      className={[
        "rounded-2xl liquid-glass space-y-2",
        condensed ? "p-3" : "p-4",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <StarRow rating={review.rating} />
        {review.jobCategory && (
          <span
            data-testid="public-review-category"
            className="text-[0.65rem] font-sans font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap"
            style={{
              background: "hsl(var(--bark) / 0.08)",
              color: "hsl(var(--bark))",
              border: "0.5px solid hsl(var(--bark) / 0.18)",
            }}
          >
            {formatCategory(review.jobCategory)}
          </span>
        )}
      </div>

      {review.feedback && (
        <p
          className={[
            "font-serif italic leading-relaxed text-[hsl(var(--ink-deep)/0.88)]",
            condensed ? "text-ds-11" : "text-ds-13",
          ].join(" ")}
        >
          {/* Show the full text once the user taps "more"; otherwise the
              truncated snippet. The button is hidden when the feedback
              fits inside SNIPPET_MAX so we don't render a no-op
              affordance. */}
          {expanded || !isTruncated ? review.feedback : truncated}
          {isTruncated && !expanded && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="font-sans not-italic font-semibold text-[hsl(var(--burnt-sienna))] hover:underline focus:underline focus:outline-none"
                aria-label="Show full review"
              >
                more
              </button>
            </>
          )}
        </p>
      )}

      <p
        className="font-sans text-ds-11"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        <span className="font-semibold text-[hsl(var(--ink-deep)/0.78)]">
          {review.reviewerName}
        </span>
        <span aria-hidden="true"> · </span>
        <time dateTime={review.createdAt}>{relative}</time>
      </p>
    </article>
  );
}

export function PublicReviewWall({
  helperId,
  variant = "full",
  onSeeAll,
  totalReviewCount,
  className,
}: PublicReviewWallProps) {
  const condensed = variant === "condensed";
  const limit = condensed ? CONDENSED_LIMIT : DEFAULT_LIMIT;

  const { data, isLoading, isError } = useQuery<ResolvedReview[]>({
    queryKey: queryKeys.publicReviewWall.byHelper(helperId, limit),
    enabled: !!helperId,
    // Reviews don't change minute-by-minute; a 5-min cache keeps the
    // profile snappy on revisit without staleness that posters notice.
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from("reviews")
          .select("id, rating, feedback, created_at, reviewer_id, job_id")
          .eq("reviewee_id", helperId)
          // feedback_visible_at = double-blind reveal window. Hidden
          // rows stay private until both sides post or 14 days pass.
          .lte("feedback_visible_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(limit),
      ) as ReviewRow[] | null;

      if (!rows || rows.length === 0) return [];

      // Resolve reviewer display name + job category in two parallel
      // RPC/table calls — avoids N+1 fetches per review row.
      const reviewerIds = Array.from(new Set(rows.map((r) => r.reviewer_id)));
      const jobIds = Array.from(new Set(rows.map((r) => r.job_id)));

      const [profilesRes, jobsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: reviewerIds }),
        supabase.from("jobs").select("id, category").in("id", jobIds),
      ]);

      // We deliberately do NOT `unwrap()` the secondary fetches — if
      // they fail we still want to render the reviews with fallback
      // names ("Customer") rather than blow up the whole wall.
      const nameMap = new Map<string, string>(
        ((profilesRes.data ?? []) as ReviewerProfileRow[]).map((p) => [
          p.user_id,
          formatName(p.full_name, "Customer"),
        ]),
      );
      const categoryMap = new Map<string, string | null>(
        ((jobsRes.data ?? []) as JobRow[]).map((j) => [j.id, j.category]),
      );

      return rows.map<ResolvedReview>((r) => ({
        id: r.id,
        rating: r.rating,
        feedback: r.feedback,
        createdAt: r.created_at,
        reviewerName: nameMap.get(r.reviewer_id) ?? "Customer",
        jobCategory: categoryMap.get(r.job_id) ?? null,
      }));
    },
  });

  // While loading we render a sparse placeholder strip so the layout
  // doesn't jump when reviews arrive. Empty state is rendered after
  // the fetch settles (data === []).
  if (isLoading) {
    return (
      <div
        data-testid="public-review-wall-loading"
        className={["space-y-2", className ?? ""].join(" ")}
        aria-hidden="true"
      >
        {[1, 2].map((i) => (
          <div
            key={i}
            className={[
              "rounded-2xl liquid-glass animate-pulse",
              condensed ? "p-3 h-16" : "p-4 h-24",
            ].join(" ")}
          />
        ))}
      </div>
    );
  }

  // On a hard error `data` is undefined → the block below would falsely render
  // "No reviews yet" on a PUBLIC profile, making a helper with real reviews look
  // unreviewed (a trust/conversion harm). Hide the wall instead of claiming zero;
  // the numeric star average on the profile still carries the signal.
  if (isError) return null;

  const reviews = data ?? [];

  if (reviews.length === 0) {
    // Empty state — nudges first-time posters to be the customer that
    // breaks the seal. Condensed surfaces hide it entirely so we don't
    // pad helper cards with "no reviews yet" rows.
    if (condensed) return null;
    return (
      <div
        data-testid="public-review-wall-empty"
        className={[
          "rounded-2xl liquid-glass p-6 text-center space-y-2",
          className ?? "",
        ].join(" ")}
      >
        <Star
          className="w-5 h-5 mx-auto"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          aria-hidden="true"
        />
        <p
          className="font-serif italic text-ds-13"
          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
        >
          No reviews yet — they're new on Helpr.
        </p>
      </div>
    );
  }

  // "See all N reviews" only renders when (a) the caller wired a
  // handler and (b) the underlying total exceeds what we just showed.
  // Falls back to the page-load count when the caller doesn't pass
  // totalReviewCount, so the link still works on the full wall.
  const showSeeAll =
    !!onSeeAll &&
    (totalReviewCount !== undefined
      ? totalReviewCount > reviews.length
      : reviews.length >= limit);

  return (
    <section
      data-testid="public-review-wall"
      aria-label="Recent reviews"
      className={["space-y-2", className ?? ""].join(" ")}
    >
      {reviews.map((r) => (
        <ReviewQuote key={r.id} review={r} condensed={condensed} />
      ))}

      {showSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="w-full text-center font-sans font-semibold text-ds-13 py-2 rounded-ds-md hover:bg-[hsl(var(--bark)/0.04)] transition-colors"
          style={{ color: "hsl(var(--burnt-sienna))" }}
        >
          See all {totalReviewCount ?? reviews.length} review
          {(totalReviewCount ?? reviews.length) === 1 ? "" : "s"}
        </button>
      )}
    </section>
  );
}

export default PublicReviewWall;
