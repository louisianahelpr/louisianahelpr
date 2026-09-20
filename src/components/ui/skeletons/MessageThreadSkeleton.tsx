import { Skeleton } from "@/components/ui/skeleton";
import {
  CONVERSATION_ROW_AVATAR,
  CONVERSATION_ROW_FRAME,
  CONVERSATION_ROW_HAIRLINE_INSET,
} from "@/components/messages/ConversationRow";

/**
 * MessageThreadSkeleton — the placeholder for ONE inbox row
 * (`src/components/messages/ConversationRow.tsx`).
 *
 * It does not re-draw that row's frame; it IMPORTS it. The frame, the avatar
 * box and the hairline inset all come from `ConversationRow`'s own exported
 * geometry, so the reserved space is the real space by construction and the
 * two cannot drift apart when either is touched.
 *
 * Owner, 2026-09-19: loading states "jump and are not consistent with their
 * info". This row was both. It used to hand-draw `p-3 rounded-ds-md
 * liquid-glass` — a raised glass CARD, 12px of padding — and the list stacked
 * four of them with `space-y-2`. The real row is a flat `px-3 py-2.5` strip
 * with no card, no rounding and no gap, divided by the inset hairline below.
 * Measured on the built app at 375 against prod: bones at a 76px pitch gave
 * way to rows at a 64px pitch, so everything under the first row slid up, and
 * four bones were replaced by ten rows. The old comment claimed it sat "on the
 * same liquid-glass surface as the real row"; it never did.
 *
 * The bones inside are deliberately fewer than the real row's parts. A
 * placeholder's job is to hold the shape and get out of the way — the three
 * lines are the name, the job title and the message preview, the right-hand
 * bone is the timestamp, and nothing stands in for the status pill or the
 * unread dot, which are conditional on the real row and would be an invented
 * promise. What has to match is the RESERVATION, and it does.
 */
export function MessageThreadSkeleton() {
  return (
    <div className={CONVERSATION_ROW_FRAME} aria-hidden>
      <Skeleton
        className={`shrink-0 rounded-full ${CONVERSATION_ROW_AVATAR}`}
        style={{ background: "hsl(var(--olivewood) / 0.14)" }}
      />

      {/* Center column — name + job line + last-message preview, on the same
          `flex-1 min-w-0` the real row's text button uses.

          THREE bones at `h-4` with `space-y-1.5`: 3×16 + 2×6 = 60px, which
          plus the frame's `py-2.5` is the 79.8px a real row measures on the
          built app at 375 (rows land at y=139, 219, 299 — an 80px pitch). The
          first pass used `h-3` for the lower two and came out 8px short per
          row: right shape, wrong height, and eight rows of that is a visible
          step. Measured against the real rows, not guessed. */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Skeleton
            className="h-4 w-28 rounded"
            style={{ background: "hsl(var(--olivewood) / 0.14)" }}
          />
          {/* Timestamp, pinned to the corner like the real row's. */}
          <Skeleton
            className="h-3 w-10 rounded shrink-0"
            style={{ background: "hsl(var(--olivewood) / 0.10)" }}
          />
        </div>
        <Skeleton
          className="h-4 w-24 rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
        <Skeleton
          className="h-4 w-[80%] rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
      </div>

      {/* The same inset hairline the real row draws, from the same constant.
          Absolute, so — exactly like the real one — it costs the row no
          height. This is what separates the bones; the list must NOT add a
          gap of its own. */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 right-0 h-px"
        style={{
          left: CONVERSATION_ROW_HAIRLINE_INSET,
          background: "hsl(var(--olivewood) / 0.10)",
        }}
      />
    </div>
  );
}
