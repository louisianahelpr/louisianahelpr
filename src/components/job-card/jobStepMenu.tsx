/**
 * THE JOB PAGE'S ONE-TAP OPTIONS (owner 2026-11-01): a step card mounted on the job page does not draw its own row.
 * Its chips (the card's "More" actions, minus Message: the page has its own Message button) are handed to the page:
 *  - none: the page shows Message alone;
 *  - exactly one: that action is the page's second button, beside Message ("if no show is the only option then just
 *    remove the more button bc there isn't really more");
 *  - two or more: the page's "More options" opens them as one list in a sheet, in one tap.
 * The card stays mounted (hidden) so its dialogs, its confirm steps and its claimed primary keep working.
 * Its own primary (Review and Tip on a finished job) is handed over too (B93, 11-01: they were lost with the card
 * hidden): when the page has no step of its own it mounts `leadHost` and the card's first primary is the row's lead,
 * any other primary joins the options; when the page has its own step (it is the same step), the card's primary is
 * not offered twice.
 *
 * Guards: src/pages/jobs/jobPage/posterPageFlows.test.tsx (the wiring), JobPage.test.tsx (the row).
 */
import { createContext, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { composeAccessibleName, JobActionChip, JobStepPrimaryButton } from "./JobActionRow";
import { SosShareButton } from "@/components/SosShareButton";
import { buttonLabel, pairLabel, PAIR_TEXT } from "@/components/ui/pairLabel";

interface JobStepMenu {
  /** The page's second-button slot (exactly one action). */
  secondHost: HTMLElement | null;
  /** The open options sheet's list (two or more actions); null while the sheet is closed. */
  listHost: HTMLElement | null;
  /** The page's lead slot, mounted only when the page has no step of its own: the card's first primary goes here. */
  leadHost: HTMLElement | null;
  /** Above the page's row: the card's `ask` (the finished job's crew tip rows, or why a Tip can't be sent yet). */
  askHost?: HTMLElement | null;
  /** How many actions the card holds (the page picks its row from it). */
  setCount: (n: number) => void;
  /** How many primaries the card holds (the page mounts `leadHost` when it has none of its own). */
  setLeadCount: (n: number) => void;
}

export const JobStepMenuContext = createContext<JobStepMenu | null>(null);

type ChipProps = { label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean; tone?: string; ariaLabel?: string };

/** The card's own primary buttons, one element each (a step may pass two in a fragment: Review and Tip). A "done"
 *  primary (already taken) is not an action. */
export function primaryButtons(primary: ReactNode): ReactElement[] {
  if (!isValidElement(primary)) return [];
  if (primary.type === Fragment) {
    const kids = (primary as ReactElement<{ children?: ReactNode }>).props.children;
    return (Array.isArray(kids) ? kids : [kids]).flatMap((k) => primaryButtons(k as ReactNode));
  }
  if (primary.type !== JobStepPrimaryButton) return [];
  return (primary as ReactElement<{ tone?: string }>).props.tone === "done" ? [] : [primary as ReactElement];
}

/** A JobActionChip drawn as a full-size Button (its own label, tone and onClick); any other chip as itself. */
export function MenuAction({ chip, className = "", lead = false, pair = false }: { chip: ReactNode; className?: string; lead?: boolean; pair?: boolean }) {
  // Owner 11-01: a button in the page's side-by-side pair wears its SHORT label on one line (pairLabel.ts); the sheet's
  // list (a button alone on its row) keeps the full words. The accessible name keeps the full words either way.
  const pairCls = pair ? PAIR_TEXT : "px-4 text-ds-15";
  if (isValidElement(chip) && (chip.type === JobActionChip || chip.type === JobStepPrimaryButton)) {
    const p = (chip as ReactElement<ChipProps>).props;
    const danger = p.tone === "danger";
    // A confirm reads just "Confirm" alone too (owner 11-01, pairLabel.ts buttonLabel); the full words stay its name.
    const shown = pair ? pairLabel(p.label) : buttonLabel(p.label);
    return (
      <Button
        type="button"
        variant={lead ? "primary" : "outline"}
        size="wrap"
        data-menu-action={p.label}
        className={`min-w-0 rounded-full ${pairCls} leading-tight ${danger ? "text-destructive-ink" : ""} ${className}`}
        disabled={p.disabled}
        aria-label={composeAccessibleName(p.label, p.ariaLabel) ?? (shown !== p.label ? p.label : undefined)}
        onClick={p.onClick}
      >
        {shown}
      </Button>
    );
  }
  // Lead 11-01 (B107): on the page SOS is never a big red button beside Message. It is the row's ordinary outlined
  // button with a red shield icon (the card's red-tinted chip drawn full size read as the page's main action).
  // Guard: src/test/jobPageSosIsSecondary.test.tsx.
  if (isValidElement(chip) && chip.type === SosShareButton) {
    const { onOpen } = (chip as ReactElement<{ onOpen: () => void }>).props;
    return (
      <Button type="button" variant="outline" size="wrap" data-menu-action="SOS" data-sos-secondary=""
        className={`min-w-0 gap-1.5 rounded-full ${pairCls} leading-tight ${className}`}
        aria-label="SOS — share your location" onClick={onOpen}>
        <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive-ink" />
        SOS
      </Button>
    );
  }
  return <div className={`flex [&>*]:w-full ${className}`}>{chip}</div>;
}
