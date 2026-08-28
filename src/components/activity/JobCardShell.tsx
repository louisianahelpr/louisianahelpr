import { type ReactNode } from "react";
import { categoryColors } from "./activityConstants";

interface JobCardShellProps {
  /** When false, the card is non-interactive (no expand-on-click, no keyboard role). */
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Extra classes appended to the shared `rounded-2xl liquid-glass …` base. */
  className?: string;
  /**
   * Job category, e.g. "cleaning". Paints the left colour rail — the same
   * `categoryColors[…].dot` stripe Browse's JobCard uses, so one job reads
   * with one colour wherever it appears. Omit (or pass an unknown category)
   * and the rail falls back to the shared "other" colour.
   */
  category?: string | null;
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
  category,
  children,
}: JobCardShellProps) {
  const railClass = (categoryColors[category ?? ""] ?? categoryColors.other).dot;
  const interactiveClass = expandable
    ? "cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-primary"
    : "";
  return (
    <div
      className={`relative rounded-2xl liquid-glass overflow-hidden hover:shadow-md transition-all duration-200 ${interactiveClass} ${className ?? ""}`.trim()}
      onClick={expandable ? onToggle : undefined}
    >
      {/* Category rail — the full-height colour stripe down the left edge,
          identical in width and colour to Browse's JobCard rail so My Posts /
          My Jobs and the feed agree about what colour a job is. It sits inside
          the existing `overflow-hidden rounded-2xl` clip, so it takes the
          card's rounded corners; `relative` was added above to anchor it.
          Purely decorative, hence aria-hidden — the category is announced by
          the text chip in JobCardTitleBar, not by this. The card body is
          padded px-4 (16px) against this 6px rail, so nothing shifts. */}
      <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1.5 z-10 ${railClass}`} />
      {/*
        The keyboard affordance is a real (screen-reader-only) <button>, not
        role="button" on this wrapper. As a wrapper role it made every card a
        widget CONTAINING the card's own controls (Message, View, …) — axe's
        nested-interactive, and a real trap: a screen reader announced the
        whole card as one button, so the controls inside it were not reachable
        as the separate controls they are, and Space/Enter on any of them raced
        the wrapper's own key handler.

        Pointer behaviour is untouched — the wrapper keeps its onClick, so a
        click anywhere on the card still toggles exactly as before, and the
        inner controls still stop propagation as they always did.

        The ring moved from focus-visible on the wrapper to focus-within, so
        focusing this button paints the identical ring around the identical
        box. Nothing moves: the button is sr-only, and an earlier attempt that
        stretched it across the card with pointer-events-none broke six specs
        by swallowing clicks meant for real controls.
      */}
      {expandable && (
        <button
          type="button"
          className="sr-only"
          aria-expanded={expanded}
          onClick={(e) => {
            // Without this the wrapper's onClick fires too and toggles twice,
            // returning the card to the state it started in.
            e.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? "Collapse Job Details" : "Expand Job Details"}
        </button>
      )}
      {children}
    </div>
  );
}
