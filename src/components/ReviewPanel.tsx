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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </div>
      <div className="flex gap-0.5 shrink-0">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(0)}
            className="p-0.5"
            aria-label={`${label} ${s} star${s > 1 ? "s" : ""}`}
          >
            <Star
              className={`w-6 h-6 transition-colors ${
                s <= (hover || value) ? "fill-accent text-accent" : "text-muted-foreground/30"
              }`}
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Review {revieweeName}</DialogTitle>
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
          <div className="flex flex-wrap gap-2 pt-1">
            {quickOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => toggleQuickOption(opt)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  feedback.includes(opt)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-secondary-foreground border-border hover:bg-accent"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          <Textarea
            placeholder="Add a comment (optional)…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !allRated}>
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
  const [loading, setLoading] = useState(true);
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
      setLoading(false);
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

  if (loading) return <p className="text-sm text-muted-foreground">Loading reviews…</p>;
  if (reviews.length === 0) return <p className="text-sm text-muted-foreground">No reviews yet.</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                className={`w-5 h-5 ${s <= Math.round(overallAvg) ? "fill-accent text-accent" : "text-muted-foreground/30"}`}
              />
            ))}
          </div>
          <span className="text-sm text-muted-foreground">
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
                <p className="text-xs font-semibold text-foreground">{cat.v > 0 ? cat.v.toFixed(1) : "—"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-3">
        {reviews.map((r) => (
          <div key={r.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className={`w-3.5 h-3.5 ${s <= r.rating ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">by {r.reviewerName || "User"}</span>
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
            {r.feedback && <p className="text-sm text-foreground">{r.feedback}</p>}
            <p className="text-xs text-muted-foreground mt-1">{new Date(r.created_at).toLocaleDateString()}</p>
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
