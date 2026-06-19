import { Check } from "lucide-react";
import type { Step } from "./usePostJobForm";

interface PostJobFlowStepperProps {
  /** Which of the three flow steps the poster is currently on. */
  step: Step;
}

const FLOW: { id: Step; label: string }[] = [
  { id: "entry", label: "Entry" },
  { id: "form", label: "Details" },
  { id: "checkout", label: "Pay" },
];

/**
 * Top-level flow stepper — "● Entry ─ ○ Details ─ ○ Pay" spanning the whole
 * Post-a-Task journey. Unlike SectionProgress (the in-form Details/Logistics/
 * Budget sub-rail) and CheckoutStepIndicator (the in-checkout back-rail), this
 * sits above all three steps so the poster always sees how far they are in the
 * overall entry → form → checkout machine.
 *
 * Pure presentational: completed steps show a check, the active step is ringed,
 * upcoming steps are muted. Read-only — navigation stays with the page header
 * back arrow and the in-step rails. Tokens only (no bare brand color names).
 */
export function PostJobFlowStepper({ step }: PostJobFlowStepperProps) {
  const activeIndex = FLOW.findIndex((s) => s.id === step);

  return (
    <div
      role="group"
      aria-label={`Post a task — step ${activeIndex + 1} of ${FLOW.length}: ${FLOW[Math.max(activeIndex, 0)].label}`}
      className="flex items-center"
    >
      {FLOW.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <div key={s.id} className="flex flex-1 items-center">
            <div
              className="flex min-h-[44px] items-center gap-1.5 pr-1"
              aria-current={active ? "step" : undefined}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-sans font-bold tabular-nums transition-all duration-300 ease-ds-out"
                style={
                  done
                    ? {
                        background: "hsl(var(--bark))",
                        color: "hsl(var(--parchment))",
                      }
                    : active
                      ? {
                          background: "hsla(0, 0%, 100%, 0.85)",
                          color: "hsl(var(--bark))",
                          boxShadow: "0 0 0 2px hsl(var(--bark) / 0.55)",
                        }
                      : {
                          background: "hsla(0, 0%, 100%, 0.45)",
                          color: "hsl(var(--olivewood) / 0.55)",
                          boxShadow: "inset 0 0 0 1px hsl(var(--olivewood) / 0.22)",
                        }
                }
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className="font-sans font-semibold uppercase tracking-wider transition-colors"
                style={{
                  fontSize: "0.62rem",
                  color: done
                    ? "hsl(var(--bark))"
                    : active
                      ? "hsl(var(--ink-deep))"
                      : "hsl(var(--olivewood) / 0.5)",
                }}
              >
                {s.label}
              </span>
            </div>
            {i < FLOW.length - 1 && (
              <span
                className="mx-1 h-px flex-1 rounded-full transition-colors duration-300 ease-ds-out"
                style={{
                  background: done
                    ? "hsl(var(--bark) / 0.55)"
                    : "hsl(var(--olivewood) / 0.18)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
