import { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { hapticLight } from "@/lib/haptics";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Tab } from "@/components/activity/activityConstants";
import type { Bucket } from "./activityFilters";

/**
 * ActivitySectionedView — the grouped/collapsible Active · Completed ·
 * Cancelled view shown when the page's status filter is "all".
 *
 * The component is generic over the item type: the caller passes a
 * `bucketize` function that classifies each item into one of three
 * buckets, plus a `renderItem` callback that paints a single row. This
 * keeps the section shell tab-agnostic so PostedJobsTab and
 * AppliedJobsTab can both reuse it without leaking each other's prop
 * trees in here.
 *
 * Open/closed state per section is persisted in sessionStorage keyed by
 * tab, so the user's last collapse choice survives within the session
 * (but resets fresh per app launch). Active defaults to open;
 * Completed and Cancelled default to closed so the visual default
 * mirrors the user's likely intent ("here's what needs my attention").
 */

export type SectionKey = Bucket; // "active" | "completed" | "cancelled"

interface SectionedActivityViewProps<TItem> {
  tab: Tab;
  items: TItem[];
  getKey: (item: TItem) => string;
  bucketize: (item: TItem) => SectionKey;
  renderItem: (item: TItem) => React.ReactNode;
  /** Label overrides — defaults to "Active" / "Completed" / "Cancelled".
   *  Applied tab uses "Closed" instead of "Cancelled" to read as the
   *  helper-side bucket (rejected applications + cancelled jobs). */
  labels?: Partial<Record<SectionKey, string>>;
}

const DEFAULT_LABELS: Record<SectionKey, string> = {
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

const SECTION_ORDER: SectionKey[] = ["active", "completed", "cancelled"];

// Default open state — Active is the user's primary focus, so it
// opens fresh; the other two start collapsed to keep the view tidy.
const DEFAULT_OPEN: Record<SectionKey, boolean> = {
  active: true,
  completed: false,
  cancelled: false,
};

function readPersistedOpen(tab: Tab): Record<SectionKey, boolean> {
  if (typeof window === "undefined") return { ...DEFAULT_OPEN };
  try {
    const raw = sessionStorage.getItem(`activity:sections:${tab}`);
    if (!raw) return { ...DEFAULT_OPEN };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      active: typeof parsed.active === "boolean" ? parsed.active : DEFAULT_OPEN.active,
      completed: typeof parsed.completed === "boolean" ? parsed.completed : DEFAULT_OPEN.completed,
      cancelled: typeof parsed.cancelled === "boolean" ? parsed.cancelled : DEFAULT_OPEN.cancelled,
    };
  } catch {
    return { ...DEFAULT_OPEN };
  }
}

export function ActivitySectionedView<TItem>({
  tab,
  items,
  getKey,
  bucketize,
  renderItem,
  labels,
}: SectionedActivityViewProps<TItem>) {
  const [openState, setOpenState] = useState<Record<SectionKey, boolean>>(() =>
    readPersistedOpen(tab),
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(`activity:sections:${tab}`, JSON.stringify(openState));
    } catch {
      /* private mode / quota — ignore */
    }
  }, [openState, tab]);

  const sectionLabels = useMemo(
    () => ({ ...DEFAULT_LABELS, ...(labels ?? {}) }),
    [labels],
  );

  const grouped = useMemo(() => {
    const acc: Record<SectionKey, TItem[]> = { active: [], completed: [], cancelled: [] };
    for (const item of items) {
      acc[bucketize(item)].push(item);
    }
    return acc;
  }, [items, bucketize]);

  const toggle = useCallback((key: SectionKey) => {
    hapticLight();
    setOpenState((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="space-y-3">
      {SECTION_ORDER.map((key) => {
        const bucketItems = grouped[key];
        const count = bucketItems.length;
        // Empty buckets render as a muted "Nothing here" row so the
        // user still sees the section structure but understands the
        // bucket has no items. Cheaper than hiding because it keeps the
        // three-section rhythm consistent regardless of state.
        const isOpen = openState[key];
        return (
          <Collapsible
            key={key}
            open={isOpen}
            onOpenChange={() => toggle(key)}
          >
            <CollapsibleTrigger
              asChild
              aria-label={`Toggle ${sectionLabels[key]} section`}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 rounded-ds-md transition active:scale-[0.99]"
                style={{
                  background: "hsl(var(--olivewood) / 0.05)",
                  border: "1px solid hsl(var(--olivewood) / 0.1)",
                }}
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span
                    className="shrink-0 w-2 h-2 rounded-full"
                    style={{
                      background:
                        key === "active"
                          ? "hsl(var(--burnt-sienna))"
                          : key === "completed"
                            ? "hsl(var(--bark))"
                            : "hsl(var(--destructive))",
                    }}
                    aria-hidden="true"
                  />
                  <span
                    className="font-serif italic uppercase truncate text-ds-11"
                    style={{
                      letterSpacing: "0.18em",
                      color: "hsl(var(--ink-deep))",
                    }}
                  >
                    {sectionLabels[key]}
                  </span>
                  {count > 0 && (
                    <span
                      className="text-ds-10 tabular-nums font-semibold shrink-0 px-2 py-[2px] rounded-ds-pill leading-none min-h-[18px] inline-flex items-center"
                      style={{
                        background: "hsl(var(--olivewood) / 0.10)",
                        color: "hsl(var(--olivewood) / 0.85)",
                      }}
                    >
                      {count}
                    </span>
                  )}
                </span>
                <ChevronDown
                  className="w-4 h-4 shrink-0 transition-transform"
                  style={{
                    color: "hsl(var(--olivewood) / 0.8)",
                    transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                  }}
                  aria-hidden="true"
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pt-3">
                {count === 0 ? (
                  <p
                    className="text-ds-12 px-3 py-4 text-center font-serif italic"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    Nothing in {sectionLabels[key].toLowerCase()} yet.
                  </p>
                ) : (
                  // Single column on phones / native (the primary target).
                  // Only the wide *browser* desktop (html.web-desktop, never
                  // the native shell — see useAppShellViewport) splits these
                  // into two columns; on phone width the cards otherwise
                  // stretch to ~900px and read half-empty. The grid + its
                  // space-y reset live in index.css under `.ds-activity-grid`.
                  <div className="space-y-3 ds-activity-grid">
                    {bucketItems.map((item) => (
                      <div key={getKey(item)}>{renderItem(item)}</div>
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
