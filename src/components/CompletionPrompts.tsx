import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Star, Gift, PartyPopper, Heart, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { fetchReferralData } from "@/hooks/useReferralData";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";

// NpsPrompt is mounted as the final step in the post-completion sequence —
// after review/tip/share. It self-gates on eligibility (2nd qualifying job
// + no prior submission + no 90-day local cooldown), so most invocations
// resolve to nothing. Lazy-loaded so it only enters the bundle when a job
// completes.
const NpsPrompt = lazy(() => import("@/components/feedback/NpsPrompt").then((m) => ({ default: m.NpsPrompt })));

type CompletionPromptsProps = {
  jobId: string;
  jobTitle: string;
  revieweeId: string;
  revieweeName: string;
  userId: string;
  onDone: () => void;
  /** True when the current viewer is the helper (not the poster). */
  isHelper?: boolean;
  /** Category of the completed job — drives the "more work" suggestions. */
  jobCategory?: Database["public"]["Enums"]["job_category"] | null;
};

export const CompletionPrompts = ({ jobId, jobTitle, revieweeId, revieweeName, userId, onDone, isHelper = false, jobCategory }: CompletionPromptsProps) => {
  const [step, setStep] = useState<"review" | "tip" | "share" | "nps" | null>("review");

  // "More work nearby" — only useful when the viewer is the helper.
  // Fetches up to 3 open jobs in the same category once the share step opens.
  const { data: nearbyJobs } = useQuery({
    queryKey: ["more-work-nearby", jobId, jobCategory],
    queryFn: async () => {
      if (!jobCategory) return [];
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, budget, category")
        .eq("status", "open")
        .eq("category", jobCategory)
        .neq("id", jobId)
        .limit(3);
      if (error) {
        report(error, { tags: { source: "CompletionPrompts.nearbyJobs" } });
        return [];
      }
      return data ?? [];
    },
    staleTime: 60_000,
    enabled: isHelper && step === "share" && !!jobCategory,
  });
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [, setAlreadyReviewed] = useState(false);
  const [customTip, setCustomTip] = useState<number | undefined>(undefined);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const quickOptions = ["Great communicator", "On time", "Quality work", "Very professional", "Highly recommend", "Friendly & helpful"];

  // Lazy-fetch referral code only when we hit the share step. Job-completion
  // is the highest-affinity moment — both parties just had a good experience.
  useEffect(() => {
    if (step !== "share" || referralCode) return;
    // Best-effort: fetchReferralData now throws on a failed read, so
    // swallow it here — the share step degrades to no referral link
    // rather than surfacing an unhandled rejection.
    fetchReferralData(userId)
      .then((d) => setReferralCode(d.referralCode))
      .catch(() => { /* referral link unavailable — skip */ });
  }, [step, referralCode, userId]);

  const referralLink = referralCode
    ? `https://www.louisianahelpr.com/?ref=${referralCode}`
    : "";

  const copyReferral = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setReferralCopied(true);
      toast.success("Link copied.");
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
    supabase.from("reviews").select("id").eq("job_id", jobId).eq("reviewer_id", userId).then(({ data, error }) => {
      if (error) report(error, { tags: { source: "CompletionPrompts.alreadyReviewed" } });
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
      else { hapticError(); toast.error("We couldn't submit your review — please try again."); }
    } else {
      hapticSuccess();
      toast.success("Review submitted — thanks for your feedback.");

      // Check for repeat low ratings → auto-flag
      const { data: allReviews, error: allReviewsErr } = await supabase.from("reviews").select("rating").eq("reviewee_id", revieweeId);
      if (allReviewsErr) report(allReviewsErr, { tags: { source: "CompletionPrompts.lowRatingCheck" } });
      if (allReviews) {
        const lowRatings = allReviews.filter(r => r.rating <= 2).length;
        if (lowRatings >= 3) {
          // Auto-flag for admin review.
          const { error: flagErr } = await supabase.from("user_violations").insert({
            user_id: revieweeId,
            violation_type: "low_ratings",
            description: `User has ${lowRatings} ratings of 2 stars or below. Auto-flagged for admin review.`,
            reported_by: null,
            action_taken: "warning",
          });
          if (flagErr) report(flagErr, { tags: { source: "CompletionPrompts.autoFlagLowRating" } });
          // Bulk-insert one row per admin instead of awaiting per admin.
          // For 5+ admins this difference is visible to the user (~1.5s vs ~300ms).
          const { data: adminRoles, error: adminRolesErr } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
          if (adminRolesErr) report(adminRolesErr, { tags: { source: "CompletionPrompts.lowRatingNotifyAdmins" } });
          if (adminRoles?.length) {
            const { error: notifyErr } = await supabase.from("notifications").insert(
              adminRoles.map((a: { user_id: string }) => ({
                user_id: a.user_id,
                title: "⚠️ Low rating alert",
                message: `A user has received ${lowRatings} low ratings and has been auto-flagged.`,
                type: "warning",
                link: "/admin?view=fraud",
                read: false,
              })),
            );
            if (notifyErr) report(notifyErr, { tags: { source: "CompletionPrompts.notifyLowRating" } });
          }
        }
      }
      setStep("tip");
    }
  };

  // One stable id per mounted tip prompt. The server salts its Stripe
  // idempotency key with this instead of a 10-minute time bucket, so a retry —
  // double-tap, flaky network, a slow first request — always collapses onto the
  // same checkout session no matter how much wall-clock time passed. The old
  // bucket meant a retry straddling the boundary produced a SECOND session and
  // a second pending tips row. A successful send navigates away to Stripe, so
  // the component unmounts and a genuinely new tip attempt gets a fresh id on
  // remount — no manual regeneration needed.
  const tipAttemptIdRef = useRef<string>(crypto.randomUUID());

  const sendTip = async (amount: number) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: { action: "tip", jobId, amount, tipAttemptId: tipAttemptIdRef.current },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) window.location.href = data.url;
      else throw new Error("Couldn't start checkout. Please try again.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't send that tip — please try again";
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
          <DialogHero
            eyebrowClassName="inline-flex items-center gap-1.5"
            eyebrow={
              <>
                <PartyPopper className="w-3 h-3" /> Job complete
              </>
            }
            title={`Rate ${revieweeName}`}
          />
          <div className="space-y-4">
            <p className="text-ds-11 text-muted-foreground">How was your experience with {revieweeName} on "{jobTitle}"?</p>
            <div className="flex gap-1 justify-center">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} onClick={() => setRating(s)} onMouseEnter={() => setHoverRating(s)} onMouseLeave={() => setHoverRating(0)} aria-label={`Rate ${s} star${s === 1 ? "" : "s"}`}>
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
            <Textarea aria-label="Comment (optional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} />
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
          <DialogHero
            eyebrowClassName="inline-flex items-center gap-1.5"
            eyebrow={
              <>
                <Gift className="w-3 h-3" /> Optional
              </>
            }
            title="Say Thanks with a Tip?"
          />
          <div className="space-y-4">
            <p className="text-ds-11 text-muted-foreground">Tips go directly to {revieweeName}. Totally optional!</p>
            <div className="space-y-2">
              <label htmlFor="custom-tip-amount" className="text-ds-13 font-medium text-foreground">Enter your tip</label>
              <div className="flex gap-2">
                <CurrencyInput
                  id="custom-tip-amount"
                  className="flex-1 text-ds-17 font-semibold"
                  value={customTip}
                  onChange={setCustomTip}
                  min={1}
                  aria-label="Custom tip amount in dollars"
                />
                <Button
                  className="h-12 px-6"
                  onClick={() => sendTip(customTip ?? 0)}
                  disabled={saving || customTip === undefined || customTip <= 0}
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
            <Button variant="ghost" onClick={() => setStep("share")}>No Thanks</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Prompt — peak emotional moment. Job is done, both parties
          are happy. Best time to ask for a referral. Hidden if we
          couldn't load a referral code (offline / first-time edge). */}
      <Dialog open={step === "share"} onOpenChange={() => setStep("nps")}>
        <DialogContent>
          <DialogHero
            eyebrowClassName="inline-flex items-center gap-1.5"
            eyebrow={
              <>
                <Heart className="w-3 h-3" /> Spread the word
              </>
            }
            title="Loved It? Share Helpr."
          />
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
                <Button size="sm" onClick={copyReferral} className="rounded-ds-sm shrink-0">
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

            {/* More work nearby — only shown to helpers once the share step
                loads. Gives them 1-2 open jobs in the same category so they
                can jump straight from completion to the next opportunity. */}
            {isHelper && nearbyJobs && nearbyJobs.length > 0 && (
              <div className="pt-3 border-t border-border/40">
                <p className="text-ds-12 font-medium text-foreground mb-2">
                  More {jobCategory} work nearby
                </p>
                <div className="space-y-1.5">
                  {nearbyJobs.slice(0, 2).map((j) => (
                    <div key={j.id} className="flex items-center justify-between gap-2 text-ds-12">
                      <span className="truncate text-muted-foreground">{j.title}</span>
                      <Link
                        to="/jobs"
                        onClick={onDone}
                        className="shrink-0 font-semibold"
                        style={{ color: "hsl(var(--sage))" }}
                      >
                        ${j.budget} →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStep("nps")}>Maybe Later</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NPS prompt — terminal step. Self-gates on eligibility (2nd
          qualifying completed job + no prior submission + no local
          cooldown). For users who don't qualify it resolves to a no-op
          and immediately calls onDone(); for those who do, it shows the
          bottom-sheet survey and onDone() runs once they submit/dismiss.
          Either way the dialog stack closes correctly. */}
      {step === "nps" && (
        <Suspense fallback={null}>
          <NpsPrompt userId={userId} onClose={() => { setStep(null); onDone(); }} />
        </Suspense>
      )}
    </>
  );
};
