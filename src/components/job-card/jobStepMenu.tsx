/**
 * THE JOB PAGE'S ONE-TAP OPTIONS (owner 2026-11-01): a step card mounted on the job page does not draw its own row.
 * Its chips (the card's "More" actions, minus Message: the page has its own Message button) are handed to the page:
 *  - none: the page shows Message alone;
 *  - exactly one: that action is the page's second button, beside Message ("if no show is the only option then just
 *    remove the more button bc there isn't really more");
 *  - two or more: the page's "More options" opens them as one list in a sheet, in one tap.
 * The card stays mounted (hidden) so its dialogs, its confirm steps and its claimed primary keep working.
 *
 * Guards: src/pages/jobs/jobPage/posterPageFlows.test.tsx (the wiring), JobPage.test.tsx (the row).
 */
import { createContext, isValidElement, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { JobActionChip } from "./JobActionRow";

interface JobStepMenu {
  /** The page's second-button slot (exactly one action). */
  secondHost: HTMLElement | null;
  /** The open options sheet's list (two or more actions); null while the sheet is closed. */
  listHost: HTMLElement | null;
  /** How many actions the card holds (the page picks its row from it). */
  setCount: (n: number) => void;
}

export const JobStepMenuContext = createContext<JobStepMenu | null>(null);

type ChipProps = { label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean; tone?: string; ariaLabel?: string };

/** A JobActionChip drawn as a full-size Button (its own label, tone and onClick); any other chip as itself. */
export function MenuAction({ chip, className = "" }: { chip: ReactNode; className?: string }) {
  if (isValidElement(chip) && chip.type === JobActionChip) {
    const p = (chip as ReactElement<ChipProps>).props;
    const danger = p.tone === "danger";
    return (
      <Button
        type="button"
        variant="outline"
        size="lg"
        data-menu-action={p.label}
        className={`min-w-0 text-ds-15 ${danger ? "text-destructive-ink" : ""} ${className}`}
        disabled={p.disabled}
        aria-label={p.ariaLabel}
        onClick={p.onClick}
      >
        {p.label}
      </Button>
    );
  }
  return <div className={`flex [&>*]:w-full ${className}`}>{chip}</div>;
}
