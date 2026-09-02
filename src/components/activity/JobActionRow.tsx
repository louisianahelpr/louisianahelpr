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
 *
 * THE LABEL MUST WRAP, and the override has to live on the label element.
 * `buttonVariants` sets `whitespace-nowrap` on the button itself, so a label
 * longer than its column did not wrap — it rendered outside the tinted box.
 * Measured at 375px: "View Timeline & Add Evidence" wanted 169px in a 110px
 * chip, clipping "Vi" off the left edge of the card and colliding with the
 * Message chip beside it; the shorter chips in the five-up completed row
 * spilled 6-22px each, and ~30px more at 320px.
 *
 * `whitespace-normal` in THIS string would not fix it: Tailwind emits
 * `whitespace-nowrap` after `whitespace-normal` in its own stylesheet, so on
 * the same element nowrap wins regardless of class order. The label inherits
 * nowrap from the button instead, and a rule that targets the label directly
 * beats inheritance — hence the `[&_span]:` descendant variants. They also
 * reach the two chips that render their own <span> through this class
 * (ShareJobButton, SosShareButton) without those files having to know.
 *
 * `min-w-0` is the other half: a grid item's default `min-width: auto` refuses
 * to shrink below its content, which is what let a too-wide chip push past its
 * column instead of wrapping inside it.
 */
export const JOB_ACTION_CHIP_CLASS =
  "w-full h-auto min-h-[44px] min-w-0 flex-col gap-0.5 px-1 py-1.5 glass-press border-0 " +
  "[&_span]:whitespace-normal [&_span]:break-words [&_span]:leading-tight [&_span]:text-center";

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
  | "message"
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
    // MESSAGE, and nothing else. This tone exists so the owner rule — stated
    // twice, "Message should be the same color for all places" — is something
    // a call site *passes* rather than something a comment *asserts*.
    //
    // It replaces a `messageButtonStyle` CSSProperties constant that claimed to
    // be the single source of truth for Message and had ZERO importers: the
    // chip row hardcoded the identical triple beside a comment saying the two
    // "cannot drift apart again", while Message itself was split across
    // `tone="info"` (x4) and `tone="neutral"` (x2) — two tones that happened to
    // resolve to the same values, so a real drift was already latent and
    // invisible. Every Message in the app now passes `tone="message"`, and
    // `src/test/messageToneInvariant.test.ts` fails the build if one doesn't.
    // That is what the deleted comment was promising.
    case "message":
      // Quiet olivewood outline — owner call 2026-08-24 ("brand the action
      // buttons"), reversing 2026-08-20's blue.
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
      // The quiet tone — the SUPPORTING actions, the ones that neither decide
      // anything nor destroy anything. Today: Timeline & Evidence and Contact
      // Admin on a disputed job (both cards), Directions, and the tracker
      // panel's secondary control.
      //
      // Message used to live here too, which is why it is worth saying plainly
      // that it no longer does: Message has its own `message` tone so a change
      // to the supporting-action grey cannot silently recolour it. Same values
      // today, different tones on purpose (see `share`).
      //
      // Same olivewood tint the "waiting" status pill uses, so it reads as
      // secondary without borrowing another action's hue.
      return {
        background: "hsl(var(--olivewood) / 0.08)",
        color: "hsl(var(--olivewood))",
        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
      };
    case "approve":
      // THE DECISIVE BARK TINT — the loudest chip in the row, for "Approve &
      // release payment".
      //
      // Read the values, not the history: this is bark at 0.18/0.55, one step
      // louder than `primary`'s 0.10/0.28, so the main move outweighs the
      // card's other actions without leaving the brand's own hue. Owner call
      // 2026-08-24 ("brand the action buttons"); solid fills were rejected the
      // same day on the filter chips, so hierarchy is carried by tint depth.
      //
      // It was briefly a saturated go-green (`--live` / `--success-ink-deep`,
      // 2026-08-20) and this comment kept describing that green for a week
      // after the bark landed under it — a doc block asserting one colour over
      // a return statement producing another. If this case changes again,
      // change these lines with it.
      return {
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
      // SHARE, on the open posted-job row. It renders through ShareJobButton,
      // which owns the native-share fallback chain and therefore draws its own
      // <Button> — so it takes this via `style={jobActionChipStyle("share")}`
      // rather than a `tone` prop.
      //
      // This case used to be a SAGE tint (`--sage` / `--sage-ink`), justified
      // by a 2026-08-20 owner call: blue had just moved to Message, and Share
      // "must not fall back to the quiet neutral". That value was dead — no
      // call site ever passed `tone="share"` — because the 2026-08-24 branding
      // call put Share on the same quiet olivewood as everything else in the
      // row, under the name `info`. The sage is gone rather than preserved in
      // a comment: what ships is what is written here.
      //
      // It is deliberately the SAME triple as `message` and `neutral` today
      // and deliberately NOT the same constant. Folding three identical
      // literals into one shared object would mean recolouring Share silently
      // recolours Message — the exact coupling this file just got rid of.
      return {
        background: "hsl(var(--olivewood) / 0.08)",
        color: "hsl(var(--olivewood))",
        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
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

/**
 * The chip's accessible name, which must CONTAIN its visible label (WCAG 2.5.3
 * Label in Name).
 *
 * `aria-label` REPLACES the visible text rather than adding to it, so passing
 * the descriptive string alone left a voice-control user unable to say the word
 * they can see: "Hire Again" spoke as "Hire this Helpr again", "Contact Admin"
 * as "Contact an admin about this dispute". Deleting the descriptive text is
 * not the fix either — a screen-reader user out of the row's visual context
 * needs it. So compose: visible label first (what a voice user says), context
 * after (what a screen-reader user needs).
 *
 * The prefix is skipped when the caller's string already opens with the visible
 * label, so a call site that writes its own "Hire Again — …" does not come out
 * as "Hire Again — Hire Again — …".
 */
function composeAccessibleName(label: string, ariaLabel?: string): string | undefined {
  if (!ariaLabel) return undefined; // no aria-label: the visible text IS the name
  const starts = ariaLabel.trim().toLowerCase().startsWith(label.trim().toLowerCase());
  return starts ? ariaLabel : `${label} — ${ariaLabel}`;
}

export function JobActionChip({
  icon: Icon,
  label,
  tone,
  onClick,
  disabled,
  /** Extra context for a screen reader ("Message" in a 320px three-up row,
   *  "Message Helpr" spoken). It is APPENDED to the visible label, never
   *  substituted for it — see composeAccessibleName. */
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
      // Test hook, same shape as `data-status-stripe`. The 320px "no action
      // label truncates" gate in activity-card-density.spec.ts had no way to
      // say "the chips in this row" and swept every `button span` on the page
      // — which caught JobCardMetaRow's location chip, a control that is
      // SUPPOSED to ellipsis (it is the one `shrink` item in a row of
      // `shrink-0` date/time chips, so it is what gives way at narrow widths).
      // A chip label is different: it has nowhere to go and must fit.
      data-job-action-chip=""
      aria-label={composeAccessibleName(label, ariaLabel)}
      onClick={onClick}
    >
      <Icon className="w-4 h-4" />
      {/* leading-tight, not leading-none: these labels wrap now (see
          JOB_ACTION_CHIP_CLASS), and leading-none stacked two lines on top of
          each other. */}
      <span className="text-ds-11 leading-tight font-medium">{label}</span>
    </Button>
  );
}
