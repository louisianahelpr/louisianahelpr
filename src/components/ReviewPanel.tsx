import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Star, Flag } from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";

interface ReviewFormProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  revieweeId: string;
  revieweeName: string;
}

export const ReviewForm = ({ open, onClose, jobId, revieweeId, revieweeName }: ReviewFormProps) => {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const quickOptions = ["Great communicator", "On time", "Quality work", "Very professional", "Highly recommend", "Friendly & helpful"];

  const toggleQuickOption = (option: string) => {
    setFeedback(prev => {
      const parts = prev.split(", ").filter(Boolean);
      if (parts.includes(option)) return parts.filter(p => p !== option).join(", ");
      return [...parts, option].join(", ");
    });
  };

  const handleSubmit = async () => {
    if (rating === 0) { toast.error("Please select a rating"); return; }
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("You must be logged in"); setSubmitting(false); return; }

    const { error } = await supabase.from("reviews").insert({
      job_id: jobId,
      reviewer_id: user.id,
      reviewee_id: revieweeId,
      rating,
      feedback: feedback.trim() || null,
    });

    if (error) {
      if (error.code === "23505") toast.error("You've already reviewed this job.");
      else toast.error("Failed to submit review");
    } else {
      toast.success("Review submitted!");
      onClose();
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Review {revieweeName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-1 justify-center">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                onClick={() => setRating(s)}
                onMouseEnter={() => setHoverRating(s)}
                onMouseLeave={() => setHoverRating(0)}
              >
                <Star
                  className={`w-8 h-8 transition-colors ${
                    s <= (hoverRating || rating)
                      ? "fill-accent text-accent"
                      : "text-muted-foreground/30"
                  }`}
                />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
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
          <Button onClick={handleSubmit} disabled={submitting || rating === 0}>
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
  feedback: string | null;
  created_at: string;
  reviewer_id: string;
  reviewerName?: string;
};

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
        setReviews(data.map((r) => ({ ...r, reviewerName: profileMap.get(r.reviewer_id) })));
      }
      setLoading(false);
    };
    load();
  }, [userId]);

  const avg = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  if (loading) return <p className="text-sm text-muted-foreground">Loading reviews…</p>;
  if (reviews.length === 0) return <p className="text-sm text-muted-foreground">No reviews yet.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star
              key={s}
              className={`w-5 h-5 ${s <= Math.round(avg) ? "fill-accent text-accent" : "text-muted-foreground/30"}`}
            />
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          {avg.toFixed(1)} ({reviews.length} review{reviews.length !== 1 ? "s" : ""})
        </span>
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
