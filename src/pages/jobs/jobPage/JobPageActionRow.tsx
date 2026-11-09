/**
 * THE JOB PAGE'S ONE STICKY ACTION BAR, both sides (owner pick 11-08, design audit A JP2: "one primary + at most one
 * secondary on every stage; the rest in '...'"). On a phone the row is StickyActionBar's: fixed on the bottom edge,
 * always in thumb reach, whatever the stage; wider, the same row sits in the side card. ONE primary (the stage's
 * next step), AT MOST ONE secondary (the first action that may stand alone), and every other action in the "..."
 * menu at the top right (aria name "More options", the same sheet as before), "Didn't come back" / "Can't come
 * back", "Something's not right" and "Not finished? Set a day" among them (`inMenu`).
 * The 11-01 rules it keeps (owner 2026-11-01, 9:13 to 9:36 AM): never a stack of full-width
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
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
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
  /** Never the bar's secondary: always in the "..." menu (a report, a complaint, a new day). */
  inMenu?: boolean;
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
  cardInMenu = false,
  cardLead = false,
  setCardLeadHost,
  setCardSecondHost,
  setCardListHost,
  tag,
  plainLead = false,
  menuHost = null,
}: {
  /** The page's own lead (a step, or Message); null when the card's primary leads (`cardLead`) or nothing does. */
  lead: RowAction | null;
  /** The lead is a step (right side) rather than Message (left side). */
  leadIsStep: boolean;
  /** The page's own other actions (Message when a step leads, Edit, Change date or time, Cancel job, Open in working). */
  extras: RowAction[];
  /** How many of the hidden card's actions the page offers (jobStepMenu.tsx). */
  cardCount?: number;
  /** Q2592 (owner 11-02): the card's actions go inside More options even when there is one (a lone SOS). */
  cardInMenu?: boolean;
  /** The card's own primary leads the row (the page has no step; the card has one). */
  cardLead?: boolean;
  setCardLeadHost?: (el: HTMLElement | null) => void;
  setCardSecondHost?: (el: HTMLElement | null) => void;
  setCardListHost?: (el: HTMLElement | null) => void;
  /** The row's data attribute, for tests and screenshots ("poster" or "helpr"). */
  tag: string;
  /** The lead is an ordinary action (outlined), not a step or Message. */
  plainLead?: boolean;
  /** Where the "..." button goes (a slot in the page's top bar); without one it sits at the bar's left. */
  menuHost?: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  // Nothing leads (an open job with no applicants: Edit, Change, Cancel): the first action takes the left half, so
  // the row is never a lone "More options".
  if (!lead && !cardLead && extras.length > 0) {
    const first = extras.find((a) => !a.inMenu);
    if (first) return <JobPageActionRow {...{ lead: first, leadIsStep: false, extras: extras.filter((a) => a !== first), cardCount, cardInMenu, setCardSecondHost, setCardListHost, tag, menuHost }} plainLead />;
  }
  const others = extras.length + cardCount;
  // Q2592: a lone card action that belongs in the menu (SOS) still opens the menu, never a peer button.
  const menuOnly = cardInMenu && cardCount > 0;
  // The green one is always on the right (owner 2026-11-01 12:00 PM); an outlined (plain) lead reads left to right.
  // `leadIsStep` still says which kind of lead it is (the callers' own reading); it no longer moves it.
  void leadIsStep;
  const stepRight = cardLead || (!!lead && !plainLead);
  // THE ONE SECONDARY (owner pick 11-08): the first page action that may stand alone; a lone card action takes the
  // slot when it is the only other one (and not an SOS). Everything else is in the "..." menu.
  const loneCard = others === 1 && extras.length === 0 && !menuOnly;
  const secondAction = loneCard ? null : extras.find((a) => !a.inMenu) ?? null;
  const menuExtras = extras.filter((a) => a !== secondAction);
  const menuCount = menuExtras.length + (loneCard ? 0 : cardCount);
  const pair = (!!secondAction || loneCard) && (cardLead || !!lead);
  const leadNode = cardLead
    ? <div key="lead" ref={setCardLeadHost} data-card-lead="" className="flex min-w-0" />
    : lead ? <ActionButton key="lead" a={lead} lead={!plainLead} pair={pair} /> : null;
  const second = loneCard
    ? <div key="second" ref={setCardSecondHost} data-row-one-action="" className="flex min-w-0" />
    : secondAction ? <ActionButton key="second" a={secondAction} pair={pair} /> : null;
  const cells = (stepRight ? [second, leadNode] : [leadNode, second]).filter(Boolean);
  const more = menuCount > 0 ? (
    <Button key="more" type="button" variant="outline" size="icon" aria-label="More options" aria-haspopup="dialog" data-row-more={tag}
      className={menuHost ? "h-11 w-11 shrink-0 rounded-full border-0 bg-transparent" : "h-12 w-12 !flex-none shrink-0 rounded-full"} onClick={() => setOpen(true)}>
      <MoreHorizontal className="h-5 w-5" aria-hidden />
    </Button>
  ) : null;
  if (cells.length === 0 && !more) return null;
  return (
    <>
      {cells.length > 0 || !menuHost ? (
        <StickyActionBar label="Job actions" data-job-bar={tag}>
          {/* A3-13 (audit 11-01): from md up each button is capped at 240px and the row sits right (step last), not
              ~547px a button across the page at 1440. The pair caps its columns, not the row (onePageColumn). */}
          <div data-job-row={tag} className={`flex w-full items-center gap-2 [&>[data-row-cell]]:min-w-0 [&>[data-row-cell]]:flex-1 md:justify-end md:[&>[data-row-cell]]:max-w-[240px]`}>
            {!menuHost && more}
            {cells.map((c, i) => <div key={i} data-row-cell="" className="flex">{c}</div>)}
          </div>
        </StickyActionBar>
      ) : null}
      {menuHost && more && createPortal(more, menuHost)}
      {menuCount > 0 && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" data-row-options={tag}>
            <SheetHero title="More options" />
            {/* One tap runs an action and closes the list. */}
            <div className="flex flex-col gap-2 pb-2" onClick={() => setOpen(false)}>
              {menuExtras.map((a) => <ActionButton key={a.key} a={a} />)}
              {cardCount > 0 && !loneCard && <div ref={setCardListHost} className="flex flex-col gap-2" />}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
