import type { ReactNode } from "react";
import { Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHero,
  SheetPrimaryAction,
  SheetSecondaryAction,
} from "@/components/ui/sheet";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";

/** One row of the "What happens next" list. `done` = already happened, `now` = the step
 *  the member is waiting on (one per sheet), `later` = still to come. */
export type WhatNextStep = { key: string; label: ReactNode; detail?: ReactNode; state: "done" | "now" | "later" };

/**
 * THE ONE "WHAT NEXT" SHEET (boards 77, 78, 81): after applying, after hiring, after
 * marking done. A title, one plain line, the steps from here with the current one marked
 * "Now", then ONE filled action and an outline way out. Floor sheet on phone and native,
 * the centred modal on desktop web (same as FilterSheet, board 24).
 *
 * Every step's words come from the caller, who builds them from real data: a name, date or
 * amount the caller does not have is left out of the step, never invented (truth rule).
 */
export function WhatNextSheet({
  open,
  onClose,
  title,
  lead,
  steps,
  children,
  primary,
  secondary,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  lead?: ReactNode;
  steps: WhatNextStep[];
  /** Anything the member must read that is not a step (a held-back note, say). */
  children?: ReactNode;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}) {
  const webDesktop = useIsWebDesktop();
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        side="bottom"
        floor={!webDesktop}
        className={`bg-premium-page focus:outline-none ${webDesktop ? "sm:max-w-[440px]" : ""}`}
        data-testid="what-next-sheet"
        // Focus lands on the sheet itself, not its first button: Radix's default put the
        // focus ring on the outline action at open, so it read as selected (lead, board 77).
        // Tab still reaches both actions, and the ring shows only for keyboard focus.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
      >
        {/* The board's mark: a check in a muted circle above the title, aligned with it. */}
        <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-primary">
          <Check className="h-5 w-5" />
        </span>
        <SheetHero title={title} />
        {lead ? <p className="text-ds-14 text-foreground">{lead}</p> : null}
        <section aria-labelledby="what-next-heading" className="mt-3">
          <h3 id="what-next-heading" className="text-ds-12 font-semibold uppercase tracking-wide text-muted-foreground">
            What happens next
          </h3>
          <ol className="mt-2">
            {steps.map((step, i) => (
              <li key={step.key} className="relative flex gap-3 pb-3 last:pb-0" data-state={step.state}>
                {i < steps.length - 1 ? (
                  <span aria-hidden className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
                ) : null}
                <StepDot state={step.state} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-ds-14 font-semibold text-foreground">
                    <span>{step.label}</span>
                    {step.state === "now" ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-ds-12 font-semibold text-primary">Now</span>
                    ) : null}
                  </p>
                  {step.detail ? <p className="text-ds-13 text-muted-foreground">{step.detail}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
        {children}
        <SheetFooter className="mt-4 pb-4">
          {secondary ? <SheetSecondaryAction onClick={secondary.onClick}>{secondary.label}</SheetSecondaryAction> : null}
          <SheetPrimaryAction onClick={primary.onClick}>{primary.label}</SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function StepDot({ state }: { state: WhatNextStep["state"] }) {
  if (state === "done") {
    return (
      <span aria-label="Done" className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`relative z-10 mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 bg-background ${state === "now" ? "border-primary" : "border-border"}`}
    />
  );
}
