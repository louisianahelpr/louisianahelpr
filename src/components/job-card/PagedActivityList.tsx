/**
 * Q372 (owner, 2026-09-24): each Activity list (a section of the grouped view, or the flat
 * single-status list) shows 50 cards, then a "Show older"
 * button reveals the next 50. The largest account (a test account) held 212 posted jobs on 2026-09-24 and
 * rendered every card at once. Items arrive newest first (useActivityData
 * orders by created_at desc; activityFilters only lifts overdue/needs-action
 * rows to the top, a stable partition), so the tail is the older work.
 */
import { ListRow } from "@/components/ui/ListRow";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export const ACTIVITY_PAGE_SIZE = 50;

export function PagedActivityList<TItem>({
  items,
  getKey,
  renderItem,
  onHiddenChange,
  revealKey = null,
}: {
  items: TItem[];
  getKey: (item: TItem) => string;
  renderItem: (item: TItem) => ReactNode;
  /** How many cards are still behind "Show older" — so an end-of-list line
   *  never says "that's everything" while some are hidden. */
  onHiddenChange?: (hidden: number) => void;
  /** F433 (audit 11-10): the card a notification or link opened. When it sits behind "Show older" (a 703-job list
   *  opened on a card 50 places down), enough pages open once that it is drawn and can scroll into view and pulse. */
  revealKey?: string | null;
}) {
  const [shown, setShown] = useState(ACTIVITY_PAGE_SIZE);
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!revealKey || revealedFor.current === revealKey) return;
    const at = items.findIndex((item) => getKey(item) === revealKey);
    if (at < 0) return; // not loaded yet (or not on this list): try again when the items change
    revealedFor.current = revealKey;
    setShown((n) => (at < n ? n : Math.ceil((at + 1) / ACTIVITY_PAGE_SIZE) * ACTIVITY_PAGE_SIZE));
  }, [revealKey, items, getKey]);
  const hidden = Math.max(0, items.length - shown);
  useEffect(() => {
    onHiddenChange?.(hidden);
  }, [hidden, onHiddenChange]);
  return (
    <>
      {/* Single column on phones / native; the wide browser desktop splits
          into two columns via `.ds-activity-grid` in index.css. */}
      <div className="space-y-list ds-activity-grid">
        {items.slice(0, shown).map((item) => (
          <div key={getKey(item)}>{renderItem(item)}</div>
        ))}
      </div>
      {items.length > shown && (
        // Same control as the profile's review list: a full-width button,
        // not a content card.
        <ListRow variant="flush"
          onClick={() => setShown((n) => n + ACTIVITY_PAGE_SIZE)}
          className="min-h-11 text-center mt-3 w-full rounded-2xl liquid-glass p-3 text-ds-13 font-medium text-foreground ctl-tint flex items-center justify-center gap-1.5"
        >
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
          Show older
          <span className="text-muted-foreground">({shown} of {items.length})</span>
        </ListRow>
      )}
    </>
  );
}
