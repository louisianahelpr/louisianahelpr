import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import {
  SEARCH_HISTORY_MIN_LENGTH,
  clearRecentSearches,
  getRecentSearches,
  pushRecentSearch,
} from "@/lib/searchHistory";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";

/**
 * The Browse feed's search field, rendered INSIDE the title card — the same
 * panel the search icon that opens it lives in.
 *
 * It used to render one row down, in BrowseTasksToolbar's header row: you
 * tapped a button in the top card and the input appeared in a different
 * container below it, which is what "it should open in that top panel" was
 * about. Taking over the bar it was launched from is the iOS pattern and the
 * same thing /legal's policy search does.
 *
 * The "Popular" chip row that used to sit under this went with the move. It
 * applied a category filter, which is exactly what CategoryChipRow — a
 * permanent, one-tap row a few pixels below — already does, so it was a second
 * control for the same job wearing a different name. Recent searches stayed:
 * those are the user's own text queries and nothing else offers them.
 */
export function BrowseSearchBar({
  filters,
}: {
  filters: ReturnType<typeof useDashboardFilters>;
}) {
  // Snapshot history when the field opens and refresh after each push, so the
  // list doesn't mutate under the user mid-typing.
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => getRecentSearches());

  // Persist settled queries, not keystrokes.
  const lastPushedRef = useRef<string>("");
  useEffect(() => {
    const q = filters.searchQuery.trim();
    if (q.length < SEARCH_HISTORY_MIN_LENGTH) return;
    if (q.toLowerCase() === lastPushedRef.current.toLowerCase()) return;
    const timer = window.setTimeout(() => {
      pushRecentSearch(q);
      lastPushedRef.current = q;
      setRecent(getRecentSearches());
    }, 800);
    return () => window.clearTimeout(timer);
  }, [filters.searchQuery]);

  const applySuggestion = (q: string) => {
    filters.setSearchQuery(q);
    pushRecentSearch(q);
    lastPushedRef.current = q;
    setRecent(getRecentSearches());
    setFocused(false);
  };

  const showRecent = focused && filters.searchQuery.length === 0 && recent.length > 0;

  return (
    // `relative` + an absolutely-positioned dropdown: the title card is a
    // fixed-height band, so a suggestion list in normal flow would grow it and
    // shove the feed down every time the field takes focus.
    <div className="relative flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            autoFocus
            type="search"
            aria-label="Search jobs"
            placeholder="Search jobs…"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            value={filters.searchQuery}
            onChange={(e) => filters.setSearchQuery(e.target.value)}
            onFocus={() => {
              setFocused(true);
              setRecent(getRecentSearches());
            }}
            // Delayed so a mousedown on a suggestion row still lands.
            onBlur={() => window.setTimeout(() => setFocused(false), 150)}
            className="w-full pl-9 pr-9 h-9 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
          />
          {filters.searchQuery && (
            <button
              onClick={() => filters.setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            filters.setSearchOpen(false);
            filters.setSearchQuery("");
          }}
          className="shrink-0 text-ds-13 font-medium btn-press py-2"
          style={{ color: "hsl(var(--bark))" }}
        >
          Cancel
        </button>
      </div>

      {showRecent && (
        <div
          className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-ds-md overflow-hidden bg-card"
          style={{
            border: "0.5px solid hsl(var(--olivewood) / 0.18)",
            boxShadow: "0 12px 32px -12px hsl(var(--olivewood) / 0.35)",
          }}
          role="listbox"
          aria-label="Recent searches"
        >
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30">
            <span
              className="font-serif italic tracking-[0.14em] uppercase text-ds-9"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Recent
            </span>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                clearRecentSearches();
                setRecent([]);
              }}
              className="text-ds-10 text-muted-foreground hover:text-destructive btn-press"
            >
              Clear
            </button>
          </div>
          <ul>
            {recent.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(q);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-ds-13 hover:bg-muted/50 btn-press"
                >
                  <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{q}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default BrowseSearchBar;
