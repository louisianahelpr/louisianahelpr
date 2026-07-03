import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Megaphone,
  Handshake,
  Hammer,
  Wallet,
  Share2,
  RotateCcw,
  Users as UsersIcon,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticSuccess, hapticLight } from "@/lib/haptics";
import { InlineSuccessCheck } from "@/components/feedback/SuccessMoment";
import AuthShell from "@/components/auth/AuthShell";
import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { report } from "@/lib/errorLogger";
import { safeStorage } from "@/lib/safeStorage";
import { formatPrice } from "@/lib/format";

// Visual lifecycle preview — replaces the dense paragraph that used to
// sit in this same slot. Keeps the same content (4 stages from job-state
// machine: open → accepted → in_progress → completed) but presents it
// as scannable steps so customers know what to expect next.
const LIFECYCLE_STEPS = [
  { icon: Megaphone, label: "Posted", caption: "Your job is live for nearby Helprs." },
  { icon: Handshake, label: "Accepted", caption: "You review applicants and pick one." },
  { icon: Hammer, label: "In progress", caption: "Helpr arrives and gets to work." },
  { icon: Wallet, label: "Released", caption: "Both confirm — payment goes out." },
];

const PaymentSuccess = () => {
  usePageTitle("Payment Authorized — Helpr");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // The job id flows through either the success URL (Stripe-driven) or
  // the stashed `helpr_last_posted_job_id` (set right after job insert).
  // We resolve it once and use it for share / repost / view-applicants.
  const resolvedJobId =
    searchParams.get("job_id") ||
    (typeof window !== "undefined" ? safeStorage.getItem("helpr_last_posted_job_id") : null) ||
    null;
  const [sharing, setSharing] = useState(false);
  // The held-in-escrow amount, read once for display. This is a read-only
  // UI lookup of the job's posted budget — it does NOT touch payment
  // semantics. Null until loaded (or if the job can't be read), in which
  // case the amount line is simply omitted.
  const [escrowAmount, setEscrowAmount] = useState<number | null>(null);

  // Share the just-posted job. Follows the same Capacitor → Web Share →
  // clipboard tiered fallback as the existing ShareJobButton — repeated
  // here so this CTA doesn't pull in the whole button's styling.
  const handleShareJob = async () => {
    if (sharing || !resolvedJobId) return;
    setSharing(true);
    void hapticLight();
    const url = `${window.location.origin}/dashboard?job=${resolvedJobId}`;
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ url, title: "Job posted on Helpr", dialogTitle: "Share this job" });
      } else if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ url, title: "Job posted on Helpr" });
      } else if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied. Paste it anywhere.");
      } else {
        toast.message("Share this link", { description: url });
      }
    } catch (err) {
      const isCancel =
        err instanceof Error &&
        (err.name === "AbortError" || /cancel|dismiss/i.test(err.message));
      if (!isCancel) toast.error("Couldn't share — try again");
    } finally {
      setSharing(false);
    }
  };

  const handlePostAnother = () => {
    void hapticLight();
    // Clear the cached id so the next visit to this page doesn't
    // re-surface the wrong job.
    try { safeStorage.removeItem("helpr_last_posted_job_id"); } catch { /* ignore */ }
    if (resolvedJobId) {
      navigate(`/post-job?rebook=${resolvedJobId}`);
    } else {
      navigate("/post-job");
    }
  };

  const handleViewApplicants = () => {
    void hapticLight();
    try { safeStorage.removeItem("helpr_last_posted_job_id"); } catch { /* ignore */ }
    if (resolvedJobId) {
      navigate(`/my-posts?job=${resolvedJobId}`);
    } else {
      navigate("/my-posts");
    }
  };

  // Read the posted budget for the just-paid job so we can show the exact
  // amount now held in escrow. Read-only display lookup — no payment logic.
  useEffect(() => {
    if (!resolvedJobId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("budget")
        .eq("id", resolvedJobId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        report(error, { tags: { source: "PaymentSuccess.escrowAmount" } });
        return;
      }
      if (typeof data?.budget === "number") setEscrowAmount(data.budget);
    })();
    return () => { cancelled = true; };
  }, [resolvedJobId]);

  useEffect(() => {
    hapticSuccess();
    const jobId = searchParams.get("job_id") || null;
    const ppoProps = ppoTrackingProps();
    // Funnel: customer authorized payment — closes the customer funnel
    // that previously stopped at job_posted with no record of payment.
    track(AhaEvent.PaymentMade, { job_id: jobId, ...ppoProps });

    // First-payment aha — fire only when this is the user's first
    // successful payment. Mirrors the count-query pattern from
    // first_job_posted / first_job_application_sent.
    void (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { count } = await supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", user.id)
          .not("stripe_payment_intent_id", "is", null);
        if ((count ?? 0) <= 1) {
          track(AhaEvent.FirstPaymentCollected, { job_id: jobId, ...ppoProps });
        }
      } catch (e) {
        report(e, { tags: { source: "PaymentSuccess.firstPaymentCount" } });
      }
    })();
  }, [searchParams]);

  return (
    <AuthShell hideBack eyebrow="Payment authorized" maxWidth="md">
      <div className="liquid-glass p-7 sm:p-8 space-y-6 text-center">
        {/* Success moment — the job is posted + paid. The badge draws its
            checkmark in with a soft glow (static when reduced motion is on).
            hapticSuccess already fires in the effect above. */}
        <div className="flex justify-center">
          <InlineSuccessCheck size={88} />
        </div>

        <div className="space-y-2">
          <span className="text-display-eyebrow">All set</span>
          <h1 className="text-page-title leading-tight mt-1">
            Payment authorized.
          </h1>
          <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {escrowAmount != null ? (
              <>
                <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                  ${formatPrice(escrowAmount)}
                </span>{" "}
                is held securely — released when you confirm the work is done.
              </>
            ) : (
              <>Held securely until you confirm the work is done.</>
            )}
          </p>
        </div>

        <div
          className="flex items-start justify-center gap-3 rounded-2xl p-4 text-left"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "1px solid hsl(var(--bark) / 0.18)",
          }}
        >
          <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
          <p className="text-ds-11 font-sans leading-relaxed" style={{ color: "hsl(var(--olivewood))" }}>
            We hold it until you confirm the job's done. The Helpr is paid once both you and the Helpr mark it complete — your money stays protected the whole time.
          </p>
        </div>

        <div className="space-y-3 text-left">
          <p className="text-display-eyebrow">What happens next</p>
          <ol className="space-y-2.5">
            {LIFECYCLE_STEPS.map((step, i) => {
              const Icon = step.icon;
              const isFirst = i === 0;
              return (
                <li key={step.label} className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-ds-md flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background: isFirst ? "hsl(var(--bark) / 0.12)" : "hsl(var(--olivewood) / 0.08)",
                      border: `1px solid ${isFirst ? "hsl(var(--bark) / 0.25)" : "hsl(var(--olivewood) / 0.15)"}`,
                    }}
                  >
                    <Icon
                      className="w-4 h-4"
                      strokeWidth={1.75}
                      style={{ color: isFirst ? "hsl(var(--bark))" : "hsl(var(--olivewood))" }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                      {step.label}
                      {isFirst && (
                        <span
                          className="ml-2 text-ds-10 uppercase tracking-wider font-sans"
                          style={{ color: "hsl(var(--bark))" }}
                        >
                          you are here
                        </span>
                      )}
                    </p>
                    <p className="font-serif italic text-ds-11 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                      {step.caption}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="text-ds-11 font-sans leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            If one side confirms and the other doesn't respond within 48 hours, the job auto-completes and payment is released automatically.
          </p>
        </div>

        <div className="space-y-2.5">
          {/* Primary CTA — View applicants. Most actionable next step for
              the poster who just finished paying. */}
          <Button
            variant="bark"
            size="lg"
            onClick={handleViewApplicants}
            className="w-full rounded-ds-md"
          >
            <UsersIcon className="w-4 h-4 mr-2" />
            View applicants
          </Button>
          {/* Secondary CTA row — share + post-another-like-this. */}
          <div className="grid grid-cols-2 gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={handleShareJob}
              disabled={sharing || !resolvedJobId}
              className="w-full rounded-ds-md"
            >
              <Share2 className="w-4 h-4 mr-1" /> Share
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handlePostAnother}
              className="w-full rounded-ds-md"
            >
              <RotateCcw className="w-4 h-4 mr-1" /> Post another
            </Button>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              try { safeStorage.removeItem("helpr_last_posted_job_id"); } catch { /* ignore */ }
              navigate("/dashboard");
            }}
            className="w-full rounded-ds-md"
            style={{ color: "hsl(var(--bark))" }}
          >
            Back to dashboard
          </Button>
        </div>
      </div>
    </AuthShell>
  );
};

export default PaymentSuccess;
