import { ArrowLeft, Star } from "lucide-react";

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
}

const MiniStars = ({ value, size = "sm" }: { value: number; size?: "sm" | "xs" }) => {
  const cls = size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3";
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} className={`${cls} ${s <= Math.round(value) ? "text-primary fill-primary" : "text-muted-foreground/30"}`} />
      ))}
    </div>
  );
};

export function ReviewsTab({ reviews, loading, avgRating, reviewCount, onBack }: ReviewsTabProps) {
  const catAvg = (key: keyof Review) => {
    const vals = reviews.map((r) => Number(r[key])).filter((n) => Number.isFinite(n) && n > 0);
    return vals.length > 0 ? vals.reduce((s, n) => s + n, 0) / vals.length : 0;
  };
  const punctualityAvg = catAvg("punctuality");
  const qualityAvg = catAvg("quality");
  const communicationAvg = catAvg("communication");
  const hasCategoryData = punctualityAvg > 0 || qualityAvg > 0 || communicationAvg > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">My Reviews</h1>
          <p className="text-muted-foreground text-sm">
            {avgRating ? `${avgRating.toFixed(1)} average from ${reviewCount} review${reviewCount !== 1 ? "s" : ""}` : "No reviews yet"}
          </p>
        </div>
      </div>

      {hasCategoryData && (
        <div className="rounded-xl border border-border bg-card p-4 grid grid-cols-3 gap-2">
          {[
            { label: "Punctuality", v: punctualityAvg },
            { label: "Quality", v: qualityAvg },
            { label: "Communication", v: communicationAvg },
          ].map((cat) => (
            <div key={cat.label} className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{cat.label}</p>
              <div className="flex justify-center mb-1"><MiniStars value={cat.v} /></div>
              <p className="text-xs font-semibold text-foreground">{cat.v > 0 ? cat.v.toFixed(1) : "—"}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading reviews...</p>
      ) : reviews.length === 0 ? (
        <div className="text-center py-12">
          <Star className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">No reviews yet. Complete jobs to receive reviews!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <Star
                        key={s}
                        className={`w-3.5 h-3.5 ${s < review.rating ? "text-primary fill-primary" : "text-muted-foreground/30"}`}
                      />
                    ))}
                  </div>
                  <span className="text-sm font-semibold text-foreground">{review.rating}/5</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(review.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
              {(review.punctuality || review.quality || review.communication) && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {review.punctuality && (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Punctuality</span>
                      <MiniStars value={review.punctuality} size="xs" />
                    </div>
                  )}
                  {review.quality && (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Quality</span>
                      <MiniStars value={review.quality} size="xs" />
                    </div>
                  )}
                  {review.communication && (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Comms</span>
                      <MiniStars value={review.communication} size="xs" />
                    </div>
                  )}
                </div>
              )}
              {review.feedback && (
                <p className="text-sm text-foreground">{review.feedback}</p>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>By <span className="font-medium text-foreground">{review.reviewerName}</span></span>
                <span>·</span>
                <span>{review.jobTitle}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
