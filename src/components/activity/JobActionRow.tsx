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

export type JobActionTone = "info" | "boost" | "edit" | "danger" | "primary" | "neutral";

/**
 * Tint/ink/border per chip tone.
 *
 * Every value here is lifted verbatim from the existing four-chip row, so the
 * Share/Boost/Edit/Cancel chips render byte-identically after the extraction.
 * `primary` is the one addition: a SOLID bark fill, so a row can still express
 * hierarchy (Message Helpr is the primary action on an in-progress job) without
 * leaving the icon-over-label layout. Solid-vs-tint carries the hierarchy that
 * full-width-vs-inline used to.
 */
export function jobActionChipStyle(tone: JobActionTone): CSSProperties {
  switch (tone) {
    case "info":
      return {
        background: "hsl(var(--info-tint) / 0.12)",
        color: "hsl(var(--info-ink))",
        border: "0.5px solid hsl(var(--info-tint) / 0.32)",
      };
    case "boost":
      return {
        background: "hsl(var(--boost-tint) / 0.14)",
        color: "hsl(var(--boost-ink))",
        border: "0.5px solid hsl(var(--boost-tint) / 0.34)",
      };
    case "edit":
      return {
        background: "hsl(var(--gold-warm) / 0.16)",
        color: "hsl(var(--amber-ink))",
        border: "0.5px solid hsl(var(--gold-warm) / 0.36)",
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
      // Demoted-primary: what a chip becomes when a bigger, full-width primary
      // ("Approve & release payment") has appeared above the row and Message is
      // no longer the main move. Same olivewood tint the "waiting" status pill
      // uses, so it reads as secondary without borrowing another action's hue.
      return {
        background: "hsl(var(--olivewood) / 0.08)",
        color: "hsl(var(--olivewood))",
        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
      };
    case "primary":
    default:
      return {
        background: "hsl(var(--bark))",
        backgroundImage: "none",
        color: "hsl(var(--parchment))",
        border: "0.5px solid hsl(var(--bark))",
        boxShadow: "var(--elev-bark-flat)",
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
  columns: 1 | 2 | 3 | 4;
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
