import { useEffect, useState } from "react";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Brand-aligned toast styling — translucent parchment surface with
// olivewood hairline border, font-serif italic body, and stage-tinted
// icon colors (bark for success, sienna for error/warning).
// The app is light-only (dark mode was removed), so the toaster is
// hardcoded to the light theme.
//
// Layout / placement:
//   - On phones (md:↓) we anchor toasts to `bottom-center` so they don't
//     sit under the system status bar / dynamic island, and so the
//     stacked-toast expansion grows UP toward the top of the screen
//     instead of overlapping the bottom dock. On md+ we fall back to
//     `bottom-right` (the classic desktop placement).
//   - `mobileOffset` lifts the toast above the floating dock (which sits at
//     `bottom-0` with a ~80px footprint after safe-area), so the toast and
//     the dock don't fight for the same pixels.
//   - `visibleToasts={3}` collapses anything past the 3rd into the
//     accordion stack — useful when a flurry of errors fires (network
//     hiccup → 6 simultaneous query failures shouldn't bury the UI).
//
// Accessibility:
//   - Sonner sets `role="status"` + `aria-live="polite"` on the live region
//     by default (see sonner source), so we don't need to override.
//   - For error toasts we want a stronger announcement; Sonner's
//     `richColors` would tint them, but we already brand-style errors via
//     `classNames.error` above. Leaving the default polite role is the
//     right call — assistive tech will still announce the title + body.
const Toaster = ({ ...props }: ToasterProps) => {
  // Sonner accepts a single `position` prop; we pick the right anchor on
  // mount based on viewport width so phones get bottom-center and
  // wider viewports keep the desktop bottom-right placement. A resize
  // listener flips the anchor live so a rotation/orientation change is
  // handled cleanly.
  const [position, setPosition] = useState<"bottom-center" | "bottom-right">(() => {
    if (typeof window === "undefined") return "bottom-center";
    return window.matchMedia("(min-width: 768px)").matches ? "bottom-right" : "bottom-center";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 768px)");
    const update = () => setPosition(mql.matches ? "bottom-right" : "bottom-center");
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);

  return (
    <Sonner
      theme="light"
      className="toaster group"
      position={position}
      visibleToasts={3}
      // Lift the toast above the dock on phones and the safe-area inset on
      // notched devices so it never sits under the BottomNav or home
      // indicator. ~96px matches the dock clearance reserved by AppShell.
      mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}
      offset={{ bottom: "24px" }}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "group toast !rounded-2xl !border-0 !shadow-[0_1px_2px_hsl(var(--olivewood)/0.06),0_14px_30px_-8px_hsl(var(--olivewood)/0.20)] !text-[hsl(var(--ink-deep))] !font-serif !italic !text-ds-14 !leading-snug !backdrop-blur-[18px] !backdrop-saturate-[160%] before:absolute before:inset-0 before:rounded-2xl before:border before:border-[hsl(var(--olivewood)/0.12)] before:pointer-events-none",
          title: "!font-display !italic !font-bold !not-[font-serif] !text-ds-15 !leading-tight !text-[hsl(var(--ink-deep))]",
          description: "!font-serif !italic !text-ds-12 !text-[hsl(var(--olivewood)/0.8)]",
          actionButton:
            "!bg-[hsl(var(--bark))] !text-[hsl(var(--parchment))] !font-sans !font-semibold !rounded-full !px-3 !h-8",
          cancelButton:
            "!bg-transparent !text-[hsl(var(--olivewood)/0.8)] !font-sans !font-semibold !rounded-full !px-3 !h-8",
          success: "!bg-[hsl(var(--parchment)/0.96)] [&_[data-icon]]:!text-[hsl(var(--bark))]",
          error: "!bg-[hsl(var(--parchment)/0.96)] [&_[data-icon]]:!text-[hsl(var(--burnt-sienna))]",
          warning: "!bg-[hsl(var(--parchment)/0.96)] [&_[data-icon]]:!text-[hsl(var(--amber-ink))]",
          info: "!bg-[hsl(var(--parchment)/0.96)] [&_[data-icon]]:!text-[hsl(var(--bark))]",
          default: "!bg-[hsl(var(--parchment)/0.96)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
