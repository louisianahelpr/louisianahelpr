/**
 * The reviews on /u/<handle> (share-profile audit M2, 2026-11-05). Before: up to 10 bare rows (stars and a name), with the
 * poster's reply, the job's category and the date returned but never shown, and no way past the first 10.
 * Now: "Reviews · N" in the header, each review with its kind of work and month and the member's reply under it,
 * the first REVIEWS_FIRST and then "See all N reviews" from the same read (public_profile_by_handle).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { jobCategoryLabel } from "@/lib/jobCategories";
import type { PublicProfile } from "@/lib/profileLink/api";

export type PublicReview = PublicProfile["helpr"]["reviews"][number];

/** How many reviews show before "See all N reviews". */
export const REVIEWS_FIRST = 3;

/** "March 2026", or "" for a bad date. */
function reviewMonth(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" });
}

/**
 * The true number of reviews: the read's review_total when the server sends one, else the stats' review count, never
 * fewer than the rows in hand.
 */
export function reviewTotal(p: Pick<PublicProfile, "stats" | "helpr">): number {
  const fromServer = p.helpr.review_total ?? p.stats.review_count ?? 0;
  return Math.max(Number(fromServer) || 0, p.helpr.reviews.length);
}

export function PublicProfileReviews({ reviews, total, first }: { reviews: PublicReview[]; total: number; first: string }) {
  const [all, setAll] = useState(false);
  if (reviews.length === 0) return null;
  const shown = all ? reviews : reviews.slice(0, REVIEWS_FIRST);
  const hidden = total - shown.length;
  return (
    <div className="mt-3" data-testid="pp-reviews">
      <h3 className="text-ds-14 font-semibold text-foreground" data-testid="pp-reviews-title">
        Reviews · {total}
      </h3>
      <ul className="mt-2 flex flex-col gap-3">
        {shown.map((r, i) => {
          const meta = [r.job_category ? jobCategoryLabel(r.job_category) : "", reviewMonth(r.created_at)].filter(Boolean).join(" · ");
          const reply = (r.response_text ?? "").trim();
          return (
            <li key={`${r.created_at}-${i}`} className="rounded-xl border border-border bg-background p-3" data-testid="pp-review">
              <p className="text-ds-13 font-semibold text-foreground">
                <span role="img" aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}{"☆".repeat(Math.max(0, 5 - r.rating))}</span>
                {" · "}{r.reviewer_name}
              </p>
              {meta && <p className="text-ds-13 text-muted-foreground" data-testid="pp-review-meta">{meta}</p>}
              {r.feedback && <p className="mt-1 text-ds-14 text-foreground [overflow-wrap:anywhere]">{r.feedback}</p>}
              {reply && (
                <div className="mt-2 border-l-2 border-border pl-3" data-testid="pp-review-reply">
                  <p className="text-ds-13 font-semibold text-foreground">Reply from {first}</p>
                  <p className="text-ds-14 text-foreground [overflow-wrap:anywhere]">{reply}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!all && reviews.length > shown.length && (
        <Button type="button" variant="outline" className="mt-3 w-full rounded-full" data-testid="pp-reviews-all" onClick={() => setAll(true)}>
          See all {total} reviews
        </Button>
      )}
      {all && hidden > 0 && (
        <p className="mt-2 text-ds-13 text-muted-foreground" data-testid="pp-reviews-newest">
          Showing the newest {shown.length} of {total}.
        </p>
      )}
    </div>
  );
}
