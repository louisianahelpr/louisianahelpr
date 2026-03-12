import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, Gift, PartyPopper } from "lucide-react";
import { toast } from "sonner";

type CompletionPromptsProps = {
  jobId: string;
  jobTitle: string;
  revieweeId: string;
  revieweeName: string;
  userId: string;
  onDone: () => void;
};

export const CompletionPrompts = ({ jobId, jobTitle, revieweeId, revieweeName, userId, onDone }: CompletionPromptsProps) => {
  const [step, setStep] = useState<"review" | "tip" | null>("review");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);

  useEffect(() => {
    // Check if already reviewed
    supabase.from("reviews").select("id").eq("job_id", jobId).eq("reviewer_id", userId).then(({ data }) => {
      if (data && data.length > 0) {
        setAlreadyReviewed(true);
        setStep("tip");
      }
    });
  }, [jobId, userId]);

  const submitReview = async () => {
    if (rating === 0) { toast.error("Please select a rating"); return; }
    setSaving(true);
    const { error } = await supabase.from("reviews").insert({
      job_id: jobId, reviewer_id: userId, reviewee_id: revieweeId,
      rating, feedback: feedback.trim() || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === "23505") { toast.info("You've already reviewed this job"); setStep("tip"); }
      else toast.error(error.message);
    } else {
      toast.success("Review submitted! Thanks for your feedback.");

      // Check for repeat low ratings → auto-flag
      const { data: allReviews } = await supabase.from("reviews").select("rating").eq("reviewee_id", revieweeId);
      if (allReviews) {
        const lowRatings = allReviews.filter(r => r.rating <= 2).length;
        if (lowRatings >= 3) {
          // Auto-flag for admin review
          await (supabase.from("user_violations" as any) as any).insert({
            user_id: revieweeId, violation_type: "low_ratings",
            description: `User has ${lowRatings} ratings of 2 stars or below. Auto-flagged for admin review.`,
            reported_by: null, action_taken: "warning",
          });
          const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
          if (adminRoles) {
            for (const admin of adminRoles) {
              await createNotification({
                user_id: admin.user_id, title: "⚠️ Low rating alert",
                message: `A user has received ${lowRatings} low ratings and has been auto-flagged.`,
                type: "warning", link: "/admin",
              });
            }
          }
        }
      }
      setStep("tip");
    }
  };

  const sendTip = async (amount: number) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "tip", jobId, amount } });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to create tip");
    } finally {
      setSaving(false);
    }
  };

  if (!step) return null;

  return (
    <>
      {/* Review Prompt */}
      <Dialog open={step === "review"} onOpenChange={() => { setStep("tip"); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <PartyPopper className="w-5 h-5 text-primary" /> Job Complete! Rate {revieweeName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">How was your experience with {revieweeName} on "{jobTitle}"?</p>
            <div className="flex gap-1 justify-center">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} onClick={() => setRating(s)} onMouseEnter={() => setHoverRating(s)} onMouseLeave={() => setHoverRating(0)}>
                  <Star className={`w-8 h-8 transition-colors ${s <= (hoverRating || rating) ? "fill-primary text-primary" : "text-muted-foreground/30"}`} />
                </button>
              ))}
            </div>
            <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Optional feedback…" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStep("tip")}>Skip</Button>
            <Button onClick={submitReview} disabled={saving || rating === 0}>
              {saving ? "Submitting…" : "Submit Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tip Prompt */}
      <Dialog open={step === "tip"} onOpenChange={() => { setStep(null); onDone(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Gift className="w-5 h-5 text-primary" /> Say thanks with a tip?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Tips go directly to {revieweeName}. Totally optional!</p>
            <div className="flex gap-3 justify-center">
              {[5, 10, 20].map((amt) => (
                <Button key={amt} variant="outline" size="lg" onClick={() => sendTip(amt)} disabled={saving} className="text-lg font-bold">
                  ${amt}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setStep(null); onDone(); }}>No thanks</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
