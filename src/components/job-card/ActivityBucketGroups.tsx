import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { ActivityBucket } from "@/lib/activityBuckets";

// The words live in the leaf module so the browser specs read the same list (e2e/prod-audit/activity-tabs-visible).
import { POSTED_GROUP_LABEL, WORKING_GROUP_LABEL } from "@/lib/activityBuckets";
export { POSTED_GROUP_LABEL, WORKING_GROUP_LABEL };

const OPEN_GROUPS: ActivityBucket[] = ["needs_you", "waiting", "scheduled"];
const PREVIEW = 3;

/**
 * Jobs & Posts > Posted / Working with no status box chosen: the SAME cards
 * the lists always drew, grouped under a header per bucket (count + "See all"
 * when a group holds more than three). Done and Cancelled are terminal, so
 * they start as one summary row each and open on tap.
 */
export function ActivityBucketGroups<T>({
  items,
  getKey,
  bucketOf,
  renderItem,
  labels,
}: {
  items: T[];
  getKey: (item: T) => string;
  bucketOf: (item: T) => ActivityBucket;
  renderItem: (item: T) => ReactNode;
  labels: Record<ActivityBucket, string>;
}) {
  const groups = useMemo(() => {
    const acc: Record<ActivityBucket, T[]> = { needs_you: [], waiting: [], scheduled: [], done: [], cancelled: [] };
    for (const it of items) acc[bucketOf(it)].push(it);
    return acc;
  }, [items, bucketOf]);
  const [expanded, setExpanded] = useState<Partial<Record<ActivityBucket, boolean>>>({});
  const toggle = (b: ActivityBucket) => setExpanded((p) => ({ ...p, [b]: !p[b] }));

  return (
    <div className="flex flex-col gap-5" data-testid="activity-bucket-groups">
      {OPEN_GROUPS.map((b) => {
        const list = groups[b];
        if (list.length === 0) return null;
        const all = !!expanded[b];
        const shown = all ? list : list.slice(0, PREVIEW);
        return (
          <section key={b} aria-label={labels[b]} data-group={b} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {labels[b]}
                <span className="ml-1.5 text-foreground/70">{list.length}</span>
              </h2>
              {list.length > PREVIEW && (
                <button type="button" onClick={() => toggle(b)} className="text-ds-13 font-semibold text-primary">
                  {all ? "Show less" : `See all ${list.length}`}
                </button>
              )}
            </div>
            <div className="space-y-list">
              {shown.map((it) => (
                <div key={getKey(it)}>{renderItem(it)}</div>
              ))}
            </div>
          </section>
        );
      })}
      {(["done", "cancelled"] as const).map((b) => {
        const list = groups[b];
        if (list.length === 0) return null;
        const open = !!expanded[b];
        return (
          <section key={b} aria-label={labels[b]} data-group={b} className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(b)}
              className="btn-press liquid-glass w-full flex items-center gap-3 px-4 py-3 text-left"
            >
              <span className="flex-1 min-w-0 text-ds-15 font-semibold">{labels[b]}</span>
              <span className="text-ds-13 text-muted-foreground">{list.length}</span>
              <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
            </button>
            {open && (
              <div className="space-y-list">
                {list.map((it) => (
                  <div key={getKey(it)}>{renderItem(it)}</div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
