import { useCallback, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { hapticLight } from "@/lib/haptics";
import { BROWSE } from "./sectionsConfig";

export interface SectionTabDef<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * The section's tab, read from `?tab=`. EVERY SECTION OPENS ON BROWSE (owner,
 * 2026-10-19): no tab, or an unknown one, is Browse. Changing tab drops the
 * other tab's `?status=` filter so a stale filter never hides a list.
 */
export function useSectionTab<T extends string>(valid: readonly T[]) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = (raw && (valid as readonly string[]).includes(raw) ? raw : BROWSE) as T | typeof BROWSE;
  const setTab = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === BROWSE) p.delete("tab");
          else p.set("tab", next);
          p.delete("status");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [tab, setTab] as const;
}

/**
 * The section's tabs (Browse | Posted | Working ...). BROWSE IS ALWAYS LEFTMOST: it is not a prop, so no caller can
 * move it (guard: src/test/sectionDashboards.test.tsx).
 *
 * THIN UNDERLINE TABS (owner, 2026-10-22, the Explore header): the section chips above are the one filled control,
 * so these are words with a 2px olive underline under the selected one, not a second pill track. Still 44px tall
 * (the tap floor), the visual weight is what got smaller. Arrow keys move between tabs (automatic activation, the
 * panels are cheap to swap), one tab stop for the row (roving tabindex), as SegmentedControl did.
 */
export function SectionTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  end,
  browseCount,
}: {
  label: string;
  tabs: readonly SectionTabDef<T>[];
  value: T | typeof BROWSE;
  onChange: (v: string) => void;
  /** A control at the row's right end (Jobs settings' gear on a phone). */
  end?: ReactNode;
  /** How many results Browse lists, shown quietly beside its label (owner 2026-10-28: "move the 1 next to browse"). */
  browseCount?: number;
}) {
  const options = [{ value: BROWSE as string, label: "Browse" }, ...tabs.map((t) => ({ value: t.value as string, label: t.label, count: t.count }))] as Array<{ value: string; label: string; count?: number; quiet?: number }>;
  options[0].quiet = browseCount;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const at = options.findIndex((o) => o.value === value);
    let next = -1;
    if (step) next = (at + step + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    if (options[next].value !== value) { hapticLight(); onChange(options[next].value); }
    refs.current[next]?.focus();
  };
  return (
    <div data-testid="section-tabs" className="flex items-end gap-1 border-b border-border/60">
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex min-w-0 flex-1 items-end gap-5 overflow-x-auto no-scrollbar">
        {options.map((o, i) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              data-section-tab={o.value}
              onClick={() => { if (!active) { hapticLight(); onChange(o.value); } }}
              className={cn(
                "section-tab relative inline-flex h-11 min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap font-sans text-ds-15 font-semibold",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bark))] rounded-sm",
                active ? "text-foreground section-tab-selected" : "text-muted-foreground",
              )}
            >
              {o.label}
              {o.quiet !== undefined && (
                <span data-testid="browse-count" className="tabular-nums text-ds-13 font-medium text-muted-foreground">{o.quiet}</span>
              )}
              {o.count !== undefined && o.count > 0 && (
                <span className="segmented-count-attention tabular-nums text-ds-11 font-bold rounded-full px-1.5 min-w-[1.25rem] leading-5 text-center">{o.count}</span>
              )}
            </button>
          );
        })}
      </div>
      {end}
    </div>
  );
}
