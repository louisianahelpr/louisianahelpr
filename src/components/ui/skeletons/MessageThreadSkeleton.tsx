import { Skeleton } from "@/components/ui/skeleton";

/**
 * MessageThreadSkeleton — shape-matched placeholder for a single row in
 * the inbox list (see `src/components/messages/ConversationRow.tsx`).
 *
 * Mirrors the real row:
 *   - 44px avatar circle on the left
 *   - Name + (italic) job-title preview line + last-message line in
 *     the center
 *   - Timestamp on the right
 *   - Far-right unread dot (8px), matching the real iMessage-style cue
 *
 * Sits on the same `liquid-glass` surface as the real row so the
 * loading-to-loaded swap is visually stable.
 */
export function MessageThreadSkeleton() {
  return (
    <div
      className="w-full p-3 rounded-ds-md liquid-glass flex items-center gap-2.5"
      aria-hidden
    >
      {/* Avatar — 44px to match `w-11 h-11` on the real row. */}
      <Skeleton
        className="shrink-0 w-11 h-11 rounded-full"
        style={{ background: "hsl(var(--olivewood) / 0.14)" }}
      />

      {/* Center column — name + job line + last-message preview. */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Skeleton
            className="h-4 w-28 rounded"
            style={{ background: "hsl(var(--olivewood) / 0.14)" }}
          />
          {/* Timestamp on the right of the top row, like the real row. */}
          <Skeleton
            className="h-3 w-10 rounded shrink-0"
            style={{ background: "hsl(var(--olivewood) / 0.10)" }}
          />
        </div>
        <Skeleton
          className="h-3 w-24 rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
        <Skeleton
          className="h-3 w-[80%] rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
      </div>

      {/* Unread dot — same 8px sienna-tinted pill the real row pins on
          the far right when there are unread inbound messages. Kept on
          the skeleton as a neutral block so the row width matches. */}
      <Skeleton
        className="shrink-0 w-2 h-2 rounded-full"
        style={{ background: "hsl(var(--burnt-sienna) / 0.20)" }}
      />
    </div>
  );
}
