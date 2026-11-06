import { forwardRef, type InputHTMLAttributes } from "react";

/**
 * The small native radio circle inside a 44px <label> row (Q2709 "nothing hand-made", Declutter packet,
 * 2026-11-06): Declutter's "How you'll get it" (free claim, buy), meet-up spot, porch place and "What's stopping
 * you?" lists. Those were hand-made <input type="radio">s with exactly this class set and the olive accent; they are
 * this now. Plain concatenation, not tailwind-merge, so the rendered class SET is the hand-made one (lead 11-06:
 * convert only what stays look-identical). The caller passes only its row offset (`mt-1`) and its own handlers.
 *
 * `min-h-0 min-w-0`: index.css gives every input[type=radio] a 44px floor; without them the browser draws a 44px
 * circle (src/test/nativeCheckboxNotInflated.test.ts reads the literal below, so it stays inline on the tag).
 *
 * Guard: src/test/nativeRadioShared.test.tsx.
 */
export const NativeRadio = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  ({ className = "", style, ...props }, ref) => (
    <input ref={ref} type="radio" className={`h-4 w-4 min-h-0 min-w-0 shrink-0 ${className}`.trim()} style={{ accentColor: "hsl(var(--primary))", ...style }} {...props} />
  ),
);
NativeRadio.displayName = "NativeRadio";
