import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * The tiny tap-to-reveal read receipt at the end of a message's meta row ("✓ Delivered", the reader's avatar +
 * "Read 12:00 PM"). Q2709 "nothing hand-made", Messages packet, 2026-11-06: ChatPresence's two receipt buttons were
 * hand-made <button>s with exactly this class set; they are this now. Plain concatenation, so the rendered class SET
 * is the hand-made one (lead 11-06: convert only what stays look-identical). `pressed` is aria-pressed (shown or not).
 *
 * `-my-[14px]`: the global 44px button floor (index.css) would otherwise make the compact meta row 16px taller; the
 * negative margins absorb it while the hit box keeps the floor (44 - 28 = 16).
 *
 * Guard: src/test/receiptToggleButtonShared.test.tsx.
 */
const RECEIPT_TOGGLE = "relative inline-flex items-center gap-1 ml-1 -my-[14px]";

export const ReceiptToggleButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className" | "aria-pressed"> & { pressed: boolean }
>(({ pressed, ...props }, ref) => <button ref={ref} type="button" aria-pressed={pressed} {...props} className={RECEIPT_TOGGLE} />);
ReceiptToggleButton.displayName = "ReceiptToggleButton";
