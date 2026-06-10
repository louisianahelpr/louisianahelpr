import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface StatusChip {
  /** Stable key used as the active-filter value. */
  value: string;
  /** Short, on-brand label shown on the chip. */
  label: string;
}

interface ListFilterBarProps {
  /** Current free-text query. */
  searchQuery: string;
  setSearchQuery: (next: string) => void;
  /** Active status filter (a chip `value`, or "all"). */
  statusFilter: string;
  setStatusFilter: (next: string) => void;
  /** Status chips appropriate to this list. The "All" chip is rendered
   *  automatically and need not be included. */
  chips: StatusChip[];
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
}

/**
 * ListFilterBar — a compact, self-contained search + status-chip control
 * for the personal "My Jobs" / "My Posts" lists. Mirrors the editorial
 * language of the Browse Tasks toolbar (collapsible search behind a
 * search icon, bark-tinted active state, design-token rounding) but
 * filters a small in-memory list client-side — no shared dashboard
 * filter state, no network.
 *
 * Only mount this when the underlying list is non-empty; on a truly empty
 * list there is nothing to search.
 */
export function ListFilterBar({
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  chips,
  searchPlaceholder = "Search…",
}: ListFilterBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const allChips: StatusChip[] = [{ value: "all", label: "All" }, ...chips];

  return (
    <div className="mb-3 space-y-2">
      {/* Chip row + search toggle live on one line so the control strip
          stays compact above a tall list. The chip row scrolls
          horizontally on narrow phones rather than wrapping. */}
      <div className="flex items-center gap-2">
        <div
          className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-0.5 px-0.5"
          role="tablist"
          aria-label="Filter by status"
        >
          {allChips.map((chip) => {
            const active = statusFilter === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatusFilter(chip.value)}
                className={`shrink-0 px-3 py-1.5 rounded-ds-md text-ds-11 font-semibold btn-press transition-colors ${
                  active
                    ? "bg-[hsl(var(--bark)/0.1)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.32)]"
                    : "text-muted-foreground hover:text-foreground ring-1 ring-inset ring-[hsl(var(--olivewood)/0.16)]"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSearchOpen((o) => !o)}
          className={`h-8 w-8 shrink-0 rounded-ds-md btn-press ${
            searchOpen || searchQuery
              ? "text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.45)]"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-label="Search this list"
          aria-expanded={searchOpen}
        >
          <Search className="w-4 h-4" />
        </Button>
      </div>

      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="relative pt-0.5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                autoFocus
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-9 h-10 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
