import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Star, Flag } from "lucide-react";
import ReportDialog from "@/components/ReportDialog";
import { report } from "@/lib/errorLogger";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";
import { MiniStars } from "./MiniStars";
import { safeImageSrc, type Review, type ReviewListProps } from "./types";

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
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("reviewee_id", userId)
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
        const reviewerIds = [...new Set(data.map((r) => r.reviewer_id))];
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
  const punctualityAvg = avg("punctuality");
  const qualityAvg = avg("quality");
  const communicationAvg = avg("communication");

  if (loaded && loadFailed) return <p className="text-ds-11 text-destructive">Couldn't load reviews. Please try again later.</p>;
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
        {(punctualityAvg > 0 || qualityAvg > 0 || communicationAvg > 0) && (
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border">
            {[
              { label: "Punctuality", v: punctualityAvg },
              { label: "Quality", v: qualityAvg },
              { label: "Communication", v: communicationAvg },
            ].map((cat) => (
              <div key={cat.label} className="text-center">
                <p className="text-ds-10 uppercase tracking-wide text-muted-foreground mb-1">{cat.label}</p>
                <div className="flex justify-center mb-0.5"><MiniStars value={cat.v} /></div>
                <p className="text-ds-11 font-semibold text-foreground">{cat.v > 0 ? cat.v.toFixed(1) : "—"}</p>
              </div>
            ))}
          </div>
        )}
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
                <span className="text-ds-11 text-muted-foreground">by {r.reviewerName || "User"}</span>
              </div>
              <button
                onClick={() => setReportReviewId(r.id)}
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                aria-label="Report this review"
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
            </div>
            {(r.punctuality || r.quality || r.communication) && (
              <div className="grid grid-cols-3 gap-2 mb-2 text-ds-10">
                {r.punctuality && (
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <span>Punctuality</span><MiniStars value={r.punctuality} />
                  </div>
                )}
                {r.quality && (
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <span>Quality</span><MiniStars value={r.quality} />
                  </div>
                )}
                {r.communication && (
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <span>Comms</span><MiniStars value={r.communication} />
                  </div>
                )}
              </div>
            )}
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

            <p className="text-ds-11 text-muted-foreground mt-1">{new Date(r.created_at).toLocaleDateString()}</p>
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
