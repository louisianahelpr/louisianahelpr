import { Pin } from "lucide-react";

/**
 * A pinned thread's chip, beside the row's timestamp. It used to overlay the
 * avatar's top-left corner, the corner the unread mark took, and covered it on
 * a pinned + unread thread (Q1090, owner 2026-10-07: the unread mark keeps its
 * spot, the Pinned chip moves beside the timestamp). Hidden in select mode.
 */
export function PinnedChip() {
  return (
    <span
      role="img"
      aria-label="Pinned"
      data-testid="pinned-chip"
      className="inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0"
      style={{
        background: "hsl(var(--burnt-sienna) / 0.9)",
        boxShadow: "0 1px 3px hsl(var(--burnt-sienna) / 0.45)",
      }}
    >
      <Pin className="w-2.5 h-2.5" style={{ color: "hsl(var(--parchment))" }} strokeWidth={2.4} aria-hidden />
    </span>
  );
}
