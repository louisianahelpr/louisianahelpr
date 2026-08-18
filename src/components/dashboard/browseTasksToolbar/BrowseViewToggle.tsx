import { startTransition } from "react";
import { List, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface BrowseViewToggleProps {
  /** List vs Map view selection. */
  view: "list" | "map";
  setView: (next: "list" | "map") => void;
}

/**
 * The Browse feed's List⇄Map switch, on its own so either row can hold it.
 *
 * Home keeps it inside `BrowseTasksActions` up in the title card. The guest
 * feed puts it in the toolbar row instead (`titleRowTrailing`), beside the
 * "Browse jobs" heading, because the guest title card also has to carry two
 * labelled auth controls and at 375px there is no arrangement that fits the
 * emblem, three 44px icons and both CTAs — measured, not guessed. Moving THIS
 * control is the compromise that costs nothing: it stays visible, labelled and
 * 44px at every width, and it arguably belongs next to the heading anyway,
 * since what it switches is the panel that heading names.
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
