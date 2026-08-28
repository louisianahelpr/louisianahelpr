import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The icon-over-label action row shared by the activity job cards.
 *
 * This shape already existed, inline, in exactly one place: the four pastel
 * chips (Share / Boost / Edit / Cancel) on an OPEN posted job. The owner asked
 * for the in-progress actions — and the applied card's Withdraw — to "be icons
 * but just put the words under it like the other page does for shared edit
 * etc.", so rather than writing the same flex-col Button a third time it is
 * extracted here and the original four now render through it too.
 *
 * The four chips' COLOURS are untouched — {@link jobActionChipStyle} carries
 * their exact tint/ink/border triples across verbatim. The only rendered
 * difference is the 44px minimum height below, which they were ~3px short of.
 */

/** Column counts we actually use. Static strings — Tailwind cannot see
 *  `grid-cols-${n}`, which is how a row silently loses its grid. */
const COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  // Five is the ceiling, reached only by an in-progress job that is
  // simultaneously on-site (SOS), marked done by the helper (Approve) and
  // carrying an open revision (Dispute). At 320px that is ~55px a chip —
  // enough for the terse labels this row uses, and nothing longer belongs
  // in it.
  5: "grid-cols-5",
};

/**
 * Shared chip geometry. Exported because ShareJobButton renders its own
 * <Button> (it owns the native-share fallback chain) and has to match its
 * neighbours exactly — it takes this string through its `className` prop.
 *
 * `min-h-[44px]` is the tap target. `h-auto` alone left these at ~41px.
 */
export const JOB_ACTION_CHIP_CLASS =
  "w-full h-auto min-h-[44px] flex-col gap-0.5 px-1 py-1.5 glass-press border-0";

/**
 * The FULL-WIDTH sibling of the chip, for the one-decision-per-row controls
 * that legitimately span the card (Confirm Start / Confirm They Arrived /
 * Confirm They're Working / View Timeline).
 *
 * It exists because those four were the last places in the posted-job card
 * still drawing their own button: three different treatments across four
 * buttons that all mean "acknowledge a step" — two solid `default` CTAs
 * (Confirm Start, the card-body Confirm Arrival) beside two tinted outlines
 * (Confirm They Arrived, Confirm They're Working), at text-ds-15/font-bold
 * next to a chip row at text-ds-11/font-medium. Same height (size="sm" is
 * h-11, exactly the chip's 44px min) but nothing else matched, which is what
 * "button inconsistency in size etc." was pointing at.
 *
 * Deliberately NOT the chip's stacked icon-over-label: a control that owns a
 * whole row reads better horizontally, and stacking a lone chip across the
 * card would leave a 44px band of empty tint either side of the icon. What it
 * DOES share is the 44px tap target, the row's type scale and weight, and the
 * `jobActionChipStyle` tone palette — so the full-width control and the chips
 * under it read as one system rather than two.
 */
export const JOB_ACTION_FULL_CLASS =
  "w-full h-11 min-h-[44px] gap-1.5 px-3 text-ds-11 font-medium glass-press border-0";

export type JobActionTone =
  | "info"
  | "boost"
  | "edit"
  | "danger"
  | "primary"
  | "approve"
  | "neutral"
  | "share"
  | "done";

/**
 * Tint/ink/border per chip tone.
 *
 * Every value here is lifted verbatim from the existing four-chip row, so the
 * Share/Boost/Edit/Cancel chips render byte-identically after the extraction.
 * `primary` is the one addition: a SOLID bark fill, so a row can still express
 * hierarchy without leaving the icon-over-label layout. Solid-vs-tint carries
 * the hierarchy that full-width-vs-inline used to — it marks the ONE main move
 * in a row (Approve & release on an in-progress job, Hire again on a completed
 * one), never Message.
 */
export function jobActionChipStyle(tone: JobActionTone): CSSProperties {
  switch (tone) {
    case "info":
      // Matches messageButtonStyle above — owner call 2026-08-24 moved
      // Message from blue to the quiet olivewood outline, chip included.
      return {
        background: "hsl(var(--olivewood) / 0.08)",
        color: "hsl(var(--olivewood))",
        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
      };
    case "boost":
      return {
        background: "hsl(var(--boost-tint) / 0.14)",
        color: "hsl(var(--boost-ink))",
        border: "0.5px solid hsl(var(--boost-tint) / 0.34)",
      };
    case "edit":
      // SUNSHINE, not antique gold (owner: "make review a more sunshine
      // yellow"). --gold-warm is 38° at 60% saturation — a muted brass that
      // rendered as a beige rectangle at chip size. --live-pill-* is the app's
      // existing bright yellow (45°/95%), already used by the in-progress
      // pill, already carrying a legible dark-yellow ink for light AND a light
      // one for dark. Reused rather than adding a fourth yellow token: the
      // palette has enough of them, and one of them was already the right one.
      return {
        background: "hsl(var(--live-pill-tint) / 0.30)",
        color: "hsl(var(--live-pill-ink))",
        border: "0.5px solid hsl(var(--live-pill-tint) / 0.60)",
      };
    case "danger":
      // --danger-ink, not a hardcoded dark red: the literal it replaced had no
      // dark sibling and measured 1.92:1 on the dark tinted pill.
      return {
        background: "hsl(var(--destructive) / 0.11)",
        color: "hsl(var(--danger-ink))",
        border: "0.5px solid hsl(var(--destructive) / 0.32)",
      };
    case "neutral":
      // The quiet tone. Two users:
      //
      //  1. MESSAGE, in every state. It used to be solid bark here, on the
      //     theory that a full-width "Approve & release payment" above the row
      //     carried the hierarchy. Both halves of that were wrong: the owner's
      //     rule is "Message should be the same color for all places", and
      //     every OTHER Message in the app (ActiveJobSection, ConfirmedSection,
      //     DisputedSection, the accepted-state row) is a quiet outline button
      //     — so bark made this one chip the odd one out rather than the
      //     consistent one. The full-width Approve is also gone; it is a chip
      //     in this same row now, and `primary` (solid bark) is reserved for it
      //     and for Hire again, the two chips that really are the main move.
      //
      //  2. A COMPLETED action's done-state (Tipped / Reviewed) — inert, so it
      //     should recede rather than keep the live action's colour.
      //
      // Same olivewood tint the "waiting" status pill uses, so it reads as
      // secondary without borrowing another action's hue.
      return {
        background: "hsl(var(--olivewood) / 0.08)",
        color: "hsl(var(--olivewood))",
        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
      };
    case "approve":
      // A GREEN LIGHT, literally (owner: "make this more of a green light
      // color"). Approve had been on `primary` — the bark tint borrowed from
      // the money chip — which is olive, the same family as the page's own
      // furniture, so the one chip that means "go, release the money" looked
      // like part of the card rather than a decision.
      //
      // --live is the app's existing go-green (142° at 64%): the presence dot,
      // the landing heartbeat, the payout ticker. Reused rather than minted so
      // the app keeps ONE saturated green, and it already carries a lightened
      // dark-mode value. The ink is --success-ink-deep, the same green family's
      // text token, which measures well clear of AA on this fill in both
      // themes.
      //
      // Distinct from `done` on purpose: `done` is the SAME hue at low
      // presence for a finished, inert action (Tipped / Reviewed), this is the
      // live one. Green means good outcome either way; brightness says whether
      // there is still something to press.
      return {
        // Bark tint, not the green light — owner call 2026-08-24 ("brand the
        // action buttons"), reversing the 2026-08-20 green. Same-day context:
        // solid fills were rejected on the filter chips, so the main move is
        // the DECISIVE tint (0.18/0.55), one step louder than `primary`.
        background: "hsl(var(--bark) / 0.18)",
        color: "hsl(var(--bark))",
        border: "0.5px solid hsl(var(--bark) / 0.55)",
      };
    case "done":
      // A finished action — Tipped, Reviewed. It used to borrow `neutral`,
      // the same olivewood grey a disabled control wears, so "you already
      // tipped them" read as "this button is broken" (owner: "tipped and
      // reviewed should be better colors like the other pages"). Success
      // tint + success ink is the pair every other done-state in the app uses
      // — the completed status stripe, the tracker's finished steps — so a
      // done chip now looks done rather than dead.
      return {
        // --success-tint is a 96%-lightness panel fill; on a chip it read as
        // "off-white with a faint wash" — the owner's "meh". Tinting from
        // --success-ink instead gives the same hue real presence at chip size
        // while keeping the ink AA on it.
        background: "hsl(var(--success-ink) / 0.14)",
        color: "hsl(var(--success-ink-deep))",
        border: "0.5px solid hsl(var(--success-ink) / 0.38)",
      };
    case "share":
      // SHARE. Owner call 2026-08-20: blue moved to Message ("I think blue
      // suits messages better"), and Share must not fall back to the quiet
      // neutral. It cannot take `boost` either — Share and Boost sit in the
      // same row on an open job, and identical chips would read as one
      // control repeated. Sage is the brand's own accent, unused by any other
      // tone, so Share stays distinctly non-neutral without borrowing a hue
      // that already means something else in this row.
      //
      // The label is --sage-ink, not raw --bark: every other tinted tone in
      // this row pairs its tint with a theme-adaptive -ink token, and Share
      // was the one that skipped it. Dark-mode --bark is a mid olive and
      // measured 4.24:1 on this chip — the same defect the --danger-ink
      // comment above records. Light mode is unchanged (--sage-ink's light
      // value IS the old --bark).
      return {
        background: "hsl(var(--sage) / 0.18)",
        color: "hsl(var(--sage-ink))",
        border: "0.5px solid hsl(var(--sage) / 0.42)",
      };
    case "primary":
    default:
      // A TINT, not a solid fill (owner: "make this lighter, it competes with
      // Post a Task; make it the same green as the background of the money").
      // Solid bark is the app's loudest surface and it belongs to the one CTA
      // that sits above every screen — a card-level Approve or Hire again
      // shouting at the same volume made two different-sized decisions look
      // equally urgent. These are the exact three values the money chip uses
      // (JobPrice's `chip`), so the card's primary action and its price now
      // share one green.
      //
      // It is still the loudest chip IN ITS ROW: every other tone tints from a
      // hue that means something specific (blue Message, red Dispute, gold
      // Review), and bark is the brand's own, so it reads as "the main move"
      // without borrowing the global CTA's weight.
      return {
        background: "hsl(var(--bark) / 0.10)",
        backgroundImage: "none",
        color: "hsl(var(--bark))",
        border: "0.5px solid hsl(var(--bark) / 0.28)",
      };
  }
}


/**
 * The Message treatment, in ONE place.
 *
 * Owner rule, stated twice: "Message should be the same color for all places."
 * Owner call 2026-08-20: that colour is BLUE — "I think blue suits messages
 * better" — and Share gave the blue up in exchange (see the `share` tone).
 *
 * Message renders as a chip in the posted-card action row and as an outline
 * <Button> in five other sections. Both read from this so they cannot drift
 * apart again, which is exactly how Message ended up solid-bark in one place
 * and outline in five others.
 */
export const messageButtonStyle: CSSProperties = {
  // Olivewood quiet outline — owner call 2026-08-24 ("brand the action
  // buttons"), reversing 2026-08-20's blue. The rule that matters survives:
  // Message is one colour EVERYWHERE, and this constant is that one place.
  background: "hsl(var(--olivewood) / 0.08)",
  color: "hsl(var(--olivewood))",
  borderColor: "hsl(var(--olivewood) / 0.22)",
};

/**
 * Row wrapper. `columns` is passed explicitly rather than counted from
 * children so a conditionally-absent action (No-Show only appears once the
 * start time has passed) yields a deliberate two-up row instead of two chips
 * stranded in a three-column grid.
 */
export function JobActionRow({
  columns,
  children,
  className,
}: {
  columns: 1 | 2 | 3 | 4 | 5;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid ${COLS[columns]} gap-1.5${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

export function JobActionChip({
  icon: Icon,
  label,
  tone,
  onClick,
  disabled,
  /** Spoken name when the visible label is abbreviated for width
   *  ("Message" in a 320px three-up row, "Message Helpr" to a screen reader). */
  ariaLabel,
}: {
  icon: LucideIcon;
  label: string;
  tone: JobActionTone;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={JOB_ACTION_CHIP_CLASS}
      style={jobActionChipStyle(tone)}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <Icon className="w-4 h-4" />
      <span className="text-ds-11 leading-none font-medium">{label}</span>
    </Button>
  );
}
