import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Home, ClipboardList, MessageSquare, User, Send, Plus, X } from "lucide-react";
import { safeStorage } from "@/lib/safeStorage";
import { HelprMark } from "@/components/HelprMark";

type TourStep = {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  target?: string; // CSS selector to highlight
  position?: "center" | "top" | "bottom";
};

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Helpr",
    description: "Everything you need to get started.",
    icon: <HelprMark to={null} emblemOnly size="sm" />,
    position: "center",
  },
  {
    id: "browse",
    title: "Home",
    description: "This is where you browse and apply to jobs nearby.",
    icon: <Home className="w-8 h-8" strokeWidth={1.75} />,
  },
  {
    id: "my-posts",
    title: "My Posts",
    description: "Track and manage the tasks you've posted.",
    icon: <Send className="w-8 h-8" strokeWidth={1.75} />,
  },
  {
    id: "my-jobs",
    title: "My Jobs",
    description: "See jobs you're offered, applied to, or working.",
    icon: <ClipboardList className="w-8 h-8" strokeWidth={1.75} />,
  },
  {
    id: "messages",
    title: "Messages",
    description: "Chat with posters and helpers to coordinate a job.",
    icon: <MessageSquare className="w-8 h-8" strokeWidth={1.75} />,
  },
  {
    id: "profile",
    title: "Complete Your Profile",
    description: "Add your name, photo, and location for others to see.",
    icon: <User className="w-8 h-8" strokeWidth={1.75} />,
  },
  {
    id: "post-job",
    title: "Post a Task",
    description: "Ready to get help? Post your first task now.",
    icon: <Plus className="w-8 h-8" strokeWidth={1.75} />,
  },
];

const STORAGE_KEY = "helpr_onboarding";

type OnboardingState = {
  completed: boolean;
  currentStep: number;
  completedSteps: string[];
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

interface OnboardingTourProps {
  profileComplete?: boolean;
}

const OnboardingTour = ({ profileComplete = false }: OnboardingTourProps) => {
  const location = useLocation();
  const [state, setState] = useState<OnboardingState>(getState);
  const [visible, setVisible] = useState(false);

  // Skip the "Complete your profile" step for anyone who already finished
  // signup with a full profile — nudging them to do something already done
  // is exactly the redundancy the owner flagged live in the tour.
  const steps = profileComplete ? TOUR_STEPS.filter((s) => s.id !== "profile") : TOUR_STEPS;
  const currentStep = steps[state.currentStep] || steps[0];

  // Once done — finished, skipped, or closed with the corner X — that's it,
  // permanently. No snooze, no "resume later" pill: the tour shows exactly
  // once per account, ever, and only while it hasn't been completed.
  useEffect(() => {
    if (location.pathname !== "/dashboard") return;
    if (getState().completed) return;
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  const updateState = useCallback((updates: Partial<OnboardingState>) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      saveState(next);
      return next;
    });
  }, []);

  // Skip, the corner X, and Escape/outside-click all mean the same thing:
  // done for good. See handleDialogOpenChange below.
  const handleSkip = () => {
    updateState({ completed: true });
    setVisible(false);
  };

  // Radix Dialog onOpenChange — fires on Escape, backdrop click, and any
  // other user-initiated dismissal pathway. Programmatic close paths
  // (Skip, finishTour) call setVisible directly so this handler only runs
  // for those dismissals.
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) handleSkip();
  };

  // All steps marked complete → the dots give way to a single "go ahead"
  // arrow that actually finishes the tour.
  const allStepsDone = steps.every((s) => state.completedSteps.includes(s.id));

  // Dots are a free-roam step selector — every dot is clickable at any
  // time (owner: "so they can see how things work"), not just the next
  // one in sequence. Clicking a dot shows that step and marks it green;
  // once every dot has been viewed at least once, the "go ahead" arrow
  // appears to finish the tour.
  const handleDotClick = (i: number) => {
    // Never navigate the app out from under the dialog (that would unmount
    // it, closing the tour) — dots only ever change which step's copy is
    // showing, nothing else.
    // Mark BOTH the step being left and the one being viewed as done —
    // clicking away from a step is as much "seen" it as clicking to it.
    const newCompleted = [...new Set([...state.completedSteps, currentStep.id, steps[i].id])];
    updateState({ currentStep: i, completedSteps: newCompleted });
  };

  const finishTour = () => {
    updateState({ completed: true });
    setVisible(false);
  };

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
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-sm focus:outline-none"
        >
          <div className="relative rounded-2xl liquid-glass shadow-2xl overflow-hidden motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 duration-300">
          {/* Corner dismiss — same permanent-skip action as the "Skip" link
              below, just the conventional top-right spot too. */}
          <button
            type="button"
            onClick={handleSkip}
            aria-label="Skip tour"
            className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors z-10"
          >
            <X className="w-4 h-4" />
          </button>
          {/* Content */}
          <div className="p-5 pb-1 text-center space-y-2.5">
            <div className="flex items-center gap-4 text-left">
              {/* Icon sits bare — no tinted box — to the left of the copy. */}
              {/* Fixed slot width so the copy starts at the same x on every
                  step — the H emblem is ~37px wide, the lucide icons 24px,
                  which otherwise shifted the text left and right per step. */}
              <div
                className="shrink-0 flex items-center justify-center min-w-[2.5rem]"
                style={{ color: "hsl(var(--primary))" }}
              >
                {currentStep.icon}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
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
                    className="font-serif italic text-ds-15 leading-relaxed"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    {currentStep.description}
                  </p>
                </DialogPrimitive.Description>
              </div>
            </div>

            {/* Step indicators ARE the "next" control now — click the
                current (blue) dot to mark it done and advance; a done dot
                turns green. Past dots can be tapped to jump back and
                review. Future dots aren't clickable yet — the tour still
                walks through content in order. */}
            <div className="flex items-center justify-start gap-1.5">
              <div
                className="flex items-center justify-start gap-1.5"
                role="tablist"
                aria-label="Tour steps"
              >
                {steps.map((s, i) => {
                  const isCurrent = i === state.currentStep;
                  const isDone = state.completedSteps.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="tab"
                      aria-selected={isCurrent}
                      aria-label={`Step ${i + 1}: ${s.title}`}
                      onClick={() => handleDotClick(i)}
                      className="p-1 flex items-center justify-center cursor-pointer"
                    >
                      <span
                        aria-hidden
                        className={`block h-6 w-6 rounded-full transition-all duration-300 ${
                          isDone
                            ? "bg-primary"
                            : isCurrent
                            ? "bg-burnt-sienna scale-125"
                            : "bg-border hover:bg-border/70"
                        }`}
                        style={isCurrent && !isDone ? { backgroundColor: "hsl(var(--burnt-sienna))" } : undefined}
                      />
                    </button>
                  );
                })}
              </div>
              {/* "Go ahead" arrow — appears right next to the dots once
                  every step has been viewed. Bare, no filled button chrome,
                  just the icon so it reads as "next" rather than a CTA pill. */}
              {allStepsDone && (
                <button
                  type="button"
                  onClick={finishTour}
                  aria-label="Finish tour"
                  className="group flex items-center justify-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
                  style={{ color: "hsl(var(--primary))" }}
                >
                  <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                </button>
              )}
            </div>
          </div>

          {/* Skip stays available on every step as the escape hatch. */}
          <div className="px-6 pb-2 pt-0.5 flex items-center justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              className="text-muted-foreground text-ds-11 font-normal rounded-ds-md"
            >
              Skip
            </Button>
          </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};

export default OnboardingTour;
