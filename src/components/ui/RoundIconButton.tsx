import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * A round, solid-filled icon button with a press shrink (Q2709 "nothing hand-made", Messages packet, 2026-11-06):
 * the voice-note controls. The recorder's Discard / Stop / Send (RichMessageInput, 44px) and the player's Play /
 * Pause (MessageAttachment, 36px) were hand-made <button>s with exactly these classes; they are this now. Plain
 * concatenation, not tailwind-merge, so the rendered class SET is the hand-made one (lead 11-06: convert only what
 * stays look-identical). The fill and ink stay the caller's inline `style` (each control has its own colour).
 *
 * Not Button size="icon"/"iconCompact": those bring the pill base's ring, tracking, transition list and elevation,
 * which would change the look.
 *
 * Guard: src/test/roundIconButtonShared.test.tsx.
 */
const ROUND_ICON = "shrink-0 rounded-full flex items-center justify-center transition-all active:scale-90";
const SIZES = { md: "w-11 h-11", sm: "w-9 h-9" } as const;

export const RoundIconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { size?: keyof typeof SIZES }
>(({ size = "md", className = "", ...props }, ref) => (
  <button ref={ref} type="button" {...props} className={`${ROUND_ICON} ${SIZES[size]} ${className}`.trim()} />
));
RoundIconButton.displayName = "RoundIconButton";
