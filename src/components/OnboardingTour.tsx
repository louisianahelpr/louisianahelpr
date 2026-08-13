import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { X, ArrowRight, ArrowLeft, CheckCircle2, Briefcase, User, MessageCircle, Search, Sparkles, Play } from "lucide-react";
import { safeStorage } from "@/lib/safeStorage";

type TourStep = {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  target?: string; // CSS selector to highlight
  action?: string; // navigation target
  position?: "center" | "top" | "bottom";
};

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Helpr.",
    description: "A quick walk-through so you know where everything lives. Takes under a minute.",
    icon: <Sparkles className="w-6 h-6" />,
    position: "center",
  },
  {
    id: "profile",
    title: "Complete your profile",
    description: "Add your name, location, and photo so others know who they're working with.",
    icon: <User className="w-6 h-6" />,
    action: "/profile",
  },
  {
    id: "browse",
    title: "Explore the dashboard",
    description: "Post jobs, browse open jobs, track applications, and manage everything from one place.",
    icon: <Search className="w-6 h-6" />,
    action: "/dashboard",
  },
  {
    id: "post-job",
    title: "Post or apply to jobs",
    description: "Need help? Post a job with your budget. Want to earn? Browse and apply to jobs nearby.",
    icon: <Briefcase className="w-6 h-6" />,
    action: "/post-job",
  },
  {
    id: "messages",
    title: "Chat & collaborate",
    description: "Message others directly to discuss details, share updates, and coordinate work.",
    icon: <MessageCircle className="w-6 h-6" />,
    action: "/messages",
  },
];

const STORAGE_KEY = "helpr_onboarding";

// Distinct keys for the two dismissal flavors and resume-step tracking.
// `dismissed_at` is permanent (Skip), `later_at` is a snooze that flips
// the dashboard "Resume tour" pill on. `step` lets resume start from
// where they left off rather than always step 0.
//
// Why three separate keys instead of one JSON blob? Each is a primitive
// timestamp / number that read/writes are trivially atomic across the
// Capacitor Preferences sync — no JSON.parse() crash risk on partial
// migrations, and we can clear individual flavors without rebuilding
// the blob. The legacy STORAGE_KEY blob remains for the seen/completed
// gating so existing users don't suddenly see the tour again.
const KEY_DISMISSED_AT = "helpr.onboarding_tour_dismissed_at";
const KEY_LATER_AT = "helpr.onboarding_tour_later_at";
const KEY_STEP = "helpr.onboarding_tour_step";

type OnboardingState = {
  completed: boolean;
  currentStep: number;
  dismissedAt?: string;
  completedSteps: string[];
  seen?: boolean;
};

const getState = (): OnboardingState => {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through to default below */
  }
  return { completed: false, currentStep: 0, completedSteps: [] };
};

const saveState = (state: OnboardingState) => {
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

// Read the resume step from the dedicated key. Falls back to the legacy
// blob's `currentStep` so users mid-tour at the time of this upgrade
// don't get bumped back to step 0.
const getResumeStep = (): number => {
  const raw = safeStorage.getItem(KEY_STEP);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 0 && n < TOUR_STEPS.length) return n;
  const legacy = getState().currentStep;
  return Number.isFinite(legacy) && legacy >= 0 && legacy < TOUR_STEPS.length ? legacy : 0;
};

interface OnboardingTourProps {
  profileComplete?: boolean;
  profileCreatedAt?: string | null;
}

const OnboardingTour = ({ profileComplete: _profileComplete = false, profileCreatedAt }: OnboardingTourProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<OnboardingState>(() => {
    const s = getState();
    // Honor the dedicated resume-step key on first paint so a Later →
    // re-launch flow lands on the same step the user dismissed from.
    const resume = getResumeStep();
    if (resume !== s.currentStep) return { ...s, currentStep: resume };
    return s;
  });
  const [visible, setVisible] = useState(false);
  // Resume pill — shown on /dashboard when the user previously chose
  // "Later" but hasn't permanently skipped or completed. Re-checks the
  // safeStorage flags whenever the route changes so a fresh tab pickup
  // works without a full reload.
  const [showResumePill, setShowResumePill] = useState(false);

  const steps = TOUR_STEPS;
  const currentStep = steps[state.currentStep] || steps[0];
  const progress = ((state.currentStep + 1) / steps.length) * 100;

  useEffect(() => {
    if (location.pathname !== "/dashboard") {
      setShowResumePill(false);
      return;
    }
    const s = getState();
    const dismissedAt = safeStorage.getItem(KEY_DISMISSED_AT);
    const laterAt = safeStorage.getItem(KEY_LATER_AT);

    // Permanently skipped or completed → never auto-show, never pill.
    if (s.completed || dismissedAt) {
      setShowResumePill(false);
      return;
    }

    // Don't show the tour for existing users (account older than 2 minutes).
    // This intentionally runs before the seen/later checks because an old
    // account that *also* had a Later cookie should still be considered
    // "experienced" — auto-mark complete and stop.
    if (profileCreatedAt) {
      const ageMs = Date.now() - new Date(profileCreatedAt).getTime();
      if (ageMs > 2 * 60 * 1000) {
        saveState({ ...s, seen: true, completed: true });
        setShowResumePill(false);
        return;
      }
    }

    // Snoozed via "Later" → show the resume pill but DON'T auto-open
    // the dialog. The user clicks the pill to relaunch from their saved
    // step. Pill stays until they either resume (which clears the
    // later flag) or skip permanently.
    if (laterAt) {
      setShowResumePill(true);
      return;
    }

    // First-time fresh-account visit: auto-show after a short delay so
    // the dashboard has a beat to render before the dialog covers it.
    if (s.seen) {
      // Already auto-shown once in this account's lifetime but neither
      // skipped, snoozed, nor completed (e.g. user closed the tab on
      // step 2 without picking Skip or Later). Treat as a soft snooze
      // and offer the pill rather than reopening the dialog uninvited.
      setShowResumePill(true);
      return;
    }

    saveState({ ...s, seen: true });
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, [location.pathname, profileCreatedAt]);

  const updateState = useCallback((updates: Partial<OnboardingState>) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      saveState(next);
      // Mirror the current step into the dedicated key so a Later /
      // close-tab leaves a resumable record even if the legacy blob is
      // ever cleared independently (e.g. a future migration).
      if (typeof next.currentStep === "number") {
        safeStorage.setItem(KEY_STEP, String(next.currentStep));
      }
      return next;
    });
  }, []);

  const handleNext = () => {
    const newCompleted = [...new Set([...state.completedSteps, currentStep.id])];
    if (state.currentStep < steps.length - 1) {
      updateState({ currentStep: state.currentStep + 1, completedSteps: newCompleted });
      if (currentStep.action) {
        navigate(currentStep.action);
      }
    } else {
      // Tour complete — clear all dismissal flags so a manual restart
      // from settings doesn't get stuck behind a stale Later/Skip key.
      updateState({ completed: true, completedSteps: newCompleted });
      safeStorage.removeItem(KEY_LATER_AT);
      safeStorage.removeItem(KEY_DISMISSED_AT);
      safeStorage.removeItem(KEY_STEP);
      setVisible(false);
      setShowResumePill(false);
    }
  };

  const handleBack = () => {
    if (state.currentStep > 0) {
      updateState({ currentStep: state.currentStep - 1 });
    }
  };

  // Skip = permanent dismiss. Writes `dismissed_at`, clears the snooze
  // key so the two flavors don't both fire, marks the legacy blob
  // completed so existing gating still picks it up.
  const handleSkip = () => {
    updateState({ completed: true, dismissedAt: new Date().toISOString() });
    safeStorage.setItem(KEY_DISMISSED_AT, new Date().toISOString());
    safeStorage.removeItem(KEY_LATER_AT);
    setVisible(false);
    setShowResumePill(false);
  };

  // Later = snooze. Saves the current step + a `later_at` timestamp so
  // the dashboard pill can offer a resume on next visit. Does NOT mark
  // the legacy blob completed — a Later user should still be able to
  // come back and finish.
  const handleLater = () => {
    safeStorage.setItem(KEY_LATER_AT, new Date().toISOString());
    safeStorage.setItem(KEY_STEP, String(state.currentStep));
    safeStorage.removeItem(KEY_DISMISSED_AT);
    setVisible(false);
    setShowResumePill(true);
  };

  const handleGoToStep = (action?: string) => {
    if (action) navigate(action);
    handleNext();
  };

  // Relaunch the tour from the saved step. Clears the snooze key so
  // the resume pill disappears while the dialog is open.
  const handleResume = () => {
    const step = getResumeStep();
    updateState({ currentStep: step });
    safeStorage.removeItem(KEY_LATER_AT);
    setShowResumePill(false);
    setVisible(true);
  };

  // Radix Dialog onOpenChange — fires on Escape, backdrop click, and
  // any other dismissal pathway. Escape and outside-click should both
  // snooze (Later) rather than skip permanently — Escape feels like
  // "not now," not "never again." Users who want permanent skip have
  // the explicit Skip button. Programmatic close paths (Skip, final
  // Get started, manual Resume) call setVisible directly so this
  // handler only runs for user-initiated dismissals.
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) handleLater();
  };

  // Render path 1: the resume pill (only on /dashboard, only when
  // snoozed). Painted as a small fixed-bottom card above the nav so it
  // doesn't shove dashboard content around.
  if (!visible && showResumePill && location.pathname === "/dashboard") {
    return (
      <div
        className="fixed left-1/2 -translate-x-1/2 z-[55] animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
        style={{
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)",
        }}
      >
        <button
          type="button"
          onClick={handleResume}
          aria-label="Resume onboarding tour"
          className="flex items-center gap-2 rounded-full liquid-glass shadow-lg px-4 py-2.5 hover:scale-[1.02] transition-transform"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          <Play
            className="w-3.5 h-3.5"
            style={{ color: "hsl(var(--primary))" }}
          />
          <span className="font-serif italic text-ds-13">
            Resume tour
          </span>
          <span
            className="font-serif italic uppercase text-ds-10 px-1.5 py-0.5 rounded-full"
            style={{
              color: "hsl(var(--burnt-sienna))",
              backgroundColor: "hsl(var(--burnt-sienna) / 0.08)",
              letterSpacing: "0.16em",
            }}
          >
            {state.currentStep + 1}/{steps.length}
          </span>
        </button>
      </div>
    );
  }

  if (state.completed) return null;

  return (
    <Dialog open={visible} onOpenChange={handleDialogOpenChange}>
      <DialogPortal>
        {/* Shared overlay primitive — backdrop blur + escape-to-close +
            outside-click route through Radix's onOpenChange (which we
            wire to handleLater). Matches every other modal in the app. */}
        <DialogOverlay />
        {/* Tour card — Radix Content gives proper dialog semantics,
            focus trap, and announces modal state to screen readers.
            We render our own inner card so the bespoke progress-bar
            header + multi-step layout stays intact; that's why we use
            the bare primitive (not DialogContent, which ships its own
            close X and padding). The centering translate lives on
            Content and the `animate-in zoom-in-95` lives on the inner
            card — keeping them separate lets the animation's `from`
            keyframe transform clobber centering, which previously
            rendered the card off-center on 375px screens. */}
        <DialogPrimitive.Content
          aria-labelledby="onboarding-tour-title"
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md focus:outline-none"
        >
          <div className="rounded-2xl liquid-glass shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-300">
          {/* Progress bar */}
          <div className="px-5 pt-4 pb-1">
            <div className="flex items-center justify-between mb-2">
              <span
                className="font-serif italic uppercase text-ds-10"
                style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
              >
                Step {state.currentStep + 1} of {steps.length}
              </span>
              {/* X = snooze (Later), not permanent skip. The footer
                  "Skip tour" button is the only permanent dismissal so
                  a misclick on the corner X doesn't lock the user out
                  of the tour forever. */}
              <button
                onClick={handleLater}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close tour for now"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <Progress
              value={progress}
              className="h-1.5"
              aria-label="Onboarding tour progress"
              aria-valuetext={`Step ${state.currentStep + 1} of ${steps.length}`}
            />
          </div>

          {/* Content */}
          <div className="p-6 text-center space-y-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
              style={{
                backgroundColor: "hsl(var(--primary) / 0.10)",
                border: "1px solid hsl(var(--primary) / 0.18)",
                color: "hsl(var(--primary))",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
                  "0 6px 18px -6px hsl(var(--primary) / 0.30)",
              }}
            >
              {currentStep.icon}
            </div>
            <div className="space-y-2">
              {/* Eyebrow → title → description stack mirrors DialogHero
                  (this popup uses DialogPrimitive directly, so it can't
                  consume the shared component — the tokens are matched
                  by hand). The eyebrow doubles as a step counter so a
                  user in the middle of the tour always knows where they
                  are without hunting for the progress bar. */}
              <span
                className="font-serif italic uppercase block"
                style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
              >
                Step {state.currentStep + 1} of {steps.length}
              </span>
              {/* `asChild` so Radix's accessibility wiring (aria-labelledby
                  on Content, screen-reader title announcement) lands on
                  our existing visual heading instead of injecting an
                  extra wrapper. Same for the description below. */}
              <DialogPrimitive.Title asChild>
                <h3
                  id="onboarding-tour-title"
                  className="font-display italic font-bold leading-tight"
                  style={{
                    fontSize: "clamp(1.25rem, 2vw + 0.4rem, 1.55rem)",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {currentStep.title}
                </h3>
              </DialogPrimitive.Title>
              <DialogPrimitive.Description asChild>
                <p
                  className="font-serif italic text-ds-15 leading-relaxed max-w-[360px] mx-auto"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  {currentStep.description}
                </p>
              </DialogPrimitive.Description>
            </div>

            {/* Step indicators — clickable so a user can jump back to a
                step they want to re-watch. Forward jumps are blocked so
                the tour still walks through unseen content in order. */}
            <div
              className="flex items-center justify-center gap-1.5 pt-1"
              role="tablist"
              aria-label="Tour steps"
            >
              {steps.map((s, i) => {
                const isCurrent = i === state.currentStep;
                const isPast = i < state.currentStep;
                const clickable = i <= state.currentStep;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={isCurrent}
                    aria-label={`Step ${i + 1}: ${s.title}`}
                    disabled={!clickable}
                    onClick={() => {
                      if (clickable && !isCurrent) updateState({ currentStep: i });
                    }}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      isCurrent
                        ? "w-6 bg-primary"
                        : isPast
                        ? "w-1.5 bg-primary/40 cursor-pointer hover:bg-primary/60"
                        : "w-1.5 bg-border"
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* Actions — every step gets both Skip (permanent) and Later
              (snooze) so the user can opt out at any point with the
              flavor they actually want. Back appears once they're past
              step 0. The forward CTA stays primary-styled bark for
              visual parity with the rest of the app. */}
          <div className="px-6 pb-5 space-y-2">
            <div className="flex items-center gap-2">
              {state.currentStep > 0 && (
                <Button variant="ghost" size="sm" onClick={handleBack} className="text-muted-foreground rounded-ds-md">
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
              )}
              <div className="flex-1" />
              {state.currentStep < steps.length - 1 ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleGoToStep(currentStep.action)}
                  className="group rounded-ds-md"
                >
                  {currentStep.action ? "Go there" : "Next"} <ArrowRight className="w-4 h-4 ml-1 transition-transform duration-300 group-hover:translate-x-1" />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleNext}
                  className="rounded-ds-md"
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Get started
                </Button>
              )}
            </div>
            {/* Dismiss row — present on EVERY step (including the
                last) so the user always has an explicit escape hatch
                without finishing. On the final step both still work:
                Skip → never show again, Later → snooze with the resume
                pill. */}
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLater}
                className="text-muted-foreground text-ds-11 rounded-ds-md"
              >
                Later
              </Button>
              <span
                aria-hidden="true"
                className="text-muted-foreground/40"
              >
                ·
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                className="text-muted-foreground text-ds-11 rounded-ds-md"
              >
                Skip tour
              </Button>
            </div>
          </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};

// Small hook to restart tour from settings/profile. Clears every key
// the tour writes so a manual restart is the canonical "start over."
export const useOnboardingTour = () => {
  const restart = () => {
    safeStorage.removeItem(STORAGE_KEY);
    safeStorage.removeItem(KEY_DISMISSED_AT);
    safeStorage.removeItem(KEY_LATER_AT);
    safeStorage.removeItem(KEY_STEP);
    window.location.reload();
  };
  const isCompleted = () => getState().completed;
  return { restart, isCompleted };
};

export default OnboardingTour;
