/**
 * The disputes list's two empty states. Moved out of AdminDisputes.tsx unchanged
 * (component size limit, Q806).
 */
import { CheckCircle2, SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import type { FilterTab } from "./types";

export function DisputeListEmpty({ filter, filtersActive, openCount, clearFilters }: {
  filter: FilterTab;
  filtersActive: boolean;
  openCount: number;
  clearFilters: () => void;
}) {
  return (
    /* Filtered-empty is NOT the same state as empty, and saying "Nothing is
       contested right now" over a queue that holds disputes the admin has
       merely filtered out is the console asserting something false — the
       one thing a moderation surface cannot do. Browse already separates
       these two; this is the same pattern. The Decided tab is never
       filtered, so it only ever has the true-empty case. */
    filter === "open" && filtersActive && openCount > 0 ? (
      <EmptyState
        variant="inline"
        icon={SearchX}
        title="No disputes match your filters"
        body={`${openCount} open ${openCount === 1 ? "dispute is" : "disputes are"} hidden by the current age, party or category filter.`}
        action={
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        variant="inline"
        icon={CheckCircle2}
        title={filter === "open" ? "No active disputes" : "No decided disputes"}
        body={
          filter === "open"
            ? "Nothing is contested right now."
            : "Nothing has been decided in the last 50 jobs."
        }
      />
    )
  );
}
