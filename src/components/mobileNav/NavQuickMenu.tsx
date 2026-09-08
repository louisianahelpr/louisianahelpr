import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/lib/accessibility";

/**
 * Small anchored popover shown above a bottom-nav tab on long-press —
 * quick filters for Posts, recent conversations for Messages. Positioned
 * relative to the tab's own wrapping `<div className="relative">` in
 * MobileNav (each tab slot is `position: relative`), so this only needs
 * `absolute bottom-full`, not a portal or measured coordinates.
 *
 * Dismisses on: tapping a row (caller's responsibility, via onClose in the
 * row's own onClick), tapping the scrim, or Escape.
 */
export function NavQuickMenu({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const menuRef = useRef<HTMLDivElement>(null);

  // How far (px) the panel has to slide sideways so it stays on screen.
  //
  // The panel is centred on its tab, and the Posts tab sits close enough to
  // the left edge that a 224px panel centred on it starts at x≈-13; the
  // Messages tab is close enough to the right edge that its panel ended at
  // x≈430 in a 375px viewport (measured 2026-09-07, 55px clipped, the row
  // labels cut mid-word). Centred-then-clamped: measure once the panel has
  // laid out, and shift it by exactly the overhang plus a 12px margin.
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) { setShift(0); return; }
    const el = menuRef.current;
    if (!el) return;
    // Measure from the ANCHOR (the tab slot), not from the panel: the panel
    // is mid-scale-in on its first frame, so its own rect under-reports the
    // overhang (measured 3px left instead of 12 when read off the panel).
    const anchor = el.parentElement?.getBoundingClientRect();
    if (!anchor) return;
    const half = el.offsetWidth / 2;
    const centre = anchor.left + anchor.width / 2;
    const margin = 12;
    const left = centre - half;
    const right = centre + half;
    let next = 0;
    if (left < margin) next = margin - left;
    else if (right > window.innerWidth - margin) next = window.innerWidth - margin - right;
    if (Math.round(next) !== Math.round(shift)) setShift(next);
     
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Keyboard: a menu that opens without taking focus is invisible to Tab —
  // measured 2026-09-07, Tab from an open quick menu walked the page BEHIND
  // it (nav tabs, then the header) and never entered the rows. Move focus to
  // the first row on open, keep Tab/Shift+Tab and the arrow keys inside the
  // menu while it is open, and hand focus back to whatever had it on close.
  useEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(el.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    (items()[0] ?? el).focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      if (!list.length) {
        if (e.key === "Tab") { e.preventDefault(); el.focus(); }
        return;
      }
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Tab") {
        e.preventDefault();
        const n = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
        list[n].focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(i + 1) % list.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(i - 1 + list.length) % list.length].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo?.focus?.({ preventScroll: true });
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Full-screen scrim — dismisses the menu on any outside tap.
              Sits below the menu (z-40) but above everything else on the
              page; the nav bar itself is z-50 so the menu (also z-50,
              nested inside the tab slot) still reads on top of it.

              PORTALLED TO <body>, unlike the menu beside it. `position: fixed`
              resolves against the viewport only while no ancestor establishes
              a containing block, and the dock supplies two: the <nav> carries
              an unconditional inline `transform: translateY(0)` (it animates
              itself off-screen on scroll — MobileNav.tsx), and the pill inside
              it carries `backdrop-filter: blur(40px) saturate(180%)`. Rendered
              in place, `inset-0` therefore sized this "full-screen" scrim to
              the DOCK: measured 369x56 at (12, 790) in a 393x852 viewport —
              6.6% of the screen height. Everything above the dock was not
              covered, so tapping the page to dismiss did nothing and the menu
              could only be closed with Escape, a row, or a tap on the dock
              itself. The MENU stays where it is: it is anchored with
              `absolute bottom-full` to its tab slot on purpose, and that
              anchoring is the thing a portal would break. */}
          {createPortal(
            <motion.div
              aria-hidden
              className="fixed inset-0 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.15 }}
              onClick={onClose}
            />,
            document.body,
          )}
          <motion.div
            ref={menuRef}
            role="menu"
            tabIndex={-1}
            aria-label={title}
            // CENTRED WITH A MARGIN, NOT `-translate-x-1/2`. framer-motion
            // owns this element's inline `transform` (it animates scale and
            // y), and its final frame writes `transform: none` — which wipes
            // the Tailwind translate utility that used to centre the panel.
            // Measured 2026-09-07: computed transform `none`, panel left edge
            // sitting exactly on the tab's centre line. A negative margin of
            // half the width (w-56 = 224px → -7rem, inline below) is not a transform, so
            // framer cannot overwrite it. `shift` is the on-screen clamp above.
            className="absolute bottom-full left-1/2 z-50 mb-3 w-56 overflow-hidden rounded-2xl"
            style={{
              marginLeft: `calc(-7rem + ${shift}px)`,
              // OPAQUE, and deliberately not --nav-pill-bg + a blur.
              //
              // This panel is anchored `absolute bottom-full` inside the dock
              // pill (see the comment above — that anchoring is why it isn't
              // portalled), and the pill itself carries backdrop-filter. An
              // ancestor with backdrop-filter becomes the BACKDROP ROOT for its
              // descendants, so this panel's own blur sampled the
              // already-composited pill rather than the page: the frost did
              // nothing, and the 40%-alpha fill it was paired with left page
              // text readable straight through the menu rows in both themes.
              // Measured on /dashboard 2026-09-04 — panel and ancestor
              // div.flex-1.rounded-full both reported blur(40px) saturate(1.8).
              //
              // A surface that cannot blur must carry its own colour, so this
              // uses the opaque --nav-menu-bg (full white / dark pill hue).
              // Dropping the dead backdrop-filter also drops a real compositing
              // cost on the app's most animation-heavy surface.
              backgroundColor: "var(--nav-menu-bg)",
              border: "0.5px solid hsl(var(--bark) / 0.1)",
              boxShadow:
                "0 8px 18px -6px hsl(var(--bark) / 0.25), 0 22px 44px -10px hsl(var(--olivewood) / 0.22)",
            }}
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 8 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 420, damping: 32 }
            }
          >
            <p
              className="px-3.5 pt-3 pb-1.5 text-ds-11 font-semibold uppercase tracking-wide"
              style={{ color: "hsl(48 9% 47%)" }}
            >
              {title}
            </p>
            <div className="flex flex-col pb-1.5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** One tappable row inside a NavQuickMenu. */
export function NavQuickMenuItem({
  icon: Icon,
  label,
  sub,
  onSelect,
}: {
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  sub?: string;
  onSelect: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-2.5 px-3.5 py-2 text-left transition-colors active:bg-[hsl(var(--bark)/0.08)]"
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
          {label}
        </span>
        {sub && (
          <span className="block truncate text-ds-11" style={{ color: "hsl(48 9% 47%)" }}>
            {sub}
          </span>
        )}
      </span>
    </button>
  );
}
