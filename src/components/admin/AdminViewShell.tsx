import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The ONE admin view scaffold — extracted 2026-08-24 during the admin polish
 * wave (owner: "admin pages should also share shells", "a lot of admin pages
 * need to be organized"). Admin.tsx already owns the outer frame (top bar,
 * sidebar, `<main>` padding) and AdminSectionHeader owns the back+title row;
 * what every view improvised was the layer under those: section cards with
 * their own header treatments (the phone-width "title squeezed beside a pill
 * cluster" cramp on Dashboard was one hand-roll of it), filter strips, and
 * vertical rhythm. These three primitives are those patterns, lifted from the
 * views that already did them well (Users, Disputes) so adopting them is a
 * parity move, not a redesign.
 */

/** Vertical rhythm wrapper for a view's sections. */
export function AdminViewShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-5 sm:space-y-6", className)}>{children}</div>;
}

/**
 * The canonical admin section card. `title`/`subtitle` render the one shared
 * header treatment; `action` (range pills, an Add button, a count) sits beside
 * the title from `sm` up and drops to its own full-width row on phones — the
 * fix for the cramped two-column header the Dashboard cards shipped at 375.
 */
export function AdminCard({
  title,
  subtitle,
  action,
  children,
  className,
  contentClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4 sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {title && (
            <div className="min-w-0 space-y-0.5">
              {/* h2, not h3. Admin.tsx renders the page's only <h1> through
                  AdminSectionHeader, so every AdminCard title sitting at <h3>
                  skipped a level — axe flagged `heading-order` on 22 of the 24
                  admin views from this one line. The visual size is a token
                  (text-ds-16), independent of the level, so the fix is purely
                  structural: nothing moves, the outline just becomes h1 → h2. */}
              <h2 className="font-display font-semibold text-foreground text-ds-16">{title}</h2>
              {subtitle && <p className="text-ds-11 text-muted-foreground">{subtitle}</p>}
            </div>
          )}
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}

/**
 * A horizontally scrollable filter/tab strip with an edge fade, so a cut-off
 * chip reads as "scrolls" rather than "broken" (the Users tab row pattern).
 */
export function AdminFilterStrip({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      className={cn(
        "flex items-center gap-1.5 overflow-x-auto no-scrollbar",
        "[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
