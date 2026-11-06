import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * The small ✕ inside a search field's right edge (Q2709 "nothing hand-made", Admin packet, 2026-11-06): the
 * admin search fields' "Clear search" (command palette, notification logs, referrals, users, the settings user
 * search). Those were hand-made <button>s with exactly these classes; they are this now. Plain concatenation, not
 * tailwind-merge, so the rendered class SET is the hand-made one (lead 11-06: convert only what stays
 * look-identical). The caller passes the inset (`right-1.5`) and the glyph as children, and keeps its own
 * handlers (the admin ones keep focus on press so iOS does not drop the keyboard).
 *
 * `!min-h-0 !min-w-0`: index.css's 44px floor for `button` would otherwise win over h-7 w-7 and spill a 44px hit
 * box past a 36px field.
 *
 * Guard: src/test/fieldClearButtonShared.test.tsx.
 */
const FIELD_CLEAR =
  "absolute top-1/2 -translate-y-1/2 !min-h-0 !min-w-0 h-7 w-7 ctl-exit inline-flex items-center justify-center text-muted-foreground hover:text-foreground ctl-tint btn-press transition";

export const FieldClearButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">>(
  ({ className = "", ...props }, ref) => (
    <button ref={ref} type="button" {...props} className={`${FIELD_CLEAR} ${className}`.trim()} />
  ),
);
FieldClearButton.displayName = "FieldClearButton";
