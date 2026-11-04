import { BellRing, MapPin, MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
 * BrowseMap's overlays, moved out of src/components/BrowseMap.tsx unchanged (Q806, the god-component ratchet):
 * the empty-board caption, the "map isn't available" panel and the pin preview's caret. Same DOM, classes and
 * copy as before; BrowseMap still decides WHEN each shows (see the comments at each call site there).
 */

/**
 * Empty board: a soft frosted caption over the real Louisiana map. The wrapper passes pointer events through so the
 * map stays pannable; only the caption card itself is interactive, so the guest signup CTA still works. An empty
 * board because the viewer narrowed it is a different message from an empty marketplace.
 */
export function MapEmptyState({
  filtersActive,
  onClearFilters,
  emptyStateCta,
}: {
  filtersActive: boolean;
  onClearFilters?: () => void;
  emptyStateCta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="absolute inset-0 z-[350] flex items-center justify-center pointer-events-none px-6">
      <div
        className="pointer-events-auto flex flex-col items-center text-center gap-3 rounded-2xl px-6 py-6 max-w-[300px]"
        style={{
          backgroundColor: "hsl(var(--surface-band) / 0.92)",
          border: "0.5px solid hsl(var(--olivewood) / 0.18)",
          boxShadow:
            "inset 0 1px 1px 0 hsl(var(--card) / 0.7), " +
            "0 10px 30px -10px hsl(var(--olivewood) / 0.32)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: "hsl(var(--card) / 0.6)",
            border: "1px solid hsl(var(--olivewood) / 0.10)",
            boxShadow:
              "inset 0 1px 1px 0 hsl(var(--card) / 0.7), " +
              "0 1px 2px hsl(var(--olivewood) / 0.05), " +
              "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
          }}
        >
          <MapPin className="w-6 h-6" style={{ color: "hsl(var(--bark))" }} />
        </div>
        <div className="space-y-1">
          {/* An empty board because the viewer narrowed it is a
              different message from an empty marketplace — saying "no
              posts yet" while a category filter is on is simply false,
              and it hides the one action that fixes it. */}
          <p
            className="font-display font-bold leading-tight text-headline-card"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            {filtersActive ? "No pins match." : "Empty map for now."}
          </p>
          <p
            className="font-sans text-ds-13"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {filtersActive
              ? "Nothing on the board fits those filters. Widen them and the pins come back."
              : "New posts land here the moment they go live across Louisiana."}
          </p>
        </div>
        {filtersActive && onClearFilters && (
          <Button variant="outline" onClick={onClearFilters} className="mt-1">
            Clear filters
          </Button>
        )}
        {/* Optional CTA — passed by the guest dashboard so the empty
            map still nudges signup ("get pinged when one lands")
            rather than dead-ending the user. */}
        {emptyStateCta && (
          <Button
            variant="primary"
            onClick={emptyStateCta.onClick}
            className="mt-1"
          >
            <BellRing className="w-4 h-4 mr-2" /> {emptyStateCta.label}
          </Button>
        )}
      </div>
    </div>
  );
}

/** MapKit can't authorize (no token, script blocked, Apple rejected the key): say so plainly; the list is one tap away. */
export function MapUnavailable() {
  return (
    <div
      role="status"
      data-testid="browse-map-unavailable"
      className="absolute inset-0 z-[360] flex flex-col items-center justify-center gap-2 px-6 text-center"
      style={{ background: "hsl(var(--surface-band) / 0.96)" }}
    >
      <MapPinOff className="w-6 h-6" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden="true" />
      <p className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--bark))" }}>
        The map isn't available right now.
      </p>
      <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
        Every open job is still on the list.
      </p>
    </div>
  );
}

/**
 * The pin preview's caret: two stacked triangles, the back one the card's border colour, the front one the card's
 * fill, 1px nearer the card (a border-drawn caret without an SVG). "up" = the card is BELOW the pin (flipped);
 * "down" = the card is ABOVE the pin (the default).
 */
export function PreviewCaret({ dir, left }: { dir: "up" | "down"; left: number }) {
  // "up" draws the caret on the card's top edge pointing up; "down" on its bottom edge pointing down.
  const edge = dir === "up" ? "top" : "bottom";
  const tip = dir === "up" ? "borderBottom" : "borderTop";
  return (
    <span aria-hidden data-testid="browse-map-preview-caret" className={dir === "up" ? "absolute top-0 left-0 w-full h-0" : "absolute bottom-0 left-0 w-full h-0"}>
      <span
        className="absolute"
        style={{
          left,
          [edge]: -9,
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "9px solid transparent",
          borderRight: "9px solid transparent",
          [tip]: "9px solid hsl(var(--border))",
        }}
      />
      <span
        className="absolute"
        style={{
          left,
          [edge]: -8,
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          [tip]: "8px solid hsl(var(--card))",
        }}
      />
    </span>
  );
}
