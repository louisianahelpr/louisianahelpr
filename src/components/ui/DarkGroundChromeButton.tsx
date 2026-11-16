import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * A chrome button on a permanently dark ground (the document viewer's bottom bar: zoom out, zoom in, Download, Open in
 * new tab), the action twin of DarkGroundCloseButton (OWN-SHARED, owner 10-31: "Nothing hand-made"). Same frosted
 * fill (`bg-white/[0.12]`) and the same dark-ground hover tone (`.ctl-tint-invert`, src/index.css); the press is the
 * app's one press (0.97) and the ring the global focus ring. A 44px target at least (`min-h-11 min-w-11`, the HIG
 * floor). `label` is always the accessible name; `showLabel` also prints it beside the icon. The rest fill is a class,
 * never an inline colour, so the hover tint can land (the bug DarkGroundCloseButton's copies once had).
 * Guard: src/test/documentViewerLeaveFailures.test.tsx.
 */
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children" | "aria-label"> & {
  icon: LucideIcon;
  label: string;
  showLabel?: boolean;
};

export const DarkGroundChromeButton = forwardRef<HTMLButtonElement, Props>(
  ({ icon: Icon, label, showLabel = false, className = "", ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      {...props}
      className={`min-h-11 min-w-11 ${showLabel ? "px-3" : "px-0"} inline-flex items-center justify-center gap-1.5 rounded-ds-md bg-white/[0.12] ctl-tint-invert text-white font-sans text-ds-13 font-medium active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-40 disabled:pointer-events-none ${className}`.trim()}
    >
      <Icon className="w-4 h-4" aria-hidden />
      {showLabel ? <span>{label}</span> : null}
    </button>
  ),
);
DarkGroundChromeButton.displayName = "DarkGroundChromeButton";
