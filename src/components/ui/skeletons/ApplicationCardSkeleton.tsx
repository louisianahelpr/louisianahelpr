import { Skeleton } from "@/components/ui/skeleton";
import {
  JOB_CARD_SHELL_FRAME,
  JOB_CARD_SHELL_RAIL,
  JOB_CARD_SHELL_TAB_SLOT,
  JOB_CARD_TITLE_PAD_WITH_TAB,
} from "@/components/job-card/JobCardShell";
import { JOB_CATEGORY_TAB_FRAME } from "@/components/job/cardGeometry";

/**
 * The placeholder for a COLLAPSED ACTIVITY JOB CARD — the helper-side
 * `AppliedJobCard` (/jobs) and, since 2026-09-21, the poster-side
 * `PostedJobCard` (/posts) too. They are the same shell at the same 151px;
 * see the note beside `ApplicationCardSkeleton` at the foot of this file.
 *
 * It does not re-draw that card's frame; it IMPORTS it. Frame, category rail,
 * category-tab slot and the title row's tab clearance all come from
 * `JobCardShell`'s own exported geometry, so the reserved space is the real
 * space by construction and neither side can move without the other. Same
 * contract `MessageThreadSkeleton` has with `ConversationRow` and
 * `JobCardSkeleton` has with `cardGeometry`.
 *
 * ── WHAT IT DREW BEFORE, AND WHAT THAT COST ──────────────────────────────
 * Owner, 2026-09-21: "check into jobs exhaustivly bc it stills jumps really
 * bad and takes long to load."
 *
 * This file drew a card with SIX bone rows and a full-width action button in a
 * footer of its own. The collapsed card it stands in for has neither: a
 * collapsed AppliedJobCard is a title bar and a status strip, because the
 * description is behind the expand and the action block is conditional on the
 * job's state.
 *
 * Measured on prod (helper-e2e, /jobs, Chromium at 375, this checkout's
 * local build, 2026-09-21):
 *
 *     placeholder row   220px, pitch 230px
 *     real row          151px, pitch 151px
 *     ────────────────────────────────────
 *     per row           -69px, and it compounds down the list: card 2 moved
 *                       36px, card 3 115px, card 4 195px, the moment the data
 *                       landed.
 *
 * That is "jumps really bad", and it is invisible to CLS: the Layout
 * Instability API only scores elements that existed in the previous frame and
 * MOVED, and a skeleton→content swap removes one subtree and inserts another.
 * Measured CLS on this page was 0.0000 across 0 shifts while every card on it
 * slid. The number that matters here is the row height, which is what
 * `scripts/check-loading-state-shape.mjs` measures (ROW_BUDGET 8px) and what
 * `docs/audit/loading-states/baseline.json` had this surface pinned at
 * ("customer /jobs #1 … row 206px → 154px").
 *
 * ── WHAT IT DRAWS NOW ────────────────────────────────────────────────────
 * The collapsed card's two blocks and nothing else, each sized from the real
 * one's own box:
 *
 *   TITLE BAR  `JOB_CARD_TITLE_PAD_WITH_TAB` (24px tab clearance + 10px) with
 *              the title beside a money pill — 26px, which is MoneyChip's real
 *              height (`py-1` on a `text-ds-17 leading-none` figure, plus its
 *              0.5px border) — then the meta block at `mt-1.5`.
 *   META       TWO lines, because the four states this card spends most of its
 *              life in (offered / confirmed / active / disputed) print the
 *              whole street address, and `JobCardMetaRow` gives an address a
 *              line of its own (`basis-full`) rather than clipping it to seven
 *              characters at 320. Line one is the 32px address control, line
 *              two the 16px date/time run, `gap-y-1` between them.
 *   STATUS     The strip `JobStatusStrip` paints on every collapsed card
 *              ("NEEDS YOU — the day has passed"): a hairline top border,
 *              `px-4 py-2`, a 12px icon and two runs of text.
 *
 * Nothing stands in for the Accept/Decline pair, the tracker panel or the
 * description. All three are conditional on the card's state, and drawing them
 * is what made the placeholder 69px too tall on every row. What has to match
 * is the RESERVATION.
 *
 * The two things it still leads with, and must (they were added 2026-09-19 for
 * the first half of the same report):
 *   - THE CATEGORY RAIL, the 6px colour stripe down the left edge.
 *   - THE CATEGORY TAB, which overlays the card's top-left corner and is why
 *     the title row runs `pt-6` rather than `py-2.5`.
 */
export function CollapsedActivityCardSkeleton() {
  return (
    <div className={JOB_CARD_SHELL_FRAME} aria-hidden>
      {/* Category rail — neutral olivewood while loading; the real card
          recolours it per category. */}
      <span
        className={JOB_CARD_SHELL_RAIL}
        style={{ background: "hsl(var(--olivewood) / 0.18)" }}
      />
      {/* Category tab, in the real tab's own box, so the ~20px it occupies is
          reserved rather than guessed. */}
      <div className={JOB_CARD_SHELL_TAB_SLOT}>
        <span
          className={JOB_CATEGORY_TAB_FRAME}
          style={{
            background: "hsl(var(--olivewood) / 0.10)",
            borderColor: "hsl(var(--olivewood) / 0.14)",
            color: "transparent",
          }}
        >
          <Skeleton
            className="h-2.5 w-14 rounded"
            style={{ background: "hsl(var(--olivewood) / 0.16)" }}
          />
        </span>
      </div>

      {/* TITLE BAR — the card's own padding and hairline, tab clearance
          included, and the meta block inside it exactly as JobCardTitleBar
          places it (`meta` is rendered in a `mt-1.5` wrapper, not as a
          sibling block with its own padding). */}
      <div
        className={JOB_CARD_TITLE_PAD_WITH_TAB}
        style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
      >
        <div className="flex items-center justify-between">
          <Skeleton
            className="h-4 w-[55%] rounded"
            style={{ background: "hsl(var(--olivewood) / 0.14)" }}
          />
          {/* MoneyChip's real box: 17px figure + `py-1` + 0.5px border = 26px.
              The old bone was `h-5` (20px), which let the title row collapse
              6px shorter than it can ever be. */}
          <Skeleton
            className="h-[26px] w-16 rounded-ds-md shrink-0 ml-3"
            style={{ background: "hsl(var(--bark) / 0.10)" }}
          />
        </div>

        <div className="mt-1.5 flex flex-col gap-y-1">
          {/* LINE 1 — the street address, on a line of its own. 32px is the
              press-to-map control's real box (`py-2 -my-2` on a 16px chip:
              the hit area the app puts under every location). */}
          <div className="flex items-center gap-1.5" style={{ height: "32px" }}>
            <Skeleton
              className="h-3 w-3 rounded-full shrink-0"
              style={{ background: "hsl(var(--olivewood) / 0.14)" }}
            />
            <Skeleton
              className="h-3 w-[70%] rounded"
              style={{ background: "hsl(var(--olivewood) / 0.12)" }}
            />
          </div>
          {/* LINE 2 — the date, and the start time when the job has one. */}
          <div className="flex items-center gap-x-3" style={{ height: "16px" }}>
            <Skeleton
              className="h-3 w-3 rounded-full shrink-0"
              style={{ background: "hsl(var(--olivewood) / 0.14)" }}
            />
            <Skeleton
              className="h-3 w-24 rounded"
              style={{ background: "hsl(var(--olivewood) / 0.12)" }}
            />
            <Skeleton
              className="h-3 w-14 rounded"
              style={{ background: "hsl(var(--olivewood) / 0.10)" }}
            />
          </div>
        </div>
      </div>

      {/* STATUS STRIP — JobStatusStrip's own box (`px-4 py-2`, hairline top
          border, 12px icon), which is what a collapsed card actually ends
          with. It used to be a `py-3` band holding a 36px full-width button:
          52px of reservation for a control most states do not draw. */}
      <div
        className="px-4 py-2 flex items-center gap-1.5"
        style={{
          borderTop: "0.5px solid hsl(var(--olivewood) / 0.22)",
          background: "hsl(var(--olivewood) / 0.08)",
        }}
      >
        <Skeleton
          className="h-3 w-3 rounded-full shrink-0"
          style={{ background: "hsl(var(--olivewood) / 0.20)" }}
        />
        <Skeleton
          className="h-2.5 w-20 rounded"
          style={{ background: "hsl(var(--olivewood) / 0.16)" }}
        />
        <Skeleton
          className="h-2.5 w-24 rounded ml-auto"
          style={{ background: "hsl(var(--olivewood) / 0.12)" }}
        />
      </div>
    </div>
  );
}

/**
 * BOTH activity tabs draw this one card.
 *
 * `ApplicationCardSkeleton` is the applied side (/jobs) and
 * `ActivityCardSkeleton` (src/components/SkeletonLoaders.tsx) is the posted
 * side (/posts). They are the same name for the same box: PostedJobCard and
 * AppliedJobCard are both JobCardShell + JobCardTitleBar + JobCardMetaRow +
 * JobStatusStrip, and both measure 151px collapsed at 375. The posted tab used
 * to hand-draw its own 106px approximation, which is the 45px-per-row jump the
 * owner reported on 2026-09-21 — the same defect /jobs had, through a
 * different component.
 *
 * The file keeps its name (and its path, which
 * e2e/prod-audit/activity-loading-reserve.spec.ts names in an @mutate
 * directive); the drawing above is what is shared.
 */
export const ApplicationCardSkeleton = CollapsedActivityCardSkeleton;
