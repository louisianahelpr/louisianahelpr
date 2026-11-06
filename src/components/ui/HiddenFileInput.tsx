import { forwardRef, type InputHTMLAttributes } from "react";

/**
 * The visually hidden file picker a real button, tile or <label> opens (Q2709 "nothing hand-made", Declutter
 * packet, 2026-11-06): Declutter's Sell / bunch / wanted / problem / handover / return photo pickers were hand-made
 * <input type="file" className="sr-only"> (or "peer sr-only" when a sibling label draws its focus ring); they are
 * this now. Nothing visible changes: the class SET is the hand-made one.
 *
 * No className prop on purpose: the input is ALWAYS sr-only (visually hidden, still focusable), never `hidden`
 * (display:none drops it from the tab order: src/test/fileInputsKeyboardReachable.test.ts) and never a visible
 * browser picker (src/test/noRawFilePicker.test.tsx). `peer` keeps a following label's peer-focus-visible ring.
 *
 * Guard: src/test/hiddenFileInputShared.test.tsx.
 */
export const HiddenFileInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "style"> & { peer?: boolean }
>(({ peer = false, ...props }, ref) => <input ref={ref} type="file" className={peer ? "peer sr-only" : "sr-only"} {...props} />);
HiddenFileInput.displayName = "HiddenFileInput";
