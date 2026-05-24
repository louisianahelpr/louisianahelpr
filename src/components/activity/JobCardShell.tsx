import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

interface JobCardShellProps {
  /** When false, the card is non-interactive (no expand-on-click, no keyboard role). */
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Extra classes appended to the shared `rounded-2xl liquid-glass …` base. */
  className?: string;
  children: ReactNode;
}

/**
 * Shared outer wrapper for activity job cards. Owns the "click/Enter/Space
 * to toggle expansion" affordance when `expandable` is true. The expansion
 * gating lives at the call site (e.g. only fully-completed posted jobs, or
 * only non-minimal applied cards).
 */
export function JobCardShell({
  expandable,
  expanded,
  onToggle,
  className,
  children,
}: JobCardShellProps) {
  const interactiveClass = expandable
    ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    : "";
  return (
    <div
      className={`rounded-2xl liquid-glass overflow-hidden hover:shadow-md transition-all duration-200 ${interactiveClass} ${className ?? ""}`.trim()}
      onClick={expandable ? onToggle : undefined}
      {...(expandable && {
        role: "button",
        tabIndex: 0,
        "aria-expanded": expanded,
        onKeyDown: (e: ReactKeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        },
      })}
    >
      {children}
    </div>
  );
}
