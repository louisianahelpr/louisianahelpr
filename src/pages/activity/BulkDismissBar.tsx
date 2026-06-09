import { Trash2, X } from "lucide-react";
import { hapticLight } from "@/lib/haptics";

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
      className="fixed inset-x-0 z-40 px-4"
      // Sit above the bottom-nav dock — same safe-area math the rest of
      // the app uses for dock-adjacent floating UI.
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
      }}
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
          <button
            type="button"
            onClick={() => { hapticLight(); onCancel(); }}
            aria-label="Cancel selection"
            className="h-9 w-9 rounded-ds-md inline-flex items-center justify-center btn-press transition"
            style={{
              color: "hsl(var(--parchment) / 0.85)",
              background: "hsl(var(--parchment) / 0.06)",
            }}
          >
            <X className="w-4 h-4" />
          </button>
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
