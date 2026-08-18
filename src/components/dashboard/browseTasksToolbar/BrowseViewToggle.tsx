import { startTransition } from "react";
import { List, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface BrowseViewToggleProps {
  /** List vs Map view selection. */
  view: "list" | "map";
  setView: (next: "list" | "map") => void;
}

/**
 * The Browse feed's List⇄Map switch — the first control in
 * `BrowseTasksActions`, in the toolbar's heading row, on both browse surfaces.
 *
 * Split into its own file while the guest feed briefly rendered it separately
 * from the rest of the cluster (2026-08-17, since reverted). Kept split: it is
 * the one control in the cluster with its own `startTransition` + pressed
 * state, and it reads better apart from the four-button fragment.
 *
 * Hidden only on the desktop web, where the feed and the map are both on
 * screen at once and there is nothing to switch between.
 */
export function BrowseViewToggle({ view, setView }: BrowseViewToggleProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => startTransition(() => setView(view === "map" ? "list" : "map"))}
      className={`h-10 w-10 rounded-ds-md btn-press focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${view === "map" ? "bg-[hsl(var(--bark)/0.12)] hover:!bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]" : "text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)]"}`}
      aria-label={view === "map" ? "Show list view" : "Show map view"}
      aria-pressed={view === "map"}
    >
      {view === "map" ? <List className="w-5 h-5" /> : <MapIcon className="w-5 h-5" />}
    </Button>
  );
}

export default BrowseViewToggle;
