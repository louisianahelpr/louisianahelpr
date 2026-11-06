import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * One option row of a small filter / sort popover menu (Q2709 "nothing hand-made", Profile packet, 2026-11-06):
 * Saved Helprs' category filter and sort menus and the Schedule tab's upcoming filter. Those were hand-made
 * <button aria-pressed>s with exactly these classes; they are this now. Plain concatenation, not tailwind-merge, so
 * the rendered class SET is the hand-made one (lead 11-06: convert only what stays look-identical). The selected
 * row wears the shared primary surface (btn-grad-primary, toggled in JS, never a Tailwind variant over it).
 *
 * Guard: src/test/popoverOptionButtonShared.test.tsx.
 */
const OPTION = "w-full text-left px-2.5 h-9 rounded-md text-ds-13 font-sans font-medium transition-colors";
const OPTION_ON = "btn-grad-primary text-[hsl(var(--parchment))]";
const OPTION_OFF = "text-foreground hover:bg-secondary/70";

export const PopoverOptionButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed" | "className"> & { selected: boolean }
>(({ selected, ...props }, ref) => (
  <button ref={ref} type="button" aria-pressed={selected} {...props} className={`${OPTION} ${selected ? OPTION_ON : OPTION_OFF}`} />
));
PopoverOptionButton.displayName = "PopoverOptionButton";
