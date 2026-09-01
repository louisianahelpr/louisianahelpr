import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { useKeyboardInset } from "@/hooks/useKeyboardInset";
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
  embedded = false,
}: {
  filters: ReturnType<typeof useDashboardFilters>;
  /**
   * Rendered as a SECTION of the filter panel rather than as the title card's
   * own expanding search bar.
   *
   * The difference is what the trailing ✕ means. In the title card the field
   * only exists while `searchOpen` is true, so its ✕ is the way OUT of search
   * and is always present. In the panel the field is permanent — `searchOpen`
   * does not gate it — so "close search" is not a thing that can happen, and
   * the always-on ✕ was a control that visibly did nothing (owner: "the x in
   * search also doesn't close it"). Worse, it was the only ✕ on screen, so it
   * is what people reached for to dismiss the whole panel. Embedded, it
   * appears only when there is text to clear, and the panel carries its own
   * close button in its header.
   */
  embedded?: boolean;
}) {
  // Snapshot history when the field opens and refresh after each push, so the
  // list doesn't mutate under the user mid-typing.
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => getRecentSearches());
  const inputRef = useRef<HTMLInputElement>(null);

  // When the user DOES tap the field, the iOS keyboard takes the bottom of the
  // screen — and in the panel this field sits at the top of a scroll container
  // whose lower half the keyboard then covers. Lift the focused field into
  // view once the keyboard has settled. Same `useKeyboardInset` pattern
  // Messages / PostJob / ProfileEditForm use; `block: "nearest"` because this
  // field is near the TOP of its scroller and "center" would drag it down
  // under the keyboard it is trying to escape.
  const keyboardInset = useKeyboardInset();
  useEffect(() => {
    if (keyboardInset <= 0) return;
    const el = inputRef.current;
    if (!el || document.activeElement !== el) return;
    // Defer a frame so layout has settled to the smaller viewport first.
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [keyboardInset]);

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
    // The Recent-searches list used to be absolutely positioned so it
    // wouldn't grow the title card. In practice that meant it floated OVER
    // whatever was directly beneath the field — the category chip row, or
    // the top of the feed — instead of making room for itself (owner:
    // "should push down, not overlap"). It now renders in normal document
    // flow: the title card grows by exactly the dropdown's height while it's
    // open, and the panel below simply starts lower. `spellCheck={false}`
    // on the input — a search query is not prose the browser should be
    // second-guessing with red squiggles.
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          {/* Deliberately NOT autoFocus. This field is inside the "Refine
              Your Search" sheet, which is opened by the filter button — a
              control whose job is sort/view/category, not text entry. Focusing
              on open threw up the iOS keyboard every time, covering the
              Category chips and half the sort row the poster actually came
              for, and forcing a dismiss before they could tap anything.
              Tapping the field still focuses it; the keyboard now appears
              when it is asked for. */}
          <input
            ref={inputRef}
            type="search"
            aria-label="Search jobs"
            placeholder="Search jobs…"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            value={filters.searchQuery}
            onChange={(e) => filters.setSearchQuery(e.target.value)}
            onFocus={() => {
              setFocused(true);
              setRecent(getRecentSearches());
            }}
            // Delayed so a mousedown on a suggestion row still lands.
            onBlur={() => window.setTimeout(() => setFocused(false), 150)}
            // `pr-10` reserves the lane the trailing ✕ sits in — so it is only
            // reserved when the ✕ is actually rendered (see below), otherwise
            // an empty embedded field carries 40px of dead right margin.
            className={`w-full pl-9 ${embedded && filters.searchQuery.length === 0 ? "pr-3" : "pr-10"} h-9 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground`}
          />
          {/* The X lives INSIDE the field, on its right — the same shape the
              Activity search uses (owner: "instead of Cancel put X in the
              right of the search bar").

              In the TITLE-CARD form it is always present, because it is the
              way OUT of search: hiding it until there is a query would leave
              an open search bar with no visible dismiss. In the PANEL form
              (`embedded`) there is nothing to dismiss — the field is a
              permanent section — so it renders only when there is text to
              clear, instead of standing there as a control that does nothing
              when pressed. See the `embedded` prop doc. */}
          {(!embedded || filters.searchQuery.length > 0) && (
          <button
            type="button"
            onClick={() => {
              filters.setSearchQuery("");
              if (embedded) {
                // Stay in the field: the user asked to clear the query, not to
                // leave the search box.
                inputRef.current?.focus();
              } else {
                filters.setSearchOpen(false);
              }
            }}
            aria-label={embedded ? "Clear search" : "Close search"}
            // `!min-h-0 !min-w-0` — index.css's bare `button { min-height:
            // 44px; min-width: 44px }` HIG tap-target rule otherwise wins
            // over `h-7 w-7` and renders this 44x44 inside a 36px-tall bar,
            // spilling past its top/bottom edge (the same trap already
            // documented on the toast close button).
            className="absolute right-2.5 top-1/2 -translate-y-1/2 !min-h-0 !min-w-0 h-7 w-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 btn-press transition"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
          )}
        </div>
      </div>

      {showRecent && (
        <div
          className="mt-1.5 rounded-ds-md overflow-hidden bg-card"
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
