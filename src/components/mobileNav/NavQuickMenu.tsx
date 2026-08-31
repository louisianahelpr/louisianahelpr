import { useEffect, useRef } from "react";
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Full-screen scrim — dismisses the menu on any outside tap.
              Sits below the menu (z-40) but above everything else on the
              page; the nav bar itself is z-50 so the menu (also z-50,
              nested inside the tab slot) still reads on top of it. */}
          <motion.div
            aria-hidden
            className="fixed inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.15 }}
            onClick={onClose}
          />
          <motion.div
            ref={menuRef}
            role="menu"
            aria-label={title}
            className="absolute bottom-full left-1/2 z-50 mb-3 w-56 -translate-x-1/2 overflow-hidden rounded-2xl"
            style={{
              backgroundColor: "var(--nav-pill-bg)",
              backdropFilter: "blur(40px) saturate(180%)",
              WebkitBackdropFilter: "blur(40px) saturate(180%)",
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
