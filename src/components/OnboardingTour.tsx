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
    title: "Welcome to Helpr! 🎉",
    description: "Let's walk you through the basics so you can get started. This will only take a minute.",
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

const OnboardingTour = ({ profileComplete = false, profileCreatedAt }: OnboardingTourProps) => {
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

  if (!visible || state.completed) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={handleDismiss} />

      {/* Tour card */}
      <div className="fixed z-[61] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md animate-in fade-in-0 zoom-in-95 duration-300">
        <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
          {/* Progress bar */}
          <div className="px-5 pt-4 pb-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>Step {state.currentStep + 1} of {steps.length}</span>
              <button onClick={handleDismiss} className="hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>

          {/* Content */}
          <div className="p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto text-primary">
              {currentStep.icon}
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-display font-bold text-foreground">{currentStep.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{currentStep.description}</p>
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

          {/* Actions */}
          <div className="px-6 pb-5 flex items-center gap-2">
            {state.currentStep > 0 && (
              <Button variant="ghost" size="sm" onClick={handleBack} className="text-muted-foreground">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            )}
            <div className="flex-1" />
            {state.currentStep < steps.length - 1 ? (
              <>
                <Button variant="ghost" size="sm" onClick={handleDismiss} className="text-muted-foreground text-xs">
                  Skip tour
                </Button>
                <Button size="sm" onClick={() => handleGoToStep(currentStep.action)}>
                  {currentStep.action ? "Go there" : "Next"} <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={handleNext}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> Get started!
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
