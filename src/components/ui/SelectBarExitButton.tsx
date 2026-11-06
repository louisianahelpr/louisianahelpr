import { forwardRef, type ButtonHTMLAttributes } from "react";
import { X } from "lucide-react";

/**
 * The ✕ that leaves select mode on the dark select bar (Q2709 "nothing hand-made", 2026-11-06): Posts'
 * BulkDismissBar ("Cancel selection") and the Messages list's select bar. Both were hand-made <button>s with exactly
 * these classes, this inline colour and this glyph; they are this now. Plain concatenation, not tailwind-merge, so
 * the rendered class SET is the hand-made one (lead 11-06: convert only what stays look-identical).
 *
 * The rest fill is a CLASS, not inline: an inline background beats the stylesheet, so the hover tint could never
 * paint. `.ctl-exit` (the one exit shape) and `.ctl-tint-invert` (the tone for chrome on a permanently dark
 * ground) are declared once in src/index.css. The caller passes onClick and aria-label.
 *
 * Guard: src/test/selectBarExitButtonShared.test.tsx.
 */
const SELECT_BAR_EXIT =
  "h-9 w-9 ctl-exit bg-[hsl(var(--parchment)/0.06)] ctl-tint-invert inline-flex items-center justify-center btn-press transition";

export const SelectBarExitButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children">>(
  ({ className = "", style, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      {...props}
      className={`${SELECT_BAR_EXIT} ${className}`.trim()}
      style={{ color: "hsl(var(--parchment) / 0.85)", ...style }}
    >
      <X className="w-4 h-4" />
    </button>
  ),
);
SelectBarExitButton.displayName = "SelectBarExitButton";
