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
  // TOP, not bottom (owner decision). Bottom-anchored toasts on a phone land
  // on top of the floating dock and whatever the user was just reading — the
  // "Face ID lock turned off." confirmation covered the Active-sessions row of
  // the very screen that produced it. A top banner is also the iOS convention
  // for transient system confirmations, so it reads as chrome rather than as
  // content that has appeared over your work.
  const [position, setPosition] = useState<"top-center" | "top-right">(() => {
    if (typeof window === "undefined") return "top-center";
    return window.matchMedia("(min-width: 768px)").matches ? "top-right" : "top-center";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 768px)");
    const update = () => setPosition(mql.matches ? "top-right" : "top-center");
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
      // Owner, 2026-08-25: "if a message pops up in the corner they need an x
      // to cancel it out before it fades". Error toasts in particular can sit
      // for seconds over the control that produced them, and until now the
      // only way to clear one was to wait or to swipe (undiscoverable on
      // desktop, where there is no swipe). Sonner renders the button itself;
      // it is styled below to match the toast rather than its default grey.
      closeButton
      // Clear the status bar / notch instead of the dock. These offsets were
      // bottom-anchored to lift the toast above the BottomNav; with the anchor
      // moved to the top they would have pinned it back down to the bottom
      // edge, so they move with it.
      mobileOffset={{ top: "calc(var(--safe-area-top, 0px) + 8px)" }}
      offset={{ top: "24px" }}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "group toast !rounded-2xl !border-0 !shadow-[0_1px_2px_hsl(var(--olivewood)/0.06),0_14px_30px_-8px_hsl(var(--olivewood)/0.20)] !text-[hsl(var(--ink-deep))] !font-serif !italic !text-ds-14 !leading-snug !backdrop-blur-[18px] !backdrop-saturate-[160%] before:absolute before:inset-0 before:rounded-2xl before:border before:border-[hsl(var(--olivewood)/0.12)] before:pointer-events-none",
          title: "!font-display !italic !font-bold !not-[font-serif] !text-ds-15 !leading-tight !text-[hsl(var(--ink-deep))]",
          description: "!font-serif !italic !text-ds-12 !text-[hsl(var(--olivewood)/0.8)]",
          actionButton:
            "!bg-[hsl(var(--bark))] !text-[hsl(var(--parchment))] !font-sans !font-semibold !rounded-full !px-3 !h-8",
          // Sonner's default puts this half-outside the top-LEFT corner
          // (translate(-35%,-35%)) — floating off the card rather than
          // reading as part of the message. Repinned inside the toast's own
          // top-right corner instead, sized to a real 24px target with brand
          // ink, and only fully opaque on hover/focus so it reads as chrome
          // rather than competing with the message.
          closeButton:
            "!left-auto !right-2 !top-2 ![transform:none] !bg-[hsl(var(--parchment))] !border !border-[hsl(var(--olivewood)/0.18)] !text-[hsl(var(--olivewood))] hover:!bg-[hsl(var(--parchment))] hover:!text-[hsl(var(--ink-deep))] hover:!border-[hsl(var(--olivewood)/0.35)] focus-visible:!ring-2 focus-visible:!ring-[hsl(var(--bark)/0.45)]",
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
