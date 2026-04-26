/**
 * Onboarding checklist card pinned to the top of the Dashboard.
 *
 * Tracks 6 setup steps derived from existing data — no schema changes required.
 * Hides automatically when all steps are complete, or when the user dismisses it
 * (stored per-device in safeStorage).
 *
 * See mem://features/onboarding-checklist for the full spec.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Circle, X, Sparkles, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeStorage } from "@/lib/safeStorage";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const DISMISSED_KEY = "helpr_onboarding_dismissed_at";

interface Step {
  key: string;
  label: string;
  done: boolean;
  to: string;
  cta: string;
}

interface OnboardingChecklistProps {
  userId: string | undefined;
  profile: Profile | null;
}

const OnboardingChecklist = ({ userId, profile }: OnboardingChecklistProps) => {
  const [dismissed, setDismissed] = useState(() => Boolean(safeStorage.getItem(DISMISSED_KEY)));
  const [parishCount, setParishCount] = useState<number | null>(null);
  const [hasActivity, setHasActivity] = useState<boolean | null>(null);

  // Lightweight count queries — both head:true so no payload comes back.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [parishRes, postedRes, appliedRes] = await Promise.all([
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
      setParishCount(parishRes.count ?? 0);
      setHasActivity((postedRes.count ?? 0) > 0 || (appliedRes.count ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const steps: Step[] = useMemo(() => {
    const isHelper = profile?.role === "helper";
    return [
      {
        key: "email",
        label: "Verify your email",
        done: Boolean(profile?.email_verified),
        to: "/profile",
        cta: "Verify",
      },
      {
        key: "avatar",
        label: "Add a profile photo",
        done: Boolean(profile?.avatar_url),
        to: "/profile",
        cta: "Upload",
      },
      {
        key: "bio",
        label: "Write a short bio",
        done: (profile?.bio?.trim().length ?? 0) > 10,
        to: "/profile",
        cta: "Write",
      },
      {
        key: "parishes",
        label: isHelper ? "Pick parishes you serve" : "Set your home parish",
        done: isHelper ? (parishCount ?? 0) > 0 : Boolean(profile?.parish),
        to: isHelper ? "/profile?tab=schedule" : "/profile",
        cta: "Choose",
      },
      {
        key: "payouts",
        label: isHelper ? "Connect your payout account" : "Save a payment method",
        done: Boolean(profile?.stripe_account_id),
        to: "/profile?tab=earnings",
        cta: "Connect",
      },
      {
        key: "activity",
        label: isHelper ? "Send your first application" : "Post your first job",
        done: Boolean(hasActivity),
        to: isHelper ? "/dashboard" : "/post-job",
        cta: isHelper ? "Browse" : "Post",
      },
    ];
  }, [profile, parishCount, hasActivity]);

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const percent = Math.round((completed / total) * 100);

  // Hide if dismissed, fully complete, or still waiting on the first count query.
  if (dismissed) return null;
  if (parishCount === null || hasActivity === null) return null;
  if (completed === total) return null;

  const handleDismiss = () => {
    safeStorage.setItem(DISMISSED_KEY, new Date().toISOString());
    setDismissed(true);
  };

  // Surface the next incomplete step as the primary CTA.
  const nextStep = steps.find((s) => !s.done);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/5 via-background to-accent/5 p-4 shadow-sm relative overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-display font-bold text-foreground leading-tight">
                Finish setting up
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {completed} of {total} done — boost your match rate
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss onboarding checklist"
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 -mt-1 -mr-1 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
          />
        </div>

        {/* Step list */}
        <ul className="space-y-1.5 mb-3">
          {steps.map((step) => (
            <li key={step.key}>
              <Link
                to={step.to}
                className={`flex items-center gap-2 text-xs py-1 px-1.5 rounded-lg transition-colors ${
                  step.done
                    ? "text-muted-foreground line-through"
                    : "text-foreground hover:bg-primary/5"
                }`}
              >
                {step.done ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                )}
                <span className="flex-1 truncate">{step.label}</span>
                {!step.done && (
                  <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                )}
              </Link>
            </li>
          ))}
        </ul>

        {nextStep && (
          <Button asChild size="sm" className="w-full h-8 text-xs rounded-xl btn-press">
            <Link to={nextStep.to}>
              {nextStep.cta} — {nextStep.label.toLowerCase()}
            </Link>
          </Button>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default OnboardingChecklist;
