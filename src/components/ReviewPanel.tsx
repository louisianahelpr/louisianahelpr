import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Star, Flag } from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { maybeRequestInAppReview } from "@/lib/inAppReview";
import { track, AhaEvent } from "@/lib/analytics";

interface ReviewFormProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  revieweeId: string;
  revieweeName: string;
}

type CategoryKey = "rating" | "punctuality" | "quality" | "communication";

const CATEGORY_ROWS: { key: CategoryKey; label: string; sublabel: string }[] = [
  { key: "rating", label: "Overall", sublabel: "Your overall experience" },
  { key: "punctuality", label: "Punctuality", sublabel: "Showed up on time" },
  { key: "quality", label: "Quality of work", sublabel: "Met expectations" },
  { key: "communication", label: "Communication", sublabel: "Clear and responsive" },
];

const StarRow = ({
  value,
  onChange,
  label,
  sublabel,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  sublabel: string;
}) => {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl liquid-glass p-3.5">
      <div className="flex-1 min-w-0">
        <p
          className="font-display italic font-bold leading-tight"
          style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
        >
          {label}
        </p>
        <p
          className="font-serif italic mt-0.5"
          style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.7)" }}
        >
          {sublabel}
        </p>
      </div>
      <div className="flex gap-0.5 shrink-0">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(0)}
            className="p-0.5 active:scale-90 transition-transform"
            aria-label={`${label} ${s} star${s > 1 ? "s" : ""}`}
          >
            <Star
              className="w-6 h-6 transition-colors"
              style={{
                color: s <= (hover || value) ? "hsl(var(--burnt-sienna))" : "hsl(var(--olivewood) / 0.25)",
                fill: s <= (hover || value) ? "hsl(var(--burnt-sienna))" : "transparent",
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

export const ReviewForm = ({ open, onClose, jobId, revieweeId, revieweeName }: ReviewFormProps) => {
  const [scores, setScores] = useState<Record<CategoryKey, number>>({
    rating: 0,
    punctuality: 0,
    quality: 0,
    communication: 0,
  });
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const quickOptions = ["Great communicator", "On time", "Quality work", "Very professional", "Highly recommend", "Friendly & helpful"];

  const toggleQuickOption = (option: string) => {
    setFeedback((prev) => {
      const parts = prev.split(", ").filter(Boolean);
      if (parts.includes(option)) return parts.filter((p) => p !== option).join(", ");
      return [...parts, option].join(", ");
    });
  };

  const setScore = (key: CategoryKey, v: number) => setScores((prev) => ({ ...prev, [key]: v }));

  const allRated = scores.rating > 0 && scores.punctuality > 0 && scores.quality > 0 && scores.communication > 0;

  const handleSubmit = async () => {
    if (!allRated) {
      toast.error("Please rate all four categories");
      return;
    }
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("You must be logged in"); setSubmitting(false); return; }

    const { error } = await supabase.from("reviews").insert({
      job_id: jobId,
      reviewer_id: user.id,
      reviewee_id: revieweeId,
      rating: scores.rating,
      punctuality: scores.punctuality,
      quality: scores.quality,
      communication: scores.communication,
      feedback: feedback.trim() || null,
    });

    if (error) {
      if (error.code === "23505") toast.error("You've already reviewed this job.");
      else toast.error("Failed to submit review");
    } else {
      toast.success("Review submitted!");
      // Aha-moment analytics + native review prompt. A 5-star review is the
      // strongest signal that this user would also rate us 5 stars on the App Store.
      track(AhaEvent.ReviewLeft, { jobId, rating: scores.rating });
      if (scores.rating === 5) {
        track(AhaEvent.FirstReviewLeft, { jobId, rating: 5 });
        // Fire-and-forget — internally rate-limited to once per 90 days.
        void maybeRequestInAppReview();
      }
      onClose();
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto !gap-3">
        <DialogHeader className="!text-left space-y-0">
          <span
            className="font-serif italic uppercase"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Your turn
          </span>
          <DialogTitle
            className="font-display italic font-bold leading-tight mt-1"
            style={{ fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            Rate {revieweeName}.
          </DialogTitle>
          <p
            className="font-serif italic mt-1"
            style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.7)" }}
          >
            Reviews are how other neighbors decide who to trust.
          </p>
        </DialogHeader>
        <div className="space-y-3">
          {CATEGORY_ROWS.map((row) => (
            <StarRow
              key={row.key}
              value={scores[row.key]}
              onChange={(v) => setScore(row.key, v)}
              label={row.label}
              sublabel={row.sublabel}
            />
          ))}
          <p
            className="font-serif italic uppercase pt-1"
            style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Tap any that fit
          </p>
          <div className="flex flex-wrap gap-2">
            {quickOptions.map((opt) => {
              const selected = feedback.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleQuickOption(opt)}
                  className="text-[0.72rem] font-sans font-semibold px-3 py-1.5 rounded-full transition-all active:scale-[0.97]"
                  style={
                    selected
                      ? {
                          background: "hsl(var(--bark))",
                          color: "hsl(var(--parchment))",
                          border: "0.5px solid hsl(var(--bark))",
                          boxShadow: "0 1px 2px hsl(var(--bark) / 0.18)",
                        }
                      : {
                          background: "hsla(0, 0%, 100%, 0.55)",
                          color: "hsl(var(--ink-deep))",
                          border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                        }
                  }
                >
                  {opt}
                </button>
              );
            })}
          </div>
          <Textarea
            aria-label="Review comment (optional)"
            placeholder="Add a comment (optional)…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            className="rounded-ds-md bg-white/60 border-border/60 focus-visible:bg-white focus-visible:border-primary/40 font-serif italic text-[0.88rem] leading-relaxed"
          />
        </div>
        <DialogFooter className="!gap-2">
          <Button variant="ghost" onClick={onClose} className="rounded-ds-md">Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !allRated}
            className="rounded-ds-md"
            style={{
              background: allRated ? "hsl(var(--bark))" : undefined,
              backgroundImage: "none",
              border: allRated ? "1px solid hsl(var(--bark))" : undefined,
              color: allRated ? "hsl(var(--parchment))" : undefined,
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.01em",
              boxShadow: allRated ? "0 1px 2px hsl(var(--bark) / 0.18), 0 8px 20px -6px hsl(var(--bark) / 0.34)" : undefined,
            }}
          >
            {submitting ? "Submitting…" : "Submit review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Display reviews for a user
interface ReviewListProps {
  userId: string;
}

type Review = {
  id: string;
  rating: number;
  punctuality: number | null;
  quality: number | null;
  communication: number | null;
  feedback: string | null;
  created_at: string;
  reviewer_id: string;
  reviewerName?: string;
};

const MiniStars = ({ value }: { value: number }) => (
  <div className="flex">
    {[1, 2, 3, 4, 5].map((s) => (
      <Star key={s} className={`w-3 h-3 ${s <= Math.round(value) ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />
    ))}
  </div>
);

export const ReviewList = ({ userId }: ReviewListProps) => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reportReviewId, setReportReviewId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("reviews")
        .select("*")
        .eq("reviewee_id", userId)
        .order("created_at", { ascending: false });

      if (data && data.length > 0) {
        const reviewerIds = [...new Set(data.map((r) => r.reviewer_id))];
        const { data: profiles } = await supabase
          .rpc("get_safe_profiles", { user_ids: reviewerIds });

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

  if (loaded && reviews.length === 0) return <p className="text-ds-11 text-muted-foreground">No reviews yet.</p>;
  if (!loaded && reviews.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-ds-md liquid-glass p-4 space-y-3">
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
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{cat.label}</p>
                <div className="flex justify-center mb-0.5"><MiniStars value={cat.v} /></div>
                <p className="text-ds-11 font-semibold text-foreground">{cat.v > 0 ? cat.v.toFixed(1) : "—"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-3">
        {reviews.map((r) => (
          <div key={r.id} className="rounded-lg liquid-glass p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className={`w-3.5 h-3.5 ${s <= r.rating ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />
                  ))}
                </div>
                <span className="text-ds-11 text-muted-foreground">by {r.reviewerName || "User"}</span>
              </div>
              <button
                onClick={() => setReportReviewId(r.id)}
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                title="Report this review"
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
            </div>
            {(r.punctuality || r.quality || r.communication) && (
              <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
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
    </div>
  );
};
