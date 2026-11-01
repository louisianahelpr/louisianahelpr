/**
 * THE JOB PAGE'S ONE ROW OF BUTTONS, both sides (owner 2026-11-01, 9:13 to 9:36 AM): never a stack of full-width
 * buttons, never a "More / Fewer options" panel, never the same action twice.
 *  - A step due now (Confirm they've arrived, Approve and release, I'm on my way, Review) is the LEAD, on the right
 *    (the owner's primary-right rule, 2026-10-08), with the one other action on its left, or "More options" when there
 *    are two or more.
 *  - No step due: Message leads, STILL on the right (owner 2026-11-01 12:00 PM, app-wide: in a side-by-side pair the
 *    green primary is on the RIGHT, the outlined one on the left), with the one action beside it or "More options".
 *    Only an outlined lead (nothing green in the row) keeps the left.
 *  - "More options" opens every other action as one list in one tap (a sheet); a lone extra is never in a menu.
 * The card's own actions (jobStepMenu.tsx) are drawn into `cardSecondHost` (a lone one) or `cardListHost` (the
 * sheet's list) by the hidden step card; `cardLeadHost` takes the card's own primary when the page has no step.
 *
 * Guard: src/pages/jobs/jobPage/JobPage.test.tsx ("one row of buttons").
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { buttonLabel, pairLabel, PAIR_TEXT } from "@/components/ui/pairLabel";

export type RowAction = {
  key: string;
  label: string;
  go: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Extra props on the button (the age gate's greyed-out look). */
  gated?: Record<string, unknown>;
};

// A long step ("Confirm they've arrived") wraps to two centred lines in its half at 375 rather than clipping (B93 look).
const BTN = "min-w-0 w-full rounded-full px-4 text-ds-15 leading-tight";
// Owner 11-01: in a side-by-side pair each button reads its SHORT label on ONE line ("Message", "Approve");
// a button alone (one cell, or the More options sheet) keeps the full words (pairLabel.ts).
const PAIR_BTN = `min-w-0 w-full rounded-full leading-tight ${PAIR_TEXT}`;

function ActionButton({ a, lead, pair = false }: { a: RowAction; lead?: boolean; pair?: boolean }) {
  // A confirm reads just "Confirm" alone too (owner 11-01, pairLabel.ts buttonLabel); the full words stay its name.
  const shown = pair ? pairLabel(a.label) : buttonLabel(a.label);
  return (
    <Button
      type="button"
      variant={lead ? "primary" : "outline"}
      size="wrap"
      data-row-action={a.key}
      className={`${pair ? PAIR_BTN : BTN} ${a.danger ? "text-destructive-ink" : ""}`}
      disabled={a.disabled}
      onClick={a.go}
      aria-label={shown !== a.label ? a.label : undefined}
      {...(a.gated ?? {})}
    >
      {shown}
    </Button>
  );
}

export function JobPageActionRow({
  lead,
  leadIsStep,
  extras,
  cardCount = 0,
  cardLead = false,
  setCardLeadHost,
  setCardSecondHost,
  setCardListHost,
  tag,
  plainLead = false,
}: {
  /** The page's own lead (a step, or Message); null when the card's primary leads (`cardLead`) or nothing does. */
  lead: RowAction | null;
  /** The lead is a step (right side) rather than Message (left side). */
  leadIsStep: boolean;
  /** The page's own other actions (Message when a step leads, Edit, Change date or time, Cancel job, Open in working). */
  extras: RowAction[];
  /** How many of the hidden card's actions the page offers (jobStepMenu.tsx). */
  cardCount?: number;
  /** The card's own primary leads the row (the page has no step; the card has one). */
  cardLead?: boolean;
  setCardLeadHost?: (el: HTMLElement | null) => void;
  setCardSecondHost?: (el: HTMLElement | null) => void;
  setCardListHost?: (el: HTMLElement | null) => void;
  /** The row's data attribute, for tests and screenshots ("poster" or "helpr"). */
  tag: string;
  /** The lead is an ordinary action (outlined), not a step or Message. */
  plainLead?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Nothing leads (an open job with no applicants: Edit, Change, Cancel): the first action takes the left half, so
  // the row is never a lone "More options".
  if (!lead && !cardLead && extras.length > 0) {
    return <JobPageActionRow {...{ lead: extras[0], leadIsStep: false, extras: extras.slice(1), cardCount, setCardSecondHost, setCardListHost, tag }} plainLead />;
  }
  const others = extras.length + cardCount;
  // The green one is always on the right (owner 2026-11-01 12:00 PM); an outlined (plain) lead reads left to right.
  // `leadIsStep` still says which kind of lead it is (the callers' own reading); it no longer moves it.
  void leadIsStep;
  const stepRight = cardLead || (!!lead && !plainLead);
  const pair = others > 0 && (cardLead || !!lead);
  const leadNode = cardLead
    ? <div key="lead" ref={setCardLeadHost} data-card-lead="" className="flex min-w-0" />
    : lead ? <ActionButton key="lead" a={lead} lead={!plainLead} pair={pair} /> : null;
  const second = others === 0
    ? null
    : others === 1
      ? extras.length === 1
        ? <ActionButton key="second" a={extras[0]} pair={pair} />
        : <div key="second" ref={setCardSecondHost} data-row-one-action="" className="flex min-w-0" />
      : (
        <Button key="second" type="button" variant="outline" size="wrap" className={pair ? PAIR_BTN : BTN} aria-haspopup="dialog" data-row-more="" onClick={() => setOpen(true)}>
          More options
        </Button>
      );
  const cells = (stepRight ? [second, leadNode] : [leadNode, second]).filter(Boolean);
  if (cells.length === 0) return null;
  return (
    <>
      <div data-job-row={tag} className={cells.length === 2 ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"}>{cells}</div>
      {others > 1 && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" data-row-options={tag}>
            <SheetHero title="More options" />
            {/* One tap runs an action and closes the list. */}
            <div className="flex flex-col gap-2 pb-2" onClick={() => setOpen(false)}>
              {extras.map((a) => <ActionButton key={a.key} a={a} />)}
              {cardCount > 0 && <div ref={setCardListHost} className="flex flex-col gap-2" />}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
