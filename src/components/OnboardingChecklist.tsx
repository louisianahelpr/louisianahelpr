import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Circle, X, Sparkles, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface OnboardingChecklistProps {
  userId: string;
  profile: {
    email_verified?: boolean | null;
    avatar_url?: string | null;
    bio?: string | null;
    stripe_account_id?: string | null;
  } | null;
}

type Step = {
  key: string;
  label: string;
  done: boolean;
  href: string;
  cta: string;
};

const DISMISS_KEY = "helpr_onboarding_dismissed_at";

/**
 * First-run guidance card pinned to the top of the dashboard.
 * Auto-hides once all steps are complete OR when the user dismisses it.
 * No DB schema needed — all state derived from existing tables + localStorage.
 */
const OnboardingChecklist = ({ userId, profile }: OnboardingChecklistProps) => {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    return !!localStorage.getItem(DISMISS_KEY);
  });
  const [counts, setCounts] = useState({
    parishes: 0,
    postedJobs: 0,
    applications: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId || dismissed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [parishesRes, jobsRes, appsRes] = await Promise.all([
        supabase
          .from("helper_preferred_parishes")
          .select("id", { count: "exact", head: true })
          .eq("helper_id", userId),
        supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", userId),
        supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("helper_id", userId),
      ]);
      if (cancelled) return;
      setCounts({
        parishes: parishesRes.count ?? 0,
        postedJobs: jobsRes.count ?? 0,
        applications: appsRes.count ?? 0,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, dismissed]);

  const steps: Step[] = useMemo(
    () => [
      {
        key: "email",
        label: "Verify your email",
        done: !!profile?.email_verified,
        href: "/profile",
        cta: "Resend",
      },
      {
        key: "profile_picture",
        label: "Upload a profile picture",
        done: !!profile?.avatar_url,
        href: "/profile",
        cta: "Upload",
      },
      {
        key: "bio",
        label: "Write a short bio",
        done: !!(profile?.bio && profile.bio.trim().length > 10),
        href: "/profile",
        cta: "Edit",
      },
      {
        key: "parishes",
        label: "Pick your home parishes",
        done: counts.parishes > 0,
        href: "/profile",
        cta: "Choose",
      },
      {
        key: "stripe",
        label: "Set up payouts",
        done: !!profile?.stripe_account_id,
        href: "/profile",
        cta: "Connect",
      },
      {
        key: "first_action",
        label: "Post a job or apply to one",
        done: counts.postedJobs > 0 || counts.applications > 0,
        href: counts.postedJobs > 0 || counts.applications > 0 ? "/activity" : "/post-job",
        cta: counts.postedJobs > 0 || counts.applications > 0 ? "View" : "Start",
      },
    ],
    [profile, counts]
  );

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;
  const progress = Math.round((completedCount / steps.length) * 100);

  if (loading || dismissed || allDone) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-accent/5 p-4 shadow-sm relative"
      >
        <button
          onClick={handleDismiss}
          aria-label="Dismiss onboarding checklist"
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors p-1"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-3 pr-8">
          <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-display font-bold text-foreground">
              Get set up on Helpr
            </h3>
            <p className="text-xs text-muted-foreground">
              {completedCount} of {steps.length} complete · {progress}%
            </p>
          </div>
        </div>

        <div className="h-1.5 rounded-full bg-secondary overflow-hidden mb-4">
          <motion.div
            className="h-full bg-gradient-to-r from-primary to-accent"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>

        <ul className="space-y-1.5">
          {steps.map((step) => (
            <li key={step.key}>
              <Link
                to={step.href}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                  step.done
                    ? "text-muted-foreground"
                    : "hover:bg-card text-foreground"
                }`}
              >
                {step.done ? (
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                )}
                <span
                  className={`flex-1 text-sm ${
                    step.done ? "line-through" : "font-medium"
                  }`}
                >
                  {step.label}
                </span>
                {!step.done && (
                  <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary">
                    {step.cta}
                    <ChevronRight className="w-3 h-3" />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </motion.div>
    </AnimatePresence>
  );
};

export default OnboardingChecklist;
