import { Search, SlidersHorizontal, X } from "lucide-react";
import { FilterSheet } from "@/components/dashboard/FilterSheet";
import { hapticLight } from "@/lib/haptics";
import type { StatusFilter } from "./activityFilters";
import type { Tab } from "@/components/activity/activityConstants";
import { defaultStatusFilterFor } from "@/components/activity/activityConstants";

/**
 * ActivityHeader — the title row with search/filter toggle buttons, the
 * status-filter dropdown, and the expandable search bar. Stateless: all
 * search/filter state is owned by the page and passed in.
 */
export interface ActivityHeaderProps {
  tab: Tab;
  activeStatusFilters: StatusFilter[];
  activeCounts: Record<string, number>;
  statusFilter: string;
  setStatusFilter: (filter: string) => void;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export function ActivityHeader({
  tab,
  activeStatusFilters,
  activeCounts,
  statusFilter,
  setStatusFilter,
  filterOpen,
  setFilterOpen,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
}: ActivityHeaderProps) {
  // The "non-default" status that lights up the filter button + dot.
  // Preserved verbatim from the prior dropdown so the active indicator
  // behaves identically after the move to the bottom sheet.
  const defaultStatus = defaultStatusFilterFor(tab);
  const isStatusFiltered = statusFilter !== defaultStatus;
  return (
    <>
      {/* Header row — title + search/filter toggle buttons. The search
          input expands below this row instead of replacing the title,
          matching the Dashboard search pattern. */}
      <div
        className="shrink-0 flex items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: searchOpen ? "none" : "1px solid hsl(var(--olivewood) / 0.1)" }}
      >
            <div className="flex flex-col leading-none min-w-0">
              {/* No eyebrow. The page is already titled "My Posts" (or "My
                  Jobs") immediately above this card, so "POSTED JOBS" restated
                  it in smaller type — the same stacked-label pattern removed
                  from the dialogs and the landing section. */}
              <h2
                className="font-display italic font-bold leading-tight mt-1 truncate"
                style={{
                  fontSize: "1.25rem",
                  color: "hsl(var(--ink-deep))",
                  letterSpacing: "-0.018em",
                }}
              >
                {activeStatusFilters.find((f) => f.key === statusFilter)?.label ?? "All"}
              </h2>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => { hapticLight(); setSearchOpen(!searchOpen); }}
                aria-label="Search jobs"
                aria-expanded={searchOpen}
                className={`h-11 w-11 rounded-ds-md flex items-center justify-center btn-press transition ${
                  searchOpen || searchQuery
                    ? "text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.45)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`}
              >
                <Search className="w-4 h-4" />
              </button>
              {/* Filter button — opens the shared FilterSheet (a bottom
                  sheet) with a single "Status" section. Same presentation as
                  the Browse / Dashboard filters, instead of a bespoke
                  dropdown. */}
              <button
                type="button"
                aria-label="Filter by status"
                aria-expanded={filterOpen}
                onClick={() => { hapticLight(); setFilterOpen(true); }}
                className={`h-11 w-11 rounded-ds-md btn-press flex items-center justify-center relative transition ${
                  filterOpen || isStatusFiltered
                    ? "text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.45)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                {isStatusFiltered && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[hsl(var(--bark))] ring-2 ring-background" />
                )}
              </button>
            </div>
      </div>

      <FilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeFilterCount={isStatusFiltered ? 1 : 0}
        onClearAll={() => setStatusFilter(defaultStatus)}
        sections={[
          {
            key: "status",
            title: "Filter by status",
            content: (
              <div className="grid grid-cols-2 gap-1.5">
                {activeStatusFilters.map((f) => {
                  const count = activeCounts[f.key] || 0;
                  const isActive = statusFilter === f.key;
                  return (
                    <button
                      key={f.key}
                      onClick={() => { hapticLight(); setStatusFilter(f.key); setFilterOpen(false); }}
                      className="inline-flex items-center justify-center gap-1.5 w-full px-2 h-9 rounded-ds-md squircle border text-ds-11 font-semibold tracking-tight transition-all btn-press active:scale-[0.98]"
                      style={
                        isActive
                          ? {
                              background: "hsl(var(--bark))",
                              color: "hsl(var(--parchment))",
                              borderColor: "hsl(var(--bark))",
                              boxShadow: "0 1px 2px hsl(var(--bark) / 0.18)",
                            }
                          : {
                              background: "hsl(var(--background))",
                              color: "hsl(var(--ink-deep))",
                              borderColor: "hsl(var(--border) / 0.6)",
                            }
                      }
                    >
                      <span className="truncate">{f.label}</span>
                      {count > 0 && (
                        <span
                          className="text-ds-10 tabular-nums font-semibold shrink-0 px-1.5 py-[1px] rounded-ds-pill leading-none inline-flex items-center"
                          style={
                            isActive
                              ? { background: "hsl(var(--parchment) / 0.18)", color: "hsl(var(--parchment))" }
                              : { background: "hsl(var(--olivewood) / 0.08)", color: "hsl(var(--olivewood) / 0.85)" }
                          }
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ),
          },
        ]}
      />

      {/* Expandable search bar — drops down below the header row,
          matching the Dashboard search pattern. */}
      {searchOpen && (
        <div
          className="shrink-0 overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200"
          style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
        >
          <div className="relative px-4 py-3">
            <Search className="absolute left-7 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              autoFocus
              type="search"
              aria-label="Search jobs"
              placeholder="Search jobs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-9 h-10 text-ds-13 rounded-ds-md glass-field focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
