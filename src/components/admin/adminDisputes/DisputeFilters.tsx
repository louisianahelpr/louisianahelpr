import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { pillLabel } from "@/components/admin/useFilterCounts";
import { AdminCard } from "../AdminViewShell";
import { FilterChipGroup } from "./FilterChipGroup";
import { CATEGORY_LABELS } from "./adminDisputesHelpers";
import type { AgeFilter, PartyFilter, CategoryFilter } from "./types";

/**
 * The Open queue's cross-cutting filters (Age, Filed by, Category), panelled so the three chip groups read as one
 * control block between the tabs and the queue. Moved out of AdminDisputes.tsx (component-size ratchet).
 *
 * AUD31-45 (audit 10-31, Disputes at 375): the open card filled the whole first phone screen and the first dispute
 * started ~775px down. On a phone the card is closed until "Show" is pressed, and its header says how many filters
 * are on; on a wider screen it stays open as before.
 */
export function DisputeFilters(p: {
  ageFilter: AgeFilter; setAgeFilter: (v: AgeFilter) => void; ageCount: (v: AgeFilter) => number;
  partyFilter: PartyFilter; setPartyFilter: (v: PartyFilter) => void; partyCount: (v: PartyFilter) => number;
  categoryFilter: CategoryFilter; setCategoryFilter: (v: CategoryFilter) => void; categoryCount: (v: CategoryFilter) => number;
  clearFilters: () => void;
}) {
  const isMobile = useIsMobile();
  const [shown, setShown] = useState(false);
  const active = [p.ageFilter, p.partyFilter, p.categoryFilter].filter((v) => v !== "all").length;
  const open = !isMobile || shown;
  return (
    <AdminCard
      title={active > 0 ? `Filters (${active} on)` : "Filters"}
      action={
        <span className="flex items-center gap-3">
          {active > 0 && (
            <button type="button" onClick={p.clearFilters} className="text-ds-11 text-primary hover:underline">
              Reset Filters
            </button>
          )}
          {isMobile && (
            <button type="button" data-dispute-filters-toggle aria-expanded={shown} aria-controls="dispute-filters"
              onClick={() => setShown((s) => !s)} className="text-ds-11 font-semibold text-primary">
              {shown ? "Hide" : "Show"}
            </button>
          )}
        </span>
      }
      contentClassName={open ? "flex flex-col gap-2.5 text-ds-11" : "hidden"}
    >
      {open && (
        <div id="dispute-filters" className="contents">
          <FilterChipGroup
            label="Age"
            value={p.ageFilter}
            onChange={(v) => p.setAgeFilter(v as AgeFilter)}
            options={[
              { id: "all", label: "All" },
              { id: "0-24h", label: "0–24h" },
              { id: "1-7d", label: "1–7d" },
              { id: "7-30d", label: "7–30d" },
              { id: ">30d", label: ">30d" },
            ].map((o) => ({ ...o, label: pillLabel(o.label, p.ageCount(o.id as AgeFilter)) }))}
          />
          <FilterChipGroup
            label="Filed by"
            value={p.partyFilter}
            onChange={(v) => p.setPartyFilter(v as PartyFilter)}
            options={[
              { id: "all", label: "Both" },
              { id: "poster", label: "Poster" },
              { id: "helper", label: "Helpr" },
            ].map((o) => ({ ...o, label: pillLabel(o.label, p.partyCount(o.id as PartyFilter)) }))}
          />
          <FilterChipGroup
            label="Category"
            value={p.categoryFilter}
            onChange={(v) => p.setCategoryFilter(v)}
            options={[
              { id: "all", label: "All" },
              ...Object.entries(CATEGORY_LABELS).map(([id, label]) => ({ id, label })),
            ].map((o) => ({ ...o, label: pillLabel(o.label, p.categoryCount(o.id as CategoryFilter)) }))}
          />
        </div>
      )}
    </AdminCard>
  );
}
