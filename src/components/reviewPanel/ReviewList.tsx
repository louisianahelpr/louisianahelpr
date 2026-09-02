import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Star, Flag } from "lucide-react";
import ReportDialog from "@/components/ReportDialog";
import { report } from "@/lib/errorLogger";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";
import { safeImageSrc, type Review, type ReviewListProps } from "./types";
import { formatShortDate } from "@/lib/format";

export const ReviewList = ({ userId }: ReviewListProps) => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reportReviewId, setReportReviewId] = useState<string | null>(null);
  // Lightbox state — flat list of all review photos for the active review card.
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      // NOTE: this component is currently mounted nowhere (the profile and
      // public-profile surfaces render their own lists). It is kept because
      // it is the reference shape for a review list — which is exactly why
      // its query must not be wrong: the two filters below were both absent,
      // so whoever mounted it next would have shipped a wall that shows
      // operator-removed reviews and computes an average from a different row
      // set than every other surface.
      //
      //  - `status = 'published'` — an admin takedown deletes the row today,
      //    but the column exists and nothing else here honoured it.
      //  - `feedback_visible_at <= now()` — the double-blind reveal. The
      //    reviews SELECT policy also enforces it, EXCEPT for rows you
      //    authored yourself, which the policy deliberately lets through; on
      //    a list of reviews ABOUT someone that exception is not wanted.
      //
      // Still missing, and not fixable from the client: the cancelled-job
      // exclusion. `jobs` is unreadable to a non-party, which is why
      // `get_public_profile_reviews` exists. Route through that RPC before
      // mounting this anywhere real.
      const { data, error } = await supabase
        .from("reviews")
        .select("id, rating, punctuality, quality, communication, feedback, created_at, reviewer_id, photo_urls")
        .eq("reviewee_id", userId)
        .eq("status", "published")
        .lte("feedback_visible_at", new Date().toISOString())
        .order("created_at", { ascending: false });

      if (error) {
        // Surface the failure instead of silently rendering an empty
        // "no reviews yet" state that looks like real data.
        console.error("[ReviewList] failed to load reviews:", error);
        report(error, { severity: "warning", tags: { source: "ReviewPanel.load" } });
        setLoadFailed(true);
        setLoaded(true);
        return;
      }
      if (data && data.length > 0) {
        // A null `reviewer_id` is an author who DELETED their account:
        // deletion anonymises rather than removes (20260901033011), so the
        // review stands with no author. Null is not an id to look up, and
        // handing one to a uuid[] RPC parameter is a malformed filter rather
        // than a no-match — so it is dropped here. The row still renders; the
        // lookup misses and it falls through to the existing "a neighbor"
        // fallback, which is what an unresolved reviewer already got.
        const reviewerIds = [...new Set(data.map((r) => r.reviewer_id).filter((id): id is string => !!id))];
        const { data: profiles, error: profErr } = await supabase
          .rpc("get_safe_profiles", { user_ids: reviewerIds });
        // Non-fatal: reviews still render, reviewer names just fall back to
        // "User". Report so a broken RPC doesn't silently degrade every card.
        if (profErr) {
          report(profErr, { severity: "warning", tags: { source: "ReviewPanel.loadNames" } });
        }

        const profileMap = new Map(profiles?.map((p) => [p.user_id, p.full_name || "User"]) || []);
        setReviews(data.map((r: any) => ({ ...r, reviewerName: profileMap.get(r.reviewer_id) })));
      }
      setLoaded(true);
    };
    load();
  }, [userId]);

  const avg = (key: keyof Review) => {
    const vals = reviews.map((r) => Number(r[key])).filter((n) => Number.isFinite(n) && n > 0);
    return vals.length > 0 ? vals.reduce((s, n) => s + n, 0) / vals.length : 0;
  };

  const overallAvg = avg("rating");

  if (loaded && loadFailed) return <p className="text-ds-11 text-destructive">Couldn't load reviews — try again?</p>;
  if (loaded && reviews.length === 0) return <p className="text-ds-11 text-muted-foreground">No reviews yet.</p>;
  if (!loaded && reviews.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-ds-md liquid-glass p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                className={`w-5 h-5 ${s <= Math.round(overallAvg) ? "fill-accent text-accent" : "text-muted-foreground/30"}`}
              />
            ))}
          </div>
          <span className="text-ds-11 text-muted-foreground">
            {overallAvg.toFixed(1)} ({reviews.length} review{reviews.length !== 1 ? "s" : ""})
          </span>
        </div>
      </div>
      <div className="space-y-3">
        {reviews.map((r) => (
          <div key={r.id} className="rounded-ds-sm liquid-glass p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div role="img" aria-label={`${r.rating} out of 5 stars`} className="flex">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className={`w-3.5 h-3.5 ${s <= r.rating ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />
                  ))}
                </div>
                <span className="text-ds-11 text-muted-foreground">by {r.reviewerName || "a neighbor"}</span>
              </div>
              <button
                onClick={() => setReportReviewId(r.id)}
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                aria-label="Report this review"
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
            </div>
            {r.feedback && <p className="text-ds-13 text-foreground">{r.feedback}</p>}

            {/* Photo thumbnails — tapping opens the lightbox */}
            {r.photo_urls && r.photo_urls.length > 0 && (
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {r.photo_urls.map((url, pi) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => {
                      setLightboxPhotos(r.photo_urls!);
                      setLightboxIndex(pi);
                    }}
                    aria-label={`View review photo ${pi + 1}`}
                    className="w-14 h-14 rounded-ds-sm overflow-hidden shrink-0 transition-transform active:scale-95 hover:opacity-90"
                    style={{ border: "0.5px solid hsl(var(--olivewood) / 0.15)" }}
                  >
                    <img
                      loading="lazy"
                      decoding="async"
                      src={safeImageSrc(url)}
                      alt={`Review photo ${pi + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            <p className="text-ds-11 text-muted-foreground mt-1">{formatShortDate(r.created_at)}</p>
          </div>
        ))}
      </div>
      {reportReviewId && (
        <ReportDialog
          open={!!reportReviewId}
          onClose={() => setReportReviewId(null)}
          reportedType="review"
          reportedId={reportReviewId}
        />
      )}
      {/* Lightbox for review photos — reuses the same fullscreen viewer
          as JobDetailDialog photos. */}
      <PhotoLightbox
        photos={lightboxPhotos}
        lightboxIndex={lightboxIndex}
        setLightboxIndex={setLightboxIndex}
      />
    </div>
  );
};
