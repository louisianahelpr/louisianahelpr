import { ReactNode, CSSProperties, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface AppShellProps {
  /** Optional fixed header (back button + title, tabs, etc.) */
  header?: ReactNode;
  /** When true (default), the inner content area scrolls vertically. Set false for fit-to-screen pages. */
  scrollable?: boolean;
  /** When true, reserves space at the bottom for the floating MobileNav dock + FAB (default: true). */
  reserveBottomNav?: boolean;
  /** Extra classes for the inner scroll container. */
  contentClassName?: string;
  /** Extra inline styles for the inner scroll container. */
  contentStyle?: CSSProperties;
  /** Extra classes for the outer shell container. */
  className?: string;
  children: ReactNode;
}

/**
 * Global app shell — locks the viewport to 100dvh, pins the optional header at the
 * top, and provides an internal scroll box between the header and the floating
 * bottom navigation. The MobileNav remains mounted at the App root so it never
 * remounts between routes (no flicker).
 *
 * Public marketing pages (Index, Heroes, ForBusiness, Features, legal) intentionally
 * do NOT use this shell — they use normal document scroll for SEO and long-form content.
 */
const AppShell = forwardRef<HTMLDivElement, AppShellProps>(
  (
    {
      header,
      scrollable = true,
      reserveBottomNav = true,
      contentClassName,
      contentStyle,
      className,
      children,
    },
    ref,
  ) => {
    const bottomPad = reserveBottomNav
      ? "calc(env(safe-area-inset-bottom, 0px) + 96px)"
      : "env(safe-area-inset-bottom, 0px)";

    return (
      <div
        className={cn(
          "fixed inset-0 flex flex-col bg-background overflow-hidden",
          className,
        )}
        style={{ height: "100dvh" }}
      >
        {header ? (
          <div
            className="shrink-0 z-30"
            style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
          >
            {header}
          </div>
        ) : null}

        <div
          ref={ref}
          className={cn(
            // flex flex-col so child <main>'s `flex-1 min-h-0` actually
            // resolves to a definite height. Without this the height
            // chain stops here and downstream `h-full` / `overflow-y-auto`
            // containers can't establish a scrollable viewport, which is
            // why non-landing Profile tabs (Schedule / Reviews /
            // Availability / Saved Helprs) appeared frozen — there was
            // overflow but no scroll surface to handle it.
            "flex-1 min-h-0 flex flex-col",
            scrollable ? "overflow-y-auto no-scrollbar" : "overflow-hidden",
            contentClassName,
          )}
          style={{
            paddingBottom: scrollable ? bottomPad : undefined,
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            ...contentStyle,
          }}
        >
          {children}
        </div>
      </div>
    );
  },
);
AppShell.displayName = "AppShell";

export default AppShell;
