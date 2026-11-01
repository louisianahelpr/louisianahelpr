import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * A text-sized button that reads INSIDE a sentence ("… How it works"): no pill, no 44px box, so a paragraph keeps
 * its line height. Its tap target is the shared touch overlay of `.link-standard` (index.css). For anything that is
 * not a word in running text, use `Button`.
 */
export const InlineTextButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className = "", type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={`link-standard min-h-0 min-w-0 p-0 align-baseline ${className}`.trim()} {...props} />
  ),
);
InlineTextButton.displayName = "InlineTextButton";
