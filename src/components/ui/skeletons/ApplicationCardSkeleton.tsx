import { Skeleton } from "@/components/ui/skeleton";
import {
  JOB_CARD_SHELL_FRAME,
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
 * The one thing it still leads with, and must (added 2026-09-19 for the first
 * half of the same report; the 6px colour rail went with design tweak T3,
 * 2026-10-18):
 *   - THE CATEGORY TAB, which overlays the card's top-left corner and is why
 *     the title row runs `pt-6` rather than `py-2.5`.
 */
export function CollapsedActivityCardSkeleton({ metaLines = 2 }: { metaLines?: 1 | 2 } = {}) {
  return (
    <div className={JOB_CARD_SHELL_FRAME} aria-hidden>
      {/* No category rail: the cards dropped it (owner design tweak T3,
          2026-10-18), so the bone draws none either. */}
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
          {/* LINE 1 — the location. 32px is the press-to-map control's real
              box (`py-2 -my-2` on a 16px chip: the hit area the app puts
              under every location). On the two-line card it is the street
              address alone; on the one-line card (Q700) the city and the
              date share it. */}
          <div className="flex items-center gap-1.5" style={{ height: "32px" }} data-skeleton-meta-line>
            <Skeleton
              className="h-3 w-3 rounded-full shrink-0"
              style={{ background: "hsl(var(--olivewood) / 0.14)" }}
            />
            <Skeleton
              className={metaLines === 1 ? "h-3 w-[30%] rounded" : "h-3 w-[70%] rounded"}
              style={{ background: "hsl(var(--olivewood) / 0.12)" }}
            />
            {metaLines === 1 && (
              <Skeleton
                className="h-3 w-24 rounded ml-1.5"
                style={{ background: "hsl(var(--olivewood) / 0.12)" }}
              />
            )}
          </div>
          {/* LINE 2 — the date, and the start time when the job has one. */}
          {metaLines === 2 && (
          <div className="flex items-center gap-x-3" style={{ height: "16px" }} data-skeleton-meta-line>
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
          )}
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
 * THE WORKING TAB'S PLACEHOLDER (/jobs?tab=working), Q833 (2026-11-03).
 *
 * The Working cards are MineJobFace now (thumb, title, date, ONE status line,
 * the 8-step bar, ONE button), not the old collapsed card this file draws
 * above (category tab, title bar, status strip). Drawing the old card made
 * every row jump when the list landed. Measured in the mocked harness at 375
 * (helper, warm reload, route chunks held): placeholder 130px against real
 * cards of 166 / 209px, and on prod (Builder 30, 11-03) 130px against done
 * cards of 197px x50, a 67px row jump.
 *
 * So it draws the FACE, in the face's own boxes. Every class string in
 * `MINE_FACE_BOXES` is copied verbatim from MineJobFace.tsx and
 * src/test/mineFaceSkeletonMatchesFace.test.ts fails when either side moves
 * without the other. Text rows are `FaceLine`s: a non-breaking space in the
 * real line's own type class, so the reserved height IS that line's
 * line-height, with the bone laid over it. The button is a bone in the real
 * button's box (`size="sm"` is h-11), never a control.
 *
 * Two shapes, because a Working card is one of two by design:
 *   - with the bar (hired, scheduled, live, done): 197px at 375, the done
 *     bucket's one shape on prod;
 *   - without it (`tracker={false}`): a pending application has no bar
 *     (AppliedJobCard draws `faceProgress` only for the hired Helpr), 166px.
 */
export const MINE_FACE_BOXES = {
  frame: "flex flex-col px-3.5 py-3 md:flex-row md:flex-wrap md:items-center md:gap-x-6 md:gap-y-2",
  faceCol: "order-1 min-w-0 md:order-none md:flex-1",
  thumb: "h-11 w-11 shrink-0 overflow-hidden rounded-xl",
  titleRow: "flex items-start justify-between gap-3 md:justify-start md:gap-4",
  title: "line-clamp-2 min-w-0 text-ds-16 font-bold leading-snug",
  money: "block text-ds-17 font-bold leading-snug",
  when: "mt-0.5 block text-ds-13",
  under: "space-y-1 pl-[56px] pt-1",
  status: "font-sans text-ds-13 font-semibold",
  progress: "order-2 pt-2 md:order-none md:basis-full md:pt-0",
  seg: "block h-1.5 rounded-full",
  stepWord: "mt-1 flex min-w-0 items-center justify-center gap-0.5 text-ds-11 leading-tight",
  button: "order-3 mt-2 w-full rounded-full md:mt-0 md:w-auto md:min-w-40 md:px-6 md:shrink-0 md:order-none",
  /** JobCardMetaRow's two wrappers: a hired card's street address replaces the date line and sits above the status. */
  metaOuter: "flex items-center text-ds-11",
  metaRow: "flex items-center min-w-0 flex-1 overflow-hidden",
  metaWrap: "flex-wrap gap-y-1 md:flex-nowrap",
  /** The full address takes a line of its own on a phone (JobCardMetaRow's `basis-full`). */
  metaAddress: "basis-full shrink-0 max-w-full md:basis-auto md:shrink md:min-w-0",
} as const;

/** One text row: the real line's type class holds a non-breaking space (its exact line-height), the bone sits over it. */
function FaceLine({ type, width, className = "" }: { type: string; width: string; className?: string }) {
  return (
    <div className={`relative ${type} ${className}`} data-face-line="">
      {"\u00a0"}
      <Skeleton className="absolute left-0 top-[22%] bottom-[22%] rounded" style={{ width }} />
    </div>
  );
}

export function MineFaceSkeleton({ tracker = true, address = false }: { tracker?: boolean; address?: boolean } = {}) {
  const B = MINE_FACE_BOXES;
  return (
    <div
      className={JOB_CARD_SHELL_FRAME}
      aria-hidden
      data-mine-face-skeleton={`${tracker ? "bar" : "no-bar"}${address ? " address" : ""}`}
    >
      <div className={B.frame}>
        <div className={B.faceCol}>
          <div className="flex min-w-0 items-start gap-3">
            <Skeleton className={`${B.thumb} rounded-xl`} />
            <div className="min-w-0 flex-1">
              <div className={B.titleRow}>
                {/* Two title lines on a phone (a real title wraps at ~22 characters there), one from 768px. */}
                <div className="min-w-0 flex-1 md:flex-none md:w-[40%]">
                  <FaceLine type={B.title} width="92%" />
                  <FaceLine type={B.title} width="60%" className="md:hidden" />
                </div>
                <div className="shrink-0">
                  <FaceLine type={B.money} width="100%" className="w-12" />
                </div>
              </div>
              {/* A card with its street address on the face prints no date line here: the meta row below carries it. */}
              {!address && <FaceLine type={B.when} width="45%" />}
            </div>
          </div>
          <div className={B.under}>
            {address && (
              <div className={B.metaOuter} data-face-meta="">
                <div className={`${B.metaRow} ${B.metaWrap}`}>
                  <FaceLine type="text-ds-11" width="80%" className={`${B.metaAddress} md:w-64`} />
                  <FaceLine type="text-ds-11" width="7rem" className="w-28" />
                </div>
              </div>
            )}
            <FaceLine type={B.status} width="62%" />
          </div>
        </div>
        <Skeleton className={`${B.button} h-11`} />
        {tracker && (
          <div className={B.progress}>
            <div className="grid grid-cols-8 gap-1">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="min-w-0">
                  <Skeleton className={B.seg} />
                  <div className={B.stepWord}>{"\u00a0"}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Which face a list's cards wear, by status filter (Q833). The shape is decided by the card's state, so the bones
 * follow the bucket the filter shows:
 *   - Working "All" opens on Needs You / Scheduled (ActivityBucketGroups: done and cancelled start folded), and those
 *     cards are hired or offered: the street address on the face (AppliedJobCard `addressOnFace`) and the bar.
 *   - Waiting is pending applications: no bar, no address. Cancelled draws no bar (MineJobFace hides a cancelled bar).
 *   - Done carries the bar and prints the date, not the street.
 *   - Posted cards never put the address on the face (it is the poster's own; the meta row opens with the card).
 */
export function faceShapeFor(side: "applied" | "posted", filter: string | null): { tracker: boolean; address: boolean } {
  const f = filter || "all";
  const tracker = f !== "waiting" && f !== "cancelled";
  const address = side === "applied" && (f === "all" || f === "needs_you" || f === "scheduled");
  return { tracker, address };
}

/**
 * The Working / Posted list's bones: four face cards, and on the grouped "All" view the first bucket's heading above
 * them (ActivityBucketGroups: a `text-ds-13` heading, `gap-2` to its list), so the first card starts where the real
 * one does.
 */
export function FaceListBones({ side, filter }: { side: "applied" | "posted"; filter: string | null }) {
  const shape = faceShapeFor(side, filter);
  const cards = (
    <div className="space-y-list">
      {[1, 2, 3, 4].map((i) => (
        <ApplicationCardSkeleton key={i} {...shape} />
      ))}
    </div>
  );
  if ((filter || "all") !== "all") return cards;
  return (
    <div className="flex flex-col gap-2" data-skeleton-group-heading="">
      <div className="flex items-baseline justify-between px-1">
        <FaceLine type="text-ds-13 font-bold uppercase" width="5.5rem" className="w-full" />
      </div>
      {cards}
    </div>
  );
}

/** The Working tab's bones (kept name: JobListPage and JobsSectionSkeleton import it). */
export function WorkingListBones({ filter }: { filter: string | null }) {
  return <FaceListBones side="applied" filter={filter} />;
}

/** The Posted tab's bones: PostedJobCard is MineJobFace too (Q833), so /posts stops drawing the old collapsed card. */
export function PostedListBones({ filter }: { filter: string | null }) {
  return <FaceListBones side="posted" filter={filter} />;
}

/**
 * The applied side's card placeholder. The name and path are kept (the prod
 * spec e2e/prod-audit/activity-loading-reserve.spec.ts and listPitchToken name
 * it); since Q833 it is the MineJobFace drawing above, and /posts draws the same face (PostedListBones).
 */
export function ApplicationCardSkeleton({ tracker = true, address = false }: { tracker?: boolean; address?: boolean } = {}) {
  return <MineFaceSkeleton tracker={tracker} address={address} />;
}

/*
 * Q700 (owner, 2026-09-27): "the /jobs collapsed-card skeleton reserves the
 * one-line shape (~131px), /posts keeps two lines."
 *
 * A collapsed card is 131px when its meta prints a city (one line) and 151px
 * when it prints a street address the reader may see (JobCardMetaRow gives an
 * address `basis-full`, a line of its own). No static placeholder is within
 * the 8px row budget of both. On /jobs a pending applicant sees a masked
 * "City, ST" and done/cancelled cards print the city, so the one-line shape is
 * what the helper's list mostly is (prod-audit 36211342059: the first 7 cards
 * in view at 375 were all 131px). /posts (ActivityCardSkeleton) keeps the
 * default two lines.
 */
