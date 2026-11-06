import { Trash2 } from "lucide-react";
import { hapticLight } from "@/lib/haptics";
import { SelectBarExitButton } from "@/components/ui/SelectBarExitButton";

/**
 * BulkDismissBar — sticky bottom action bar shown when the user enters
 * selection mode on the Cancelled section. Reports the selection count
 * and offers Dismiss + Cancel. "Dismiss" here is a UI-only hide
 * (sessionStorage-persisted), not a server-side delete — cancellation
 * records stay intact for audit.
 */
interface BulkDismissBarProps {
  selectedCount: number;
  onDismiss: () => void;
  onCancel: () => void;
}

export function BulkDismissBar({
  selectedCount,
  onDismiss,
  onCancel,
}: BulkDismissBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk dismiss action bar"
      data-rail-inset
      // Sit above the bottom-nav dock on the shared `safe-nav` token
      // (tailwind.config.ts: --safe-area-bottom + --bottom-nav-h + 1rem), the
      // same clearance every other dock-adjacent surface reads (Q214). It was
      // a hand-typed env() + 80px that ignored --bottom-nav-h.
      className="fixed inset-x-0 bottom-safe-nav z-40 px-4"
    >
      <div
        className="mx-auto max-w-xl flex items-center justify-between gap-3 px-4 py-3 rounded-ds-md"
        style={{
          background: "hsl(var(--ink-deep))",
          boxShadow: "0 12px 28px hsl(var(--ink-deep) / 0.32)",
        }}
      >
        <span
          className="text-ds-13 font-semibold truncate"
          style={{ color: "hsl(var(--parchment))" }}
        >
          {selectedCount === 0
            ? "Tap to select"
            : `${selectedCount} selected`}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <SelectBarExitButton
            onClick={() => { hapticLight(); onCancel(); }}
            aria-label="Cancel selection"
          />
          <button
            type="button"
            onClick={onDismiss}
            disabled={selectedCount === 0}
            aria-label={`Dismiss ${selectedCount} ${selectedCount === 1 ? "post" : "posts"}`}
            className="h-9 px-3 rounded-ds-md inline-flex items-center gap-1.5 text-ds-13 font-semibold btn-press transition disabled:opacity-40"
            style={{
              color: "hsl(var(--parchment))",
              background: selectedCount === 0
                ? "hsl(var(--parchment) / 0.10)"
                : "hsl(var(--destructive))",
            }}
          >
            <Trash2 className="w-4 h-4" />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
