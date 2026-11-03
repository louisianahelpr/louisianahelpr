import { Skeleton } from "@/components/ui/skeleton";
import { JOB_CARD_SHELL_FRAME } from "@/components/job-card/JobCardShell";

/*
 * The old COLLAPSED ACTIVITY CARD placeholder (`CollapsedActivityCardSkeleton`, re-exported as
 * `ActivityCardSkeleton` from SkeletonLoaders) lived here until 2026-11-03. Once the Working and Posted cards
 * both became MineJobFace (Q833) no list drew it, only its own tests, so it went. Its history (the 220px and
 * 106px boxes it replaced in 2026-09) is in git: `git log -S CollapsedActivityCardSkeleton`.
 */

/**
 * THE WORKING TAB'S PLACEHOLDER (/jobs?tab=working), Q833 (2026-11-03).
 *
 * The Working cards are MineJobFace now (thumb, title, date, ONE status line,
 * the 8-step bar, ONE button), not the old collapsed card this file used to
 * draw (category tab, title bar, status strip). Drawing the old card made
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
  /** JobCardMetaRow's two wrappers: a hired card's street address replaces the date line and sits above the status.
   *  The face passes `oneLine`, so address, date and time share ONE line at every width (measured, mocked harness:
   *  28px at 375 and 1440). */
  metaOuter: "flex items-center text-ds-11",
  metaRow: "flex items-center min-w-0 flex-1 overflow-hidden",
  metaWrap: "flex-nowrap",
  /** That line's height: the press-to-map button's 44px floor (index.css: every button is min-height 44px) less its
   *  `-my-2` (8px above and below) is 28px, taller than the 16px text beside it. */
  metaLine: "h-7",
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
                  <FaceLine type="text-ds-11" width="70%" className={`${B.metaLine} flex-1 md:flex-none md:w-80`} />
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
function faceShapeFor(side: "applied" | "posted", filter: string | null): { tracker: boolean; address: boolean } {
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
function FaceListBones({ side, filter }: { side: "applied" | "posted"; filter: string | null }) {
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
      {/* ActivityBucketGroups' heading row: 28px (min-h-7) whether or not it carries "See all". */}
      <div className="flex min-h-7 items-center justify-between px-1">
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
