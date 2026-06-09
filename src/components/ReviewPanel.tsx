import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Star, Flag } from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { maybeRequestInAppReview } from "@/lib/inAppReview";
import { maybeCelebrate } from "@/lib/celebrate";
import { hapticLight, hapticSuccess, hapticError } from "@/lib/haptics";
import { track, AhaEvent } from "@/lib/analytics";
import { TipDialog } from "@/components/TipDialog";

interface ReviewFormProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  revieweeId: string;
  revieweeName: string;
}

type CategoryKey = "rating" | "punctuality" | "quality" | "communication";

const CATEGORY_ROWS: { key: CategoryKey; label: string; sublabel: string; required: boolean }[] = [
  { key: "rating", label: "Overall", sublabel: "Your overall experience", required: true },
  { key: "punctuality", label: "Punctuality", sublabel: "Showed up on time", required: false },
  { key: "quality", label: "Quality of work", sublabel: "Met expectations", required: false },
  { key: "communication", label: "Communication", sublabel: "Clear and responsive", required: false },
];

const StarRow = ({
  value,
  onChange,
  label,
  sublabel,
  optional,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  sublabel: string;
  /** Optional categories render a quiet "Optional" tag so users know
   *  they can skip them — only the Overall rating gates submission. */
  optional?: boolean;
}) => {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl liquid-glass p-3.5">
      <div className="flex-1 min-w-0">
        <p
          className="font-display italic font-bold leading-tight flex items-center gap-1.5"
          style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
        >
          {label}
          {optional && (
            <span
              className="font-serif italic"
              style={{ fontSize: "0.62rem", color: "hsl(var(--olivewood) / 0.55)", letterSpacing: "0.04em" }}
            >
              Optional
            </span>
          )}
        </p>
        <p
          className="font-serif italic mt-0.5"
          style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.7)" }}
        >
          {sublabel}
        </p>
      </div>
      <div
        className="flex gap-0.5 shrink-0"
        role="radiogroup"
        aria-label={`${label} rating`}
      >
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === value}
            onClick={() => { hapticLight(); onChange(s); }}
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
  // When a poster leaves a 5-star review, surface a tip prompt before
  // closing the form. Tighter than the separate Tip flow — caught at
  // the moment of peak satisfaction.
  const [tipPromptOpen, setTipPromptOpen] = useState(false);
  const [tipDialogOpen, setTipDialogOpen] = useState(false);

  const quickOptions = ["Great communicator", "On time", "Quality work", "Very professional", "Highly recommend", "Friendly & helpful"];

  const toggleQuickOption = (option: string) => {
    setFeedback((prev) => {
      const parts = prev.split(", ").filter(Boolean);
      if (parts.includes(option)) return parts.filter((p) => p !== option).join(", ");
      return [...parts, option].join(", ");
    });
  };

  const setScore = (key: CategoryKey, v: number) => setScores((prev) => ({ ...prev, [key]: v }));

  // Only the Overall rating is required to submit. The three detailed
  // categories are optional — previously requiring all four meant a
  // user who only wanted to leave an overall star rating hit a hard
  // wall ("Please rate all four categories") and the job silently
  // never got reviewed.
  const canSubmit = scores.rating > 0;
  // True once the user has also filled the detailed categories — used
  // only to brighten the submit button as positive reinforcement.
  const allRated = canSubmit && scores.punctuality > 0 && scores.quality > 0 && scores.communication > 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      hapticError();
      toast.error("Tap an Overall star rating to leave your review.");
      return;
    }
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { hapticError(); toast.error("Please sign back in to leave your review."); setSubmitting(false); return; }

    const { error } = await supabase.from("reviews").insert({
      job_id: jobId,
      reviewer_id: user.id,
      reviewee_id: revieweeId,
      rating: scores.rating,
      // Unrated detailed categories persist as null (not 0) so the
      // ReviewList averages skip them rather than dragging the score down.
      punctuality: scores.punctuality > 0 ? scores.punctuality : null,
      quality: scores.quality > 0 ? scores.quality : null,
      communication: scores.communication > 0 ? scores.communication : null,
      feedback: feedback.trim() || null,
    });

    if (error) {
      hapticError();
      if (error.code === "23505") toast.error("You've already reviewed this job.");
      else toast.error("We couldn't post your review — please try again.");
    } else {
      hapticSuccess();
      toast.success("Review submitted!");
      // Brand-tinted confetti for the first few reviews so the moment
      // feels worth doing again. After the limit it fades to silent.
      void maybeCelebrate("first_review");
      // Aha-moment analytics + native review prompt. A 5-star review is the
      // strongest signal that this user would also rate us 5 stars on the App Store.
      track(AhaEvent.ReviewLeft, { job_id: jobId, rating: scores.rating });
      // True first-review (any rating) — count this user's prior reviews
      // before treating this submission as the first.
      try {
        const { count: priorReviews } = await supabase
          .from("reviews")
          .select("id", { count: "exact", head: true })
          .eq("reviewer_id", user.id);
        if ((priorReviews ?? 0) <= 1) {
          track(AhaEvent.FirstReviewLeft, { job_id: jobId, rating: scores.rating });
        }
      } catch { /* analytics must never break the flow */ }
      if (scores.rating === 5) {
        track(AhaEvent.FirstFiveStarReview, { job_id: jobId, rating: 5 });
        // Fire-and-forget — internally rate-limited to once per 90 days.
        void maybeRequestInAppReview();
        // 5-star moment — show the tip prompt instead of closing
        // immediately so the poster can tip while still satisfied.
        setTipPromptOpen(true);
        setSubmitting(false);
        return;
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
              optional={!row.required}
            />
          ))}
          <p
            className="font-serif italic"
            style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.65)" }}
          >
            Only the Overall rating is needed — the rest are optional. You can skip them and still post your review.
          </p>
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
        <DialogFooter className="!flex-col !gap-2 !items-stretch">
          <Button
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className="rounded-ds-md w-full"
            style={{
              background: canSubmit ? "hsl(var(--bark))" : undefined,
              backgroundImage: "none",
              border: canSubmit ? "1px solid hsl(var(--bark))" : undefined,
              color: canSubmit ? "hsl(var(--parchment))" : undefined,
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.01em",
              boxShadow: canSubmit ? "0 1px 2px hsl(var(--bark) / 0.18), 0 8px 20px -6px hsl(var(--bark) / 0.34)" : undefined,
            }}
          >
            {submitting ? "Submitting…" : allRated ? "Submit review" : "Post review"}
          </Button>
          {/* A non-destructive escape hatch. "Cancel" reads as "discard",
              which is wrong here — the review isn't lost, it can still be
              left later from the completed job. This says so plainly so a
              user who isn't ready right now doesn't feel pressured. */}
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            className="rounded-ds-md w-full"
          >
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Tip prompt — only opens after a 5-star review. Tighter than
          waiting for the separate tip flow on Activity. */}
      <Dialog open={tipPromptOpen} onOpenChange={(o) => { if (!o) { setTipPromptOpen(false); onClose(); } }}>
        <DialogContent className="!gap-3 sm:max-w-sm">
          <DialogHeader className="!text-left space-y-0">
            <span
              className="font-serif italic uppercase"
              style={{ fontSize: "0.62rem", color: "hsl(var(--gold-warm))", letterSpacing: "0.18em" }}
            >
              Five stars — nice
            </span>
            <DialogTitle
              className="font-display italic font-bold leading-tight mt-1"
              style={{ fontSize: "clamp(1.25rem, 2vw + 0.4rem, 1.5rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
            >
              Send {revieweeName} a tip?
            </DialogTitle>
            <p className="font-serif italic mt-1" style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.75)" }}>
              Goes straight to the helpr — no platform cut. Most posters tip 10–15% for great work.
            </p>
          </DialogHeader>
          <DialogFooter className="!gap-2">
            <Button
              variant="ghost"
              onClick={() => { setTipPromptOpen(false); onClose(); }}
              className="rounded-ds-md"
            >
              No thanks
            </Button>
            <Button
              variant="bark"
              onClick={() => { setTipPromptOpen(false); setTipDialogOpen(true); }}
              className="rounded-ds-md"
            >
              Send a tip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TipDialog
        open={tipDialogOpen}
        onClose={() => { setTipDialogOpen(false); onClose(); }}
        jobId={jobId}
        helperName={revieweeName}
      />
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [reportReviewId, setReportReviewId] = useState<string | null>(null);

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
        setLoadFailed(true);
        setLoaded(true);
        return;
      }
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
