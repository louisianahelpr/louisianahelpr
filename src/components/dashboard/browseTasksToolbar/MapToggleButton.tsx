import { Map, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Show / hide the map column on the desktop website's Browse (Jobs and Declutter, owner 2026-10-28: "declutter
 * should have the same search filter and map view as jobs"). It sits with search and filters at the end of the
 * tabs row because it is the same kind of control: it changes how you read the board, not what is on it.
 *
 * `disabled` while the feed is showing its load-error card: the map column is suppressed then, so this control
 * would have nothing to show or hide.
 */
export function MapToggleButton({ visible, onToggle, disabled = false }: { visible: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="iconCompact"
      onClick={onToggle}
      aria-pressed={visible}
      disabled={disabled}
      aria-label={visible ? "Hide the map" : "Show the map"}
      title={visible ? "Hide the map" : "Show the map"}
      // App audit 11-23 H3: no disc behind the icon while the map shows (owner 11-21, no circles on header icons).
      className={`btn-press disabled:opacity-40 ${
        visible
          ? "ctl-tint text-[hsl(var(--bark))]"
          : "ctl-tint text-muted-foreground hover:text-foreground"
      }`}
    >
      {visible ? <Map className="w-5 h-5" /> : <MapPinned className="w-5 h-5" />}
    </Button>
  );
}
