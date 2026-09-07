import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Home, ClipboardList, MessageSquare, User, Send, Plus } from "lucide-react";
import { safeStorage, ensureHydrated } from "@/lib/safeStorage";
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

/**
 * PER-ACCOUNT, not per-device. This was a bare `helpr_onboarding` shared by
 * every account that ever signed in on the install, so the SECOND account on a
 * browser — or on one phone after an account switch, where safeStorage mirrors
 * the key into Capacitor Preferences and it survives a reinstall — was told
 * the tour had already been dismissed and never saw onboarding at all. It
 * follows `helpr_payouts_enabled_<uuid>` (useStripeConnectStatus.ts), the
 * convention already in the codebase for exactly this.
 *
 * `helpr_` prefix, so safeStorage's TRACKED_PREFIXES still mirrors it durably.
 */
const LEGACY_STORAGE_KEY = "helpr_onboarding";
const storageKey = (userId: string | null | undefined) =>
  userId ? `${LEGACY_STORAGE_KEY}_${userId}` : LEGACY_STORAGE_KEY;

type OnboardingState = {
  completed: boolean;
  currentStep: number;
  completedSteps: string[];
};

/**
 * MIGRATION — one-time claim, not a shared read.
 *
 * Existing installs carry an un-namespaced `helpr_onboarding`. Reading it as a
 * fallback forever would reproduce the exact bug, so the FIRST account to
 * arrive after this ships adopts it (copied to its own key, legacy deleted)
 * and every account after that starts clean. Net effect: the one person
 * already using the device is not re-shown the tour, and a second account
 * finally gets the onboarding it has always been denied.
 */
const getState = (userId?: string | null): OnboardingState => {
  try {
    let raw = safeStorage.getItem(storageKey(userId));
    if (!raw && userId) {
      const legacy = safeStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        safeStorage.setItem(storageKey(userId), legacy);
        safeStorage.removeItem(LEGACY_STORAGE_KEY);
        raw = legacy;
      }
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      // Defensively default fields that may be absent in older stored formats
      // (e.g. {seen:true, completed:true} written before completedSteps was added).
      // Without this, `state.completedSteps.includes(...)` throws and crashes
      // the dashboard for users with legacy localStorage.
      return {
        completed: parsed.completed ?? false,
        currentStep: parsed.currentStep ?? 0,
        completedSteps: Array.isArray(parsed.completedSteps) ? parsed.completedSteps : [],
      };
    }
  } catch {
    /* fall through to default below */
  }
  return { completed: false, currentStep: 0, completedSteps: [] };
};

const saveState = (userId: string | null | undefined, state: OnboardingState) => {
  safeStorage.setItem(storageKey(userId), JSON.stringify(state));
};

interface OnboardingTourProps {
  profileComplete?: boolean;
  /** Signed-in account id — namespaces this tour's stored state. */
  userId?: string | null;
  /**
   * Reports whether this tour still owns the screen: `true` from mount until
   * it is known to be finished, `false` once it is.
   *
   * Dashboard mounts this tour and BirthdayPopup as unconditional siblings,
   * both of them Radix dialogs at `z-50`, and neither knew the other existed
   * — so on a first login that fell on the member's birthday the two opened
   * together and the smaller birthday card (187×250) sat completely underneath
   * the tour card (337×191), unreachable until the tour was skipped. This is
   * how the two are sequenced instead of raced: the tour goes first, and the
   * birthday greeting waits for this to go `false`.
   *
   * It starts `true` deliberately. `getState()` reads localStorage
   * synchronously but the durable Preferences mirror may not have copied back
   * yet, and even once it has there is a 1500ms beat before the card appears —
   * so "not visible yet" is not "not coming", and reporting `false` during
   * either window would let the birthday card open into the gap.
   */
  onActiveChange?: (active: boolean) => void;
}

const OnboardingTour = ({ profileComplete = false, userId, onActiveChange }: OnboardingTourProps) => {
  const location = useLocation();
  const [state, setState] = useState<OnboardingState>(() => getState(userId));
  const [visible, setVisible] = useState(false);
  // "This tour will show, or is showing." Distinct from `visible`, which is
  // false during the pre-hydration and 1500ms-delay windows. See onActiveChange.
  const [pending, setPending] = useState(true);

  // Skip the "Complete your profile" step for anyone who already finished
  // signup with a full profile — nudging them to do something already done
  // is exactly the redundancy the owner flagged live in the tour.
  const steps = profileComplete ? TOUR_STEPS.filter((s) => s.id !== "profile") : TOUR_STEPS;
  const currentStep = steps[state.currentStep] || steps[0];

  // Skip is centered under the DOTS specifically, not the card as a whole
  // (owner: "center skip better under info and dots" / "CENTER UNDER
  // DOTS!!!!!!!!!!!!!!!") — the dots row is left-aligned under the title
  // and doesn't span the card's full width, so a plain `justify-center` on
  // Skip centers it in the wrong box. Measuring the dots row's own rendered
  // width and matching it on Skip's wrapper (both `mx-auto`) centers Skip
  // under exactly that row, whatever width the step count happens to give it.
  const dotsRowRef = useRef<HTMLDivElement>(null);
  const [dotsWidth, setDotsWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = dotsRowRef.current;
    if (!el) return;
    setDotsWidth(el.getBoundingClientRect().width);
  }, [steps.length]);

  // Once done — finished, skipped, or dismissed via Escape/outside-click —
  // that's it, permanently. No snooze, no "resume later" pill: the tour
  // shows exactly once per account, ever, and only while it hasn't been
  // completed.
  useEffect(() => {
    if (location.pathname !== "/dashboard") {
      // Off the one route this tour renders on, it is never going to open —
      // release whoever is waiting behind it rather than stranding them.
      setPending(false);
      return;
    }
    // `getState()` reads localStorage synchronously, but on native the
    // durable Preferences mirror hasn't necessarily copied back into
    // localStorage yet at this point — main.tsx renders the app before
    // `hydrateStorage()` resolves, to avoid blocking first paint. Reading
    // pre-hydrate can see a stale "not completed" even though the account
    // finished the tour, re-showing it after eviction/relaunch. Wait for
    // hydration so this decision uses the durable value.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    ensureHydrated()
      .then(() => {
        if (cancelled) return;
        const hydrated = getState(userId);
        setState(hydrated);
        if (hydrated.completed) {
          setPending(false);
          return;
        }
        timer = setTimeout(() => setVisible(true), 1500);
      })
      // A storage read that never resolves must not permanently suppress the
      // dialog queued behind this one.
      .catch(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [location.pathname, userId]);

  useEffect(() => {
    onActiveChange?.(pending);
  }, [pending, onActiveChange]);

  const updateState = useCallback((updates: Partial<OnboardingState>) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      saveState(userId, next);
      return next;
    });
  }, [userId]);

  // Skip and Escape/outside-click all mean the same thing: done for good.
  // See handleDialogOpenChange below.
  const handleSkip = () => {
    updateState({ completed: true });
    setVisible(false);
    setPending(false);
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
    setPending(false);
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
          {/* No corner X (owner, 2026-08-30: "just get rid of the x") — the
              "Skip" link below is the one and only dismiss affordance now. */}
          {/* Content — ONE block, Skip included (owner, 2026-08-30: "merge
              skip into the content block" — it used to be a second sibling
              div with its own top padding, reading as a seam between the
              copy and the escape hatch). */}
          <div className="p-5 pb-3 text-center space-y-2">
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
            <div
              ref={dotsRowRef}
              className="flex items-center justify-between w-full"
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
                    className="p-0.5 flex items-center justify-center cursor-pointer"
                  >
                    <span
                      aria-hidden
                      className={`block h-5 w-5 rounded-full transition-all duration-300 ${
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
            {/* Skip + the "go ahead" arrow share ONE row, centered under the
                DOTS row's own width, now that the dots span the full card
                (owner: "skip on left end and arrow on right end", after
                "center under circles" / "[put the arrow] to the right of
                skip"). `dotsWidth` (measured off the dots row) bounds this
                wrapper so `mx-auto` lines its ends up with the dots' ends. */}
            <div className="mx-auto flex items-center justify-between" style={dotsWidth ? { width: dotsWidth } : undefined}>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                className="text-muted-foreground text-ds-11 font-normal rounded-ds-md"
              >
                Skip
              </Button>
              {/* Appears once every step has been viewed. */}
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
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};

export default OnboardingTour;
