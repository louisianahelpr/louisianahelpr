import { Skeleton } from "@/components/ui/skeleton";
import { CollapsedActivityCardSkeleton } from "@/components/ui/skeletons/ApplicationCardSkeleton";

/**
 * `JobCardSkeleton` LIVED HERE and does not any more (2026-09-20).
 *
 * There were TWO components with that name in this repo: this one, and
 * src/components/ui/skeletons/JobCardSkeleton.tsx — which is the real one,
 * built by IMPORTING JobCard's own exported geometry so the reserved space is
 * the real space by construction. This copy was a hand-drawn approximation of
 * a job card with a chip row, a metadata grid and an apply-button footer, and
 * its only two callers were Home History and Work Record, where what actually
 * arrives is a service-record card and a one-page letterhead document. Two
 * different shapes under one name, neither matching what it stood in for.
 *
 * Both callers now render ProfileTabBodyReserve — the same placeholder they
 * had shown a moment earlier while the tab's chunk loaded. Import
 * `JobCardSkeleton` from @/components/ui/skeletons/JobCardSkeleton; there is
 * exactly one now.
 */

/**
 * THE POSTED TAB'S PLACEHOLDER — /posts, and Activity's posted Suspense
 * fallback. Those are its only two call sites, and both stand in front of the
 * same list of PostedJobCards.
 *
 * ── WHAT IT DREW BEFORE, AND WHAT THAT COST ──────────────────────────────
 * A hand-drawn `rounded-ds-md skeleton-glass p-4` box: a title bone, two chip
 * bones, a button bone and two meta bones. No card frame, no category rail, no
 * category tab, and none of the card's own padding — for a PostedJobCard built
 * out of exactly the same primitives AppliedJobCard is (JobCardShell +
 * JobCardTitleBar + JobCardMetaRow + JobStatusStrip).
 *
 * Measured at 375 against prod (poster-e2e, 2026-09-21):
 *
 *     placeholder row   106px
 *     real row          151px
 *     ────────────────────────
 *     per row           -45px, and it compounds down the list — every card
 *                       below the first one moves when the data lands.
 *
 * Invisible to CLS for the reason `ApplicationCardSkeleton` documents at
 * length: the Layout Instability API only scores elements that were in the
 * previous frame and MOVED, and a skeleton→content swap removes one subtree
 * and inserts another. /jobs measured CLS 0.0000 across ZERO entries while
 * every card on it slid up to 195px. Boxes, not CLS.
 *
 * ── WHAT IT DRAWS NOW ────────────────────────────────────────────────────
 * `CollapsedActivityCardSkeleton`, which is the drawing /jobs took on
 * 2026-09-21 (commit 21dad148b): the collapsed card's title bar, two meta
 * lines and status strip, each sized from `JobCardShell`'s own exported
 * geometry rather than redrawn. ONE drawing, because there is one card — the
 * posted and applied collapsed cards are the same shell at the same 151px, and
 * two hand-written descriptions of one box is how they drifted apart.
 */
export const ActivityCardSkeleton = CollapsedActivityCardSkeleton;

/**
 * Dashboard panel-interior skeleton. Renders the SAME three-section
 * structure the loaded panel has — Picked-for-you / Nearby / Everything
 * else — each with its own shape-matched card skeleton variant. A single
 * uniform skeleton row across all three sections looked like one flat
 * list and caused a layout jump when the real, differently-sized cards
 * arrived; per-section variants reserve the right footprint up front so
 * the swap is silent (no CLS, no scroll-position re-anchor).
 */
export const DashboardSkeleton = () => (
  <>
    {/* CALM. This used to render the feed's real section headers — "Picked for
        you" and "Everything else", live colour, real icons, a real hairline
        rule — wrapped around ghost cards each built from six grey bars of
        differing widths, plus a header row with two button squares. Finished
        chrome around unfinished content reads as a BROKEN page, not a loading
        one, and the bar lattice gave it more visual detail than the real feed
        it stands in for.

        A skeleton's whole job is to hold the shape and then get out of the way.
        So: no invented section labels (they may not even be the sections that
        arrive), one soft silhouette per card instead of six bars, and the
        card's own footprint carried by height alone. The layout still reserves
        the same space, so nothing jumps when the feed lands. */}
    {/* FILL, not `.skeleton-glass`. These cards sit inside a PageScaffold
        panel that is ALREADY an opaque white raised surface, and
        `.skeleton-glass` is `hsla(0,0%,100%,0.42)` over a 20px backdrop blur
        (src/index.css:2541) — white-on-white at 0.42, i.e. nothing. Measured
        cold at 375/slow-3G the feed panel read as BLANK WHITE for the whole
        ~20s wait and the real cards appeared to pop out of nothing.

        `Skeleton` is the house primitive and already carries the house fill
        (`hsl(var(--olivewood)/0.10)`) plus the shimmer sweep, and it inverts
        with the theme, so the ghost cards now use it directly rather than a
        bare div. The hairline is the same `--olivewood` token at the opacity
        JobCardSkeleton's own footer rule uses, so the silhouette has an edge
        on the panel in both themes.

        Deliberately LOCAL. `.skeleton-glass` has exactly three call sites in
        the repo — JobCardSkeleton (line 9), ActivityCardSkeleton (line 40) and
        this one — and the other two are correct where they sit; changing the
        shared class to fix one surface is the blanket-edit mistake. */}
    <div className="px-3 pt-3 pb-1 space-y-2.5 lg:space-y-4" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton
          key={i}
          className="rounded-2xl h-[104px] border border-[hsl(var(--olivewood)/0.12)]"
          style={{ borderRadius: "1rem" }}
        />
      ))}
    </div>
  </>
);

/**
 * The Profile landing's skeleton (`ProfilePageSkeleton`) LIVED HERE and moved
 * to src/components/profile/ProfilePageSkeleton.tsx on 2026-10-12 (Q1173): it
 * now draws the landing's real title and its real Work rows, which need
 * PageHeader, lucide icons and the settings-row markup. This file stays
 * import-light for the screens that pull it in eagerly.
 */
