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
 * bone is the timestamp, and the small pill beside the name is the job-status
 * chip. Nothing stands in for the unread dot (it rides the avatar and costs
 * no height). What has to match is the RESERVATION.
 *
 * Q1695 (lead, 2026-11-04, by recommendation; owner rule "nothing jumps"):
 * the skeleton reserves the status chip's room. Almost every real thread is
 * on a job and carries the chip, and at 375 the chip does not fit beside the
 * name and an "Oct 28"-wide timestamp, so it drops under the name and the
 * row grows by the chip's line (the loading-states refresh measured /messages
 * 60px -> 83px). Line 1 therefore copies the real row's line 1 exactly — the
 * same items-start outer line, the same wrapping left group, a name box on
 * the real name's `basis-[7.5rem] grow` at the real name's 24px line, and a
 * chip bone at the chip's ~20px height and a typical chip's width — so the
 * bone wraps under the name exactly where the real chip does (375) and stays
 * inline where it does (desktop panel). Guard:
 * src/test/messageSkeletonReservesStatusChip.test.tsx.
 */
export function MessageThreadSkeleton() {
  return (
    <div className={CONVERSATION_ROW_FRAME} aria-hidden>
      <Skeleton
        className={`shrink-0 rounded-full ${CONVERSATION_ROW_AVATAR}`}
        style={{ background: "hsl(var(--olivewood) / 0.14)" }}
      />

      {/* Center column — name (+ status chip) + job line + last-message
          preview, on the same `flex-1 min-w-0` the real row's text button uses.

          Heights, measured on the built app at 375 (a chip-less or inline-chip
          row is a 60px column, 80px with the frame's `py-2.5`): line 1 is the
          real name line's 24px (h-6), then two 14px bones each after a 4px
          gap: 24 + 4 + 14 + 4 + 14 = 60. When the chip wraps, line 1 becomes
          24 + 2 (gap-y-0.5) + 20 (h-5 chip) = 46, the column 82, as the real
          row's 81.9. */}
      <div className="flex-1 min-w-0">
        {/* LINE 1 — the real row's row-line-1 and its wrapping left group. */}
        <div className="flex items-start gap-x-1.5" data-testid="skeleton-line-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0 flex-1">
            <div className="min-w-0 basis-[7.5rem] grow h-6 flex items-center" data-testid="skeleton-name">
              <Skeleton
                className="h-4 w-28 max-w-full rounded"
                style={{ background: "hsl(var(--olivewood) / 0.14)" }}
              />
            </div>
            {/* Status chip — the real chip's height and a typical label's
                width ("In progress" at ds-11 is about 72px). */}
            <Skeleton
              data-testid="skeleton-status-chip"
              className="h-5 w-[4.5rem] rounded-full shrink-0"
              style={{ background: "hsl(var(--olivewood) / 0.10)" }}
            />
          </div>
          {/* Timestamp, pinned to the top-right corner like the real row's;
              w-10 is an "Oct 28"-wide time. */}
          <div className="ml-auto shrink-0 h-6 flex items-center">
            <Skeleton
              className="h-3 w-10 rounded"
              style={{ background: "hsl(var(--olivewood) / 0.10)" }}
            />
          </div>
        </div>
        <Skeleton
          className="mt-1 h-3.5 w-24 rounded"
          style={{ background: "hsl(var(--olivewood) / 0.10)" }}
        />
        <Skeleton
          className="mt-1 h-3.5 w-[80%] rounded"
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
