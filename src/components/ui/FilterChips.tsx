import { useEffect, useRef, useState } from "react";

/**
 * THE INBOX'S ONE FILTER CONTROL (M6, iOS design audit 11-16): a row of pill chips, one pressed (aria-pressed), All
 * first. Messages' section chips (All, Unread, Jobs, Declutter...; board 13, owner 2026-10-20) moved here unchanged,
 * and the Notifications tab now uses the same row (All, Unread) instead of a segmented control in the reverse order.
 *
 * The look is `.chip-row` (index.css). #3 (Declutter walk 2026-10-28): the right edge fades only when the row really
 * continues past it (data-more), and the desktop website wraps the chips (index.css).
 */
export function FilterChips<T extends string>({ chips, value, onChange, label, testId, chipAttr }: {
  chips: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** The group's accessible name. */
  label: string;
  testId?: string;
  /** The data attribute each chip carries with its value (Messages: data-inbox-chip). */
  chipAttr: `data-${string}`;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const chipCount = chips.length;
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () => setMore(row.scrollWidth - row.clientWidth - row.scrollLeft > 2);
    update();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(row);
    row.addEventListener("scroll", update, { passive: true });
    return () => {
      ro?.disconnect();
      row.removeEventListener("scroll", update);
    };
  }, [chipCount]);
  return (
    <div ref={rowRef} className="chip-row" data-more={more ? "" : undefined} role="group" aria-label={label} data-testid={testId}>
      {chips.map((c) => (
        <button key={c.value} type="button" {...{ [chipAttr]: c.value }} aria-pressed={value === c.value} onClick={() => onChange(c.value)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}
