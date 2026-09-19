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
 * THE ONE SHAPE OF A JOB-CARD ACTION ROW — owner, 2026-09-19, for the second
 * time and with a screenshot: "i will not say this again. the buttons need to
 * have the same size font and everything they shouldnt have all different
 * stuff".
 *
 * Icon ABOVE an 11px label that may wrap, a declared 44px tap floor, the
 * Button base's own radius. EVERY control in the row is this object: the
 * chips, the primary, the tracker's portalled CTA, the location retry, the
 * photo capture. The only two things a row is allowed to vary are
 *
 *   TONE      green gloss for the main move, danger tint for a destructive
 *             one, done tint for one already taken (jobActionChipStyle);
 *   POSITION  the primary trails on the right (owner V2/V3).
 *
 * WHY STACKED AND NOT INLINE. The row must hold FIVE controls at 320px without
 * wrapping (the poster's disputed card: Escalate · Timeline · Message ·
 * Contact Admin + Resolve & Pay). At 320 the row measures ~256px, so five
 * slots and four 6px gaps leave ~46px each. An inline icon-beside-label
 * control needs the icon (18px) + its gap + the longest word at 14px
 * ("Working" ≈ 54px) ≈ 76px before it can show a single word — it cannot fit,
 * which is exactly why the inline primary had grown a 12px `[data-tight]`
 * step-down and a THIRD type size. Stacked gives the whole 46px to the label
 * and lets it wrap: "Working" at 11px is ~42px. One shape, one size, no
 * step-down.
 *
 * Exported because ShareJobButton, SosShareButton and DirectionsButton render
 * their own <Button>/<a> (native-share fallback chains and an anchor the OS
 * must see) and have to match their neighbours exactly — they take this string
 * through `className`.
 *
 * `min-h-[44px]` is the tap target, DECLARED rather than inherited from the
 * row's CSS: `h-auto` alone left these at ~41px, and a control that relies on
 * index.css to rescue its height is one stylesheet edit from being a different
 * size than the control beside it.
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
export const JOB_ROW_CONTROL_SHAPE =
  "w-full h-auto min-h-[44px] min-w-0 flex-col gap-0.5 px-1 py-1.5 " +
  "[&_span]:whitespace-normal [&_span]:break-words [&_span]:leading-tight [&_span]:text-center";

/**
 * THE SHAPE PLUS THE TINTED-CHIP SURFACE. Everything that is not the glossy
 * primary wears this: `glass-press` is the press effect a tinted/outline
 * control needs (the glossy primary brings its own through `btn-grad-primary`
 * + ELEV_FILLED, and stacking the two made the main move press twice as deep
 * as its neighbours), `border-0` because the tone's own hairline comes from
 * {@link jobActionChipStyle}.
 */
export const JOB_ACTION_CHIP_CLASS = `${JOB_ROW_CONTROL_SHAPE} glass-press border-0`;

/**
 * THE LABEL. One element, one size, one weight, for every control in the row —
 * `JobActionChip`, `JobStepPrimaryButton`, and the three files that draw their
 * own <Button> into the row (ShareJobButton, SosShareButton, DirectionsButton)
 * because they own an <a> or a native-share fallback chain.
 *
 * `leading-tight`, not `leading-none`: these labels wrap (see
 * JOB_ROW_CONTROL_SHAPE) and leading-none stacked two lines on top of
 * each other.
 */
export const JOB_ROW_LABEL_CLASS = "text-ds-11 leading-tight font-medium";

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
 *
 * NOT for job STEP cards: those draw their one row in JobStepCard (owner,
 * 2026-09-14, VN-21 — primary and chips on a single flex row that never
 * wraps). This grid remains for the chip rows outside the step shell (the
 * pending application's Edit / Withdraw, the helper's completed Review).
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

/**
 * THE PRIMARY of a job step card's one row (owner, 2026-09-14, VN-21: "one
 * row, primary action in the dark green (btn primary), other buttons beside
 * it").
 *
 * The `default` Button variant, so it wears `btn-grad-primary` — the same
 * surface as the tracker's own next-step CTA, which portals into the same slot
 * — and nothing is layered over it (no inline `background`, no tint): the
 * gloss IS the hierarchy. Before this, the row's primary was drawn five ways —
 * the tracker's gloss, PayoutPrimary's flat bark painted over the gloss, the
 * poster's quiet `primary` tint, the revision's amber, the dispute's outline —
 * so "the main move" looked different on every step.
 *
 * IT IS THE SAME OBJECT AS THE CHIPS BESIDE IT (owner, 2026-09-19, second
 * report): `JOB_ROW_CONTROL_SHAPE`, the same 11px `JOB_ROW_LABEL_CLASS`, the
 * same icon-above-label stack, the same declared 44px floor. It used to be an
 * inline `size="sm"` button at 14px with no declared floor, sitting beside
 * stacked 11px chips — two kinds of object in one row, which is what the
 * screenshot showed. Only the SURFACE says it is the primary.
 */
export function JobStepPrimaryButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  ariaLabel,
  iconClassName,
  tone = "primary",
}: {
  icon: LucideIcon;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  /** Appended to the visible label, never substituted — see composeAccessibleName. */
  ariaLabel?: string;
  iconClassName?: string;
  /**
   * `done` — this row's action has ALREADY BEEN TAKEN and the box stays on
   * screen saying so (owner, 2026-09-19: "if it was clicked already it should
   * still show but with the box disabled"). It wears the row's `done` tone —
   * the same success tint the "Tipped" / "Reviewed" chips use — and NOT the
   * glossy primary at 50% opacity, because a greyed-out green is exactly how
   * "you already did this" ends up reading as "this button is broken" (the
   * case that put `done` in `jobActionChipStyle` in the first place).
   *
   * Everything else is identical to the primary: same slot, same 44px floor,
   * same 14px type, same released height. Only the surface changes, so the
   * box cannot drift into being a differently-sized control.
   */
  tone?: "primary" | "done";
}) {
  if (tone === "done") {
    return (
      <Button
        variant="outline"
        size="sm"
        className={JOB_ACTION_CHIP_CLASS}
        style={jobActionChipStyle("done")}
        // Always inert: a finished statement, never a tap.
        disabled
        // How a test — and a reader of the DOM — tells "the row's primary is a
        // finished box" from "the row's primary lost its gloss", which is a
        // defect (jobStepOneRow.test.tsx).
        data-job-step-done=""
        aria-label={composeAccessibleName(label, ariaLabel)}
        onClick={onClick}
      >
        <Icon className={`w-4 h-4${iconClassName ? ` ${iconClassName}` : ""}`} />
        <span className={JOB_ROW_LABEL_CLASS}>{label}</span>
      </Button>
    );
  }
  return (
    // `h-auto` (inside JOB_ROW_CONTROL_SHAPE) alongside `size="sm"`'s `h-11`:
    // this control's height is DELIBERATELY released so a long label ("Mark Job
    // Complete") wraps and grows past 44px instead of truncating, with
    // `min-h-[44px]` holding the tap floor. Naming `h-auto` also tells the
    // buttonGeometry a11y gate the height was released on purpose, so it is not
    // flagged as an `h-11` (44px) size class the cascade "defeated" — a real
    // control never matches the 44px it declares, and this is the sanctioned
    // way to say so (buttonGeometry.ts).
    //
    // NO `glass-press`: `btn-grad-primary` carries ELEV_FILLED's own
    // `active:scale-[0.97]` and shadow collapse. Adding the chips' press on top
    // pressed the main move twice as deep as its neighbours — a difference in
    // FEEL that the owner's "same … everything" covers just as much as size.
    <Button
      size="sm"
      className={JOB_ROW_CONTROL_SHAPE}
      disabled={disabled}
      aria-label={composeAccessibleName(label, ariaLabel)}
      onClick={onClick}
    >
      <Icon className={`w-4 h-4${iconClassName ? ` ${iconClassName}` : ""}`} />
      <span className={JOB_ROW_LABEL_CLASS}>{label}</span>
    </Button>
  );
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
      <span className={JOB_ROW_LABEL_CLASS}>{label}</span>
    </Button>
  );
}
