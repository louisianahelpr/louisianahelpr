import { Check } from "lucide-react";

export type PostJobSectionId = "details" | "logistics" | "budget";

interface SectionProgressProps {
  detailsComplete: boolean;
  logisticsComplete: boolean;
  budgetComplete: boolean;
  /** Section the poster is currently scrolled into — drives the active pip. */
  activeSection: PostJobSectionId;
  /** Smooth-scrolls the form to the tapped section. */
  onJump: (id: PostJobSectionId) => void;
}

/**
 * Sticky section stepper — a slim "Details · Logistics · Budget" rail
 * pinned below the page header. Each step shows one of three states so a
 * long single-scroll form keeps a sense of place and progress:
 *   - done    → filled bark pip with a check
 *   - active  → ringed pip, the section currently in view
 *   - pending → quiet outline pip
 * Tapping a step scroll-jumps to that section.
 */
export function SectionProgress({
  detailsComplete,
  logisticsComplete,
  budgetComplete,
  activeSection,
  onJump,
}: SectionProgressProps) {
  const sections: { id: PostJobSectionId; label: string; done: boolean }[] = [
    { id: "details", label: "Details", done: detailsComplete },
    { id: "logistics", label: "Logistics", done: logisticsComplete },
    { id: "budget", label: "Budget", done: budgetComplete },
  ];
  const doneCount = sections.filter((s) => s.done).length;

  return (
    <div
      className="sticky z-30 -mx-5 px-5 pt-2 pb-2.5"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) - 0.25rem)",
        background:
          "linear-gradient(to bottom, hsla(38, 18%, 97%, 0.97) 72%, hsla(38, 18%, 97%, 0))",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      {/*
        Use role="group" (not "progressbar"). A progressbar must not
        contain interactive descendants — each step here is a tappable
        button that scroll-jumps to the section, which axe correctly
        flags as `nested-interactive`. The group still announces a
        descriptive name + step-completion count to screen readers,
        and each button carries aria-current="step" when active.
      */}
      <div
        role="group"
        aria-label={`Post a task — ${doneCount} of ${sections.length} sections complete`}
        className="flex items-center"
      >
        {sections.map((s, i) => {
          const active = activeSection === s.id;
          return (
            <div key={s.id} className="flex flex-1 items-center">
              <button
                type="button"
                onClick={() => onJump(s.id)}
                aria-current={active ? "step" : undefined}
                className="group flex min-h-9 items-center gap-2 rounded-full pr-1 transition-transform active:scale-[0.97]"
              >
                {/* Step pip — done / active / pending. */}
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ds-11 font-sans font-bold tabular-nums transition-all duration-300 ease-ds-out"
                  style={
                    s.done
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
                  {s.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className="font-sans font-semibold uppercase tracking-wider transition-colors"
                  style={{
                    fontSize: "0.66rem",
                    color: s.done
                      ? "hsl(var(--bark))"
                      : active
                        ? "hsl(var(--ink-deep))"
                        : "hsl(var(--olivewood) / 0.5)",
                  }}
                >
                  {s.label}
                </span>
              </button>
              {/* Connector rail between steps — fills bark once the
                  preceding section is complete. */}
              {i < sections.length - 1 && (
                <span
                  className="mx-1 h-px flex-1 rounded-full transition-colors duration-300 ease-ds-out"
                  style={{
                    background: s.done
                      ? "hsl(var(--bark) / 0.55)"
                      : "hsl(var(--olivewood) / 0.18)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
