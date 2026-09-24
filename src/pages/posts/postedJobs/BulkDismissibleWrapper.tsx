import { Check } from "lucide-react";
import { useLongPress } from "@/hooks/useLongPress";
import { hapticMedium } from "@/lib/haptics";

/**
 * BulkDismissibleWrapper — when selectionMode is off, presses are
 * forwarded to the underlying card as usual EXCEPT for the long-press
 * which enters selection mode. When selectionMode is on, taps toggle
 * selection and the card's own interactions are intercepted (a thin
 * overlay swallows pointer events) so the user can multi-select
 * without accidentally triggering the card's own actions.
 */
interface BulkDismissibleWrapperProps {
  selectionMode: boolean;
  selected: boolean;
  onLongPress: () => void;
  onTapInSelection: () => void;
  children: React.ReactNode;
}

export function BulkDismissibleWrapper({
  selectionMode,
  selected,
  onLongPress,
  onTapInSelection,
  children,
}: BulkDismissibleWrapperProps) {
  const longPressProps = useLongPress({
    threshold: 500,
    onLongPress: () => {
      hapticMedium();
      onLongPress();
    },
  });

  return (
    <div
      // Don't add long-press while already in selection mode — taps
      // should toggle selection cleanly without an additional 500ms hold.
      {...(selectionMode ? {} : longPressProps)}
      className="relative"
      style={{ touchAction: selectionMode ? "manipulation" : undefined }}
    >
      {/* Selection overlay — only active in selection mode. Captures
          taps to toggle and renders a checkbox in the corner. The
          overlay sits above the card content so clicks on links/buttons
          inside the card are blocked while selecting. */}
      {selectionMode && (
        <button
          type="button"
          onClick={onTapInSelection}
          aria-pressed={selected}
          aria-label={selected ? "Deselect this post" : "Select this post"}
          className="absolute inset-0 z-10 rounded-ds-md transition"
          style={{
            background: selected
              ? "hsl(var(--bark) / 0.18)"
              : "hsl(var(--olivewood) / 0.04)",
            border: selected
              ? "1.5px solid hsl(var(--bark))"
              : "1.5px solid hsl(var(--olivewood) / 0.2)",
          }}
        >
          {/* Checkbox glyph — top-right so it doesn't fight the avatar
              or title-bar that anchors the card on the left. */}
          <span
            className="absolute top-3 right-3 w-6 h-6 rounded-full inline-flex items-center justify-center"
            style={{
              background: selected ? "hsl(var(--bark))" : "hsl(var(--parchment))",
              border: selected
                ? "1.5px solid hsl(var(--bark))"
                : "1.5px solid hsl(var(--olivewood) / 0.35)",
              boxShadow: "0 1px 3px hsl(var(--olivewood) / 0.18)",
            }}
            aria-hidden="true"
          >
            {selected && <Check className="w-3.5 h-3.5" style={{ color: "hsl(var(--parchment))" }} strokeWidth={3} />}
          </span>
        </button>
      )}
      {children}
    </div>
  );
}
