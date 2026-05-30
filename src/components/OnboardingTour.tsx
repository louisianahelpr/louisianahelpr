import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { X, ArrowRight, ArrowLeft, CheckCircle2, Briefcase, User, MessageCircle, Search, Sparkles } from "lucide-react";
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
    description: "Post tasks, browse open jobs, track applications, and manage everything from one place.",
    icon: <Search className="w-6 h-6" />,
    action: "/dashboard",
  },
  {
    id: "post-job",
    title: "Post or apply to tasks",
    description: "Need help? Post a task with your budget. Want to earn? Browse and apply to jobs nearby.",
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
  } catch {}
  return { completed: false, currentStep: 0, completedSteps: [] };
};

const saveState = (state: OnboardingState) => {
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

interface OnboardingTourProps {
  profileComplete?: boolean;
  profileCreatedAt?: string | null;
}

const OnboardingTour = ({ profileComplete: _profileComplete = false, profileCreatedAt }: OnboardingTourProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<OnboardingState>(getState);
  const [visible, setVisible] = useState(false);

  const steps = TOUR_STEPS;
  const currentStep = steps[state.currentStep] || steps[0];
  const progress = ((state.currentStep + 1) / steps.length) * 100;

  useEffect(() => {
    if (location.pathname !== "/dashboard") return;
    const s = getState();
    // Never show again once seen or completed
    if (s.completed || s.seen) return;
    // Don't show for existing users (account older than 2 minutes)
    if (profileCreatedAt) {
      const ageMs = Date.now() - new Date(profileCreatedAt).getTime();
      if (ageMs > 2 * 60 * 1000) {
        saveState({ ...s, seen: true, completed: true });
        return;
      }
    }
    // Mark as seen immediately so it never shows again
    saveState({ ...s, seen: true });
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, [location.pathname, profileCreatedAt]);

  const updateState = useCallback((updates: Partial<OnboardingState>) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      saveState(next);
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
      // Tour complete
      updateState({ completed: true, completedSteps: newCompleted });
      setVisible(false);
    }
  };

  const handleBack = () => {
    if (state.currentStep > 0) {
      updateState({ currentStep: state.currentStep - 1 });
    }
  };

  const handleDismiss = () => {
    updateState({ completed: true, dismissedAt: new Date().toISOString() });
    setVisible(false);
  };

  const handleGoToStep = (action?: string) => {
    if (action) navigate(action);
    handleNext();
  };

  // Escape-to-dismiss for keyboard users (the backdrop click works for
  // mouse users; without this, keyboard users could only dismiss via the
  // small X button which they have to find via Tab traversal first).
  useEffect(() => {
    if (!visible || state.completed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
     
  }, [visible, state.completed]);

  if (!visible || state.completed) return null;

  return (
    <>
      {/* Backdrop — purely decorative; dismissal is via Escape, X button,
          or "Skip tour" button below. aria-hidden so screen readers
          don't announce it as an interactive element. */}
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
        onClick={handleDismiss}
        aria-hidden="true"
      />

      {/* Tour card — proper dialog semantics so screen readers announce
          it as a modal and focus is trapped inside via the dialog role.
          The centering translate lives on this OUTER wrapper and the
          `animate-in zoom-in-95` lives on the INNER card. Keeping them on
          the same element lets the animation's `from` keyframe transform
          clobber `-translate-x-1/2 -translate-y-1/2`, which rendered the
          card off-center / clipped off the right edge at 375px. */}
      <div
        className="fixed z-[61] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-tour-title"
      >
        <div className="rounded-2xl liquid-glass shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-300">
          {/* Progress bar */}
          <div className="px-5 pt-4 pb-1">
            <div className="flex items-center justify-between mb-2">
              <span
                className="font-serif italic uppercase text-[0.62rem]"
                style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
              >
                Step {state.currentStep + 1} of {steps.length}
              </span>
              <button
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close tour"
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
              <p
                className="font-serif italic text-[0.92rem] leading-relaxed max-w-[360px] mx-auto"
                style={{ color: "hsl(var(--olivewood) / 0.78)" }}
              >
                {currentStep.description}
              </p>
            </div>

            {/* Step indicators */}
            <div className="flex items-center justify-center gap-1.5 pt-1">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === state.currentStep
                      ? "w-6 bg-primary"
                      : i < state.currentStep
                      ? "w-1.5 bg-primary/40"
                      : "w-1.5 bg-border"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Actions — primary CTA brand-styled bark for visual peer
              parity with the rest of the app's primary buttons. */}
          <div className="px-6 pb-5 flex items-center gap-2">
            {state.currentStep > 0 && (
              <Button variant="ghost" size="sm" onClick={handleBack} className="text-muted-foreground rounded-ds-md">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            )}
            <div className="flex-1" />
            {state.currentStep < steps.length - 1 ? (
              <>
                <Button variant="ghost" size="sm" onClick={handleDismiss} className="text-muted-foreground text-ds-11 rounded-ds-md">
                  Skip tour
                </Button>
                <Button
                  variant="bark"
                  size="sm"
                  onClick={() => handleGoToStep(currentStep.action)}
                  className="rounded-ds-md"
                >
                  {currentStep.action ? "Go there" : "Next"} <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </>
            ) : (
              <Button
                variant="bark"
                size="sm"
                onClick={handleNext}
                className="rounded-ds-md"
              >
                <CheckCircle2 className="w-4 h-4 mr-1" /> Get started
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// Small hook to restart tour from settings/profile
export const useOnboardingTour = () => {
  const restart = () => {
    safeStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };
  const isCompleted = () => getState().completed;
  return { restart, isCompleted };
};

export default OnboardingTour;
