import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check } from "lucide-react";

/**
 * One row of a "pick a reason" list (withdrawing an application, declining an applicant): one shared control
 * instead of two copies (Q2709, OWN-SHARED). The selected row wears `btn-grad-primary` with a check, like every
 * selected control. A bare <button>, not the shared <Button>: button.tsx carries `whitespace-nowrap`, which would
 * stop a long reason wrapping and clip it at 320px; the global `button { min-height: 44px }` floor still applies.
 */
export const ReasonRow = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed" | "children" | "className"> & { pressed: boolean; label: ReactNode }
>(({ pressed, label, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-pressed={pressed}
    {...props}
    className={`w-full flex items-center gap-3 min-h-[3.5rem] px-3 py-2.5 rounded-ds-md text-left transition-all duration-150 ease-ds-spring active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${
      pressed
        ? "btn-grad-primary border border-[hsl(var(--bark))] shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_6px_hsl(var(--ink-deep)/0.12)]"
        : "bg-secondary/45 border border-border/60 hover:bg-secondary/70 hover:border-border shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
    }`}
  >
    {pressed && <Check className="w-[18px] h-[18px] shrink-0" style={{ color: "hsl(var(--parchment))" }} aria-hidden />}
    <span
      className="flex-1 min-w-0 whitespace-normal break-words font-sans font-semibold leading-snug text-ds-14"
      style={{ color: pressed ? "hsl(var(--parchment))" : "hsl(var(--ink-deep))" }}
    >
      {label}
    </span>
  </button>
));
ReasonRow.displayName = "ReasonRow";
