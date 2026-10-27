import { AlertTriangle, History } from "lucide-react";
import type { FilterTab } from "./types";

/**
 * Disputes' two tabs, Open queue vs. Decided audit log, each with how many it
 * lists. Moved verbatim out of AdminDisputes (component-size ratchet). The Open
 * count is the FILTERED queue (what the admin can see), never the raw one.
 */
export const DisputeTabs = ({ filter, setFilter, openCount, decidedCount }: {
  filter: FilterTab;
  setFilter: (tab: FilterTab) => void;
  openCount: number;
  decidedCount: number;
}) => (
  <div className="flex gap-1.5 border-b border-border">
    <button
      aria-pressed={filter === "open"}
      type="button"
      onClick={() => setFilter("open")}
      className={`pb-2 px-3 -mb-px text-ds-13 font-medium border-b-2 transition-colors ${
        filter === "open" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" /> Open
        <span className="text-ds-11 tabular-nums">({openCount})</span>
      </span>
    </button>
    <button
      aria-pressed={filter === "decided"}
      type="button"
      onClick={() => setFilter("decided")}
      className={`pb-2 px-3 -mb-px text-ds-13 font-medium border-b-2 transition-colors ${
        filter === "decided" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" /> Decided
        <span className="text-ds-11 tabular-nums">({decidedCount})</span>
      </span>
    </button>
  </div>
);
