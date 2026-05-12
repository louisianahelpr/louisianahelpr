import { Star } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

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
      <ProfileTabHeader
        eyebrow="Reputation"
        title="My reviews"
        meta={avgRating ? `${avgRating.toFixed(1)} average from ${reviewCount} review${reviewCount !== 1 ? "s" : ""}` : "No reviews yet"}
        onBack={onBack}
      />

      {hasCategoryData && (
        <div className="rounded-2xl liquid-glass p-5 grid grid-cols-3 gap-3">
          {[
            { label: "Punctuality", v: punctualityAvg },
            { label: "Quality", v: qualityAvg },
            { label: "Communication", v: communicationAvg },
          ].map((cat) => (
            <div key={cat.label} className="text-center">
              <p className="font-serif italic uppercase mb-1.5" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                {cat.label}
              </p>
              <div className="flex justify-center mb-1"><MiniStars value={cat.v} /></div>
              <p className="font-display italic font-bold tabular-nums" style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))" }}>
                {cat.v > 0 ? cat.v.toFixed(1) : "—"}
              </p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-4 px-6 py-12">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Star className="w-6 h-6 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="font-display italic font-bold" style={{ fontSize: "1.25rem", color: "hsl(var(--ink-deep))" }}>
              No reviews yet
            </p>
            <p className="font-serif italic text-ds-13 max-w-xs" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              Complete a job and your customer's words will land here.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review, i) => (
            <div key={i} className="rounded-ds-md liquid-glass p-4 space-y-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md">
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
                  <span className="font-display italic font-bold tabular-nums" style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}>
                    {review.rating}/5
                  </span>
                </div>
                <span className="font-serif italic" style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                  {new Date(review.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
              {(review.punctuality || review.quality || review.communication) && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {review.punctuality && (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="font-serif italic uppercase" style={{ fontSize: "0.55rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>Punctuality</span>
                      <MiniStars value={review.punctuality} size="xs" />
                    </div>
                  )}
                  {review.quality && (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="font-serif italic uppercase" style={{ fontSize: "0.55rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>Quality</span>
                      <MiniStars value={review.quality} size="xs" />
                    </div>
                  )}
                  {review.communication && (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="font-serif italic uppercase" style={{ fontSize: "0.55rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>Comms</span>
                      <MiniStars value={review.communication} size="xs" />
                    </div>
                  )}
                </div>
              )}
              {review.feedback && (
                <p className="font-serif italic leading-relaxed" style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))" }}>
                  &ldquo;{review.feedback}&rdquo;
                </p>
              )}
              <div className="flex items-center gap-2 font-serif italic pt-1" style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                <span>By <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{review.reviewerName}</span></span>
                <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
                <span>{review.jobTitle}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
