import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Briefcase, User, MessageCircle, Search, Play } from "lucide-react";
import { safeStorage } from "@/lib/safeStorage";
import { HelprMark } from "@/components/HelprMark";

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
    icon: <HelprMark to={null} emblemOnly size="sm" />,
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
    description: "Post tasks, browse open tasks, track applications, and manage everything from one place.",
    icon: <Search className="w-6 h-6" />,
    action: "/dashboard",
  },
  {
    id: "post-job",
    title: "Post or apply to tasks",
    description: "Need help? Post a task with your budget. Want to earn? Browse and apply to tasks nearby.",
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

const OnboardingTour = ({ profileComplete = false, profileCreatedAt }: OnboardingTourProps) => {
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

  // Skip the "Complete your profile" step for anyone who already finished
  // signup with a full profile — nudging them to do something already done
  // is exactly the redundancy the owner flagged live in the tour.
  const steps = profileComplete ? TOUR_STEPS.filter((s) => s.id !== "profile") : TOUR_STEPS;
  const currentStep = steps[state.currentStep] || steps[0];

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

    // Don't show the tour for existing users (account older than 30 minutes).
    // This intentionally runs before the seen/later checks because an old
    // account that *also* had a Later cookie should still be considered
    // "experienced" — auto-mark complete and stop.
    if (profileCreatedAt) {
      const ageMs = Date.now() - new Date(profileCreatedAt).getTime();
      if (ageMs > 30 * 60 * 1000) {
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

  // Relaunch the tour from the saved step. Clears the snooze key so
  // the resume pill disappears while the dialog is open.
  const handleResume = () => {
    const step = getResumeStep();
    updateState({ currentStep: step });
    safeStorage.removeItem(KEY_LATER_AT);
    setShowResumePill(false);
    setVisible(true);
  };

  // Radix Dialog onOpenChange — fires on Escape, backdrop click, and any
  // other user-initiated dismissal pathway. Treated the same as the
  // explicit Skip button (there's no separate "Later" any more).
  // Programmatic close paths (Skip, finishTour, manual Resume) call
  // setVisible directly so this handler only runs for those dismissals.
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) handleSkip();
  };

  // All five steps marked complete → the dots give way to a single "go
  // ahead" arrow that actually finishes the tour. Clicking the LAST dot
  // only marks it green (below); this is the deliberate separate tap that
  // closes the dialog, per owner direction (dots advance, the arrow exits).
  const allStepsDone = steps.every((s) => state.completedSteps.includes(s.id));

  // Dots ARE the "next" control now (no separate Next/Get Started button).
  // Clicking the CURRENT dot marks it done and advances — same navigation
  // side-effect handleGoToStep always had — except on the last step, where
  // it only marks that dot green and waits for the "go ahead" arrow rather
  // than auto-closing the dialog.
  const handleDotClick = (i: number) => {
    if (i < state.currentStep) {
      // Past dot: just jump back to review it. Already marked complete.
      updateState({ currentStep: i });
      return;
    }
    if (i !== state.currentStep) return; // future dot — not clickable
    const newCompleted = [...new Set([...state.completedSteps, currentStep.id])];
    if (state.currentStep < steps.length - 1) {
      updateState({ currentStep: state.currentStep + 1, completedSteps: newCompleted });
      if (currentStep.action) navigate(currentStep.action);
    } else {
      updateState({ completedSteps: newCompleted });
    }
  };

  const finishTour = () => {
    updateState({ completed: true });
    safeStorage.removeItem(KEY_LATER_AT);
    safeStorage.removeItem(KEY_DISMISSED_AT);
    safeStorage.removeItem(KEY_STEP);
    setVisible(false);
    setShowResumePill(false);
  };

  // Render path 1: the resume pill (only on /dashboard, only when
  // snoozed). Painted as a small fixed-bottom card above the nav so it
  // doesn't shove dashboard content around.
  if (!visible && showResumePill && location.pathname === "/dashboard") {
    return (
      <div
        className="fixed left-1/2 -translate-x-1/2 z-[55] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 duration-300"
        style={{
          bottom: "calc(var(--safe-area-bottom, 0px) + 5.5rem)",
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
            Resume Tour
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
          <div className="rounded-2xl liquid-glass shadow-2xl overflow-hidden motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 duration-300">
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

            {/* Step indicators ARE the "next" control now — click the
                current (blue) dot to mark it done and advance; a done dot
                turns green. Past dots can be tapped to jump back and
                review. Future dots aren't clickable yet — the tour still
                walks through content in order. */}
            <div
              className="flex items-center justify-center gap-1.5 pt-1"
              role="tablist"
              aria-label="Tour steps"
            >
              {steps.map((s, i) => {
                const isCurrent = i === state.currentStep;
                const isDone = state.completedSteps.includes(s.id);
                const clickable = i <= state.currentStep;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={isCurrent}
                    aria-label={`Step ${i + 1}: ${s.title}`}
                    disabled={!clickable}
                    onClick={() => handleDotClick(i)}
                    className={`h-2.5 w-2.5 rounded-full transition-all duration-300 ${
                      isDone
                        ? "bg-primary"
                        : isCurrent
                        ? "bg-burnt-sienna scale-125 cursor-pointer"
                        : clickable
                        ? "bg-border cursor-pointer hover:bg-border/70"
                        : "bg-border/50"
                    }`}
                    style={isCurrent && !isDone ? { backgroundColor: "hsl(var(--burnt-sienna))" } : undefined}
                  />
                );
              })}
            </div>
          </div>

          {/* Actions — nothing renders here until every dot is green; the
              "go ahead" arrow is the one deliberate tap that finishes the
              tour. Skip stays available on every step as the escape hatch. */}
          <div className="px-6 pb-5 space-y-3">
            {allStepsDone && (
              <div className="flex justify-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={finishTour}
                  aria-label="Finish tour"
                  className="group rounded-full w-11 h-11 p-0"
                >
                  <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                </Button>
              </div>
            )}
            <div className="flex items-center justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                className="text-muted-foreground text-ds-11 rounded-ds-md"
              >
                Skip Tour
              </Button>
            </div>
          </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};

export default OnboardingTour;
