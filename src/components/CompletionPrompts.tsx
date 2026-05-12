import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Star, Gift, PartyPopper, Heart, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { fetchReferralData } from "@/hooks/useReferralData";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";

type CompletionPromptsProps = {
  jobId: string;
  jobTitle: string;
  revieweeId: string;
  revieweeName: string;
  userId: string;
  onDone: () => void;
};

export const CompletionPrompts = ({ jobId, jobTitle, revieweeId, revieweeName, userId, onDone }: CompletionPromptsProps) => {
  const [step, setStep] = useState<"review" | "tip" | "share" | null>("review");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [, setAlreadyReviewed] = useState(false);
  const [customTip, setCustomTip] = useState("");
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const quickOptions = ["Great communicator", "On time", "Quality work", "Very professional", "Highly recommend", "Friendly & helpful"];

  // Lazy-fetch referral code only when we hit the share step. Job-completion
  // is the highest-affinity moment — both parties just had a good experience.
  useEffect(() => {
    if (step !== "share" || referralCode) return;
    fetchReferralData(userId).then((d) => setReferralCode(d.referralCode));
  }, [step, referralCode, userId]);

  const referralLink = referralCode
    ? `https://www.louisianahelpr.com/?ref=${referralCode}`
    : "";

  const copyReferral = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setReferralCopied(true);
      toast.success("Link copied — paste it anywhere.");
      setTimeout(() => setReferralCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Try long-pressing the link.");
    }
  };

  const toggleQuickOption = (option: string) => {
    setFeedback(prev => {
      const parts = prev.split(", ").filter(Boolean);
      if (parts.includes(option)) return parts.filter(p => p !== option).join(", ");
      return [...parts, option].join(", ");
    });
  };

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
    if (rating === 0) { hapticError(); toast.error("Please select a rating"); return; }
    hapticMedium();
    setSaving(true);
    const { error } = await supabase.from("reviews").insert({
      job_id: jobId, reviewer_id: userId, reviewee_id: revieweeId,
      rating, feedback: feedback.trim() || null,
    });
    setSaving(false);
    if (error) {
      if (error.code === "23505") { toast.info("You've already reviewed this job"); setStep("tip"); }
      else { hapticError(); toast.error(error.message); }
    } else {
      hapticSuccess();
      toast.success("Review submitted! Thanks for your feedback.");

      // Check for repeat low ratings → auto-flag
      const { data: allReviews } = await supabase.from("reviews").select("rating").eq("reviewee_id", revieweeId);
      if (allReviews) {
        const lowRatings = allReviews.filter(r => r.rating <= 2).length;
        if (lowRatings >= 3) {
          // Auto-flag for admin review.
          await supabase.from("user_violations").insert({
            user_id: revieweeId,
            violation_type: "low_ratings",
            description: `User has ${lowRatings} ratings of 2 stars or below. Auto-flagged for admin review.`,
            reported_by: null,
            action_taken: "warning",
          });
          // Bulk-insert one row per admin instead of awaiting per admin.
          // For 5+ admins this difference is visible to the user (~1.5s vs ~300ms).
          const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
          if (adminRoles?.length) {
            await supabase.from("notifications").insert(
              adminRoles.map((a: { user_id: string }) => ({
                user_id: a.user_id,
                title: "⚠️ Low rating alert",
                message: `A user has received ${lowRatings} low ratings and has been auto-flagged.`,
                type: "warning",
                link: "/admin?view=fraud",
                read: false,
              })),
            );
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create tip";
      toast.error(message);
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
            <p className="text-ds-11 text-muted-foreground">How was your experience with {revieweeName} on "{jobTitle}"?</p>
            <div className="flex gap-1 justify-center">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} onClick={() => setRating(s)} onMouseEnter={() => setHoverRating(s)} onMouseLeave={() => setHoverRating(0)}>
                  <Star className={`w-8 h-8 transition-colors ${s <= (hoverRating || rating) ? "fill-primary text-primary" : "text-muted-foreground/30"}`} />
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {quickOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleQuickOption(opt)}
                  className={`text-ds-11 px-3 py-1.5 rounded-full border transition-colors ${
                    feedback.includes(opt)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-secondary-foreground border-border hover:bg-accent"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Add a comment (optional)…" rows={2} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStep("tip")}>Skip</Button>
            <Button onClick={submitReview} disabled={saving || rating === 0}>
              {saving ? "Submitting…" : "Submit Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tip Prompt — close advances to share step (peak emotional moment
          for a referral ask). Skipping the tip still hits the share step. */}
      <Dialog open={step === "tip"} onOpenChange={() => setStep("share")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Gift className="w-5 h-5 text-primary" /> Say thanks with a tip?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-ds-11 text-muted-foreground">Tips go directly to {revieweeName}. Totally optional!</p>
            <div className="space-y-2">
              <label htmlFor="custom-tip-amount" className="text-ds-13 font-medium text-foreground">Enter your tip</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
                  <Input
                    id="custom-tip-amount"
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={customTip}
                    onChange={(e) => setCustomTip(e.target.value)}
                    min="1"
                    className="pl-7 text-ds-17 font-semibold h-12"
                  />
                </div>
                <Button
                  className="h-12 px-6"
                  onClick={() => sendTip(parseFloat(customTip))}
                  disabled={saving || !customTip || parseFloat(customTip) <= 0}
                >
                  {saving ? "..." : "Send"}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-ds-11 text-muted-foreground">or quick pick</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex gap-3 justify-center">
              {[5, 10, 20].map((amt) => (
                <Button key={amt} variant="outline" size="lg" onClick={() => sendTip(amt)} disabled={saving} className="text-ds-17 font-bold">
                  ${amt}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStep("share")}>No thanks</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Prompt — peak emotional moment. Job is done, both parties
          are happy. Best time to ask for a referral. Hidden if we
          couldn't load a referral code (offline / first-time edge). */}
      <Dialog open={step === "share"} onOpenChange={() => { setStep(null); onDone(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Heart className="w-5 h-5 text-primary" /> Loved it? Share Helpr.
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-ds-11 text-muted-foreground">
              Helpr grows by neighbors telling neighbors. Send a friend
              your link — when they sign up and complete their first job,
              you both get a credit.
            </p>
            {referralLink ? (
              <div className="flex items-center gap-2 rounded-ds-md border border-border bg-muted/40 p-2 pl-3">
                <span className="flex-1 text-ds-11 font-mono truncate text-foreground">
                  {referralLink}
                </span>
                <Button size="sm" onClick={copyReferral} className="rounded-lg shrink-0">
                  {referralCopied ? (
                    <><Check className="w-4 h-4 mr-1" /> Copied</>
                  ) : (
                    <><Copy className="w-4 h-4 mr-1" /> Copy</>
                  )}
                </Button>
              </div>
            ) : (
              <p className="text-ds-11 text-muted-foreground italic">Loading your invite link…</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setStep(null); onDone(); }}>Maybe later</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
