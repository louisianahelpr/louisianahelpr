import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * The round 40px card-coloured arrow at the end of a sideways row, for a mouse (Declutter's category chips on the
 * desktop website: "Earlier categories" / "More categories"). It was a pair of hand-made <button>s with exactly this
 * class set (UI audit 11-09, Q2709 "nothing hand-made"); plain concatenation, not tailwind-merge, so the rendered
 * class SET is the hand-made one. The caller passes the label, the glyph and onClick.
 *
 * Not Button size="icon": that brings the pill base's type, transition list and offset ring, which changes the look.
 * Guard: src/test/declutterSharedControls.test.tsx.
 */
export const ROW_NUDGE =
  "pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const RowNudgeButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className"> & { "aria-label": string }>(
  (props, ref) => <button ref={ref} type="button" {...props} className={ROW_NUDGE} />,
);
RowNudgeButton.displayName = "RowNudgeButton";
