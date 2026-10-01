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
 * The landing's identity card, as bones: IdentityHeader's own box
 * (`liquid-glass p-card`), its 88px ROUND avatar beside the name/location/bio
 * column, and the `mt-3.5 grid grid-cols-4 gap-2` row of 64px tiles (Share,
 * rating, Edit, Preview) INSIDE the card.
 *
 * It used to be a 75px rounded-square avatar in a `p-4` card with no tiles,
 * followed by a separate 3-up grid of 78px menu tiles the landing no longer
 * has. Measured on prod 2026-10-01 at 375 (customer and helper /profile #0):
 * the column's middle row went 80px → 201px (+121), 3 rows → 4, and the round
 * avatar arrived out of nothing (media 0 → 1).
 */
const IdentityCardSkeleton = () => (
  <div className="relative liquid-glass shrink-0 p-card overflow-hidden">
    <div className="flex flex-row items-center gap-4">
      <Skeleton className="w-[88px] h-[88px] rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-3 w-1/2 rounded-md" />
        <Skeleton className="h-3 w-full rounded-md" />
        <Skeleton className="h-3 w-3/4 rounded-md" />
        <Skeleton className="h-4 w-20 rounded-md" />
      </div>
    </div>
    <div className="mt-3.5 grid grid-cols-4 gap-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="min-h-[64px] rounded-ds-md" />
      ))}
    </div>
  </div>
);

/**
 * The landing's settings list, as bones: SettingsSection's quiet eyebrow over
 * one `rounded-ds-lg liquid-glass` card of 64px rows (`py-3` around a 40px
 * icon tile, then a title and a description line). Enough rows to fill a
 * phone screen; the real list runs on below the fold.
 */
const SettingsListSkeleton = () => (
  <div className="space-y-4">
    <div>
      <div className="px-1 pb-1.5 h-[21px] flex items-center">
        <Skeleton className="h-2.5 w-12 rounded-md" />
      </div>
      <div className="rounded-ds-lg liquid-glass overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3.5 pl-4 pr-3.5 py-3">
            <Skeleton className="w-10 h-10 rounded-ds-md shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3 w-1/3 rounded-md" />
              <Skeleton className="h-2.5 w-2/3 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

/**
 * The landing's PAGE TITLE, as bones.
 *
 * The landing renders a real `<PageHeader>`, so its skeleton carries the
 * same title row; without it the identity card would paint higher than the
 * screen that replaces it.
 *
 * Horizontally the bar starts on the column edge, like the real title (the
 * owner's "line up with the card", 2026-09-25): no back slot is reserved.
 * The vertical values (`--shell-gap` on phone, `sm:pt-6 sm:pb-6`) are copied from
 * PageHeader's "equal air above and below" block. The bar's height is the
 * title's own line box, `--headline-hero` x `.text-page-title`'s 1.1
 * line-height (25px at 375, 27px at 1440), so it is exact at every width; a
 * fixed `h-7` made the row 52px against the real 49 at 375.
 *
 * `-mb-3 lg:-mb-4` is the landing's own (ProfileLanding.tsx): it cancels the
 * column gap under the title so the air below it equals the air above.
 */
const LandingTitleSkeleton = () => (
  <div className="-mb-3 lg:-mb-4">
    <div className="pt-[var(--shell-gap)] pb-[var(--shell-gap)] sm:pt-6 sm:pb-6 flex items-center gap-3">
      <Skeleton className="h-[calc(var(--headline-hero)*1.1)] w-44 rounded-md" />
    </div>
  </div>
);

/**
 * Full Profile-landing skeleton: the landing's column, child for child.
 *
 * ProfileLanding renders into Profile.tsx's `flex flex-col gap-3 lg:gap-4`
 * column: title, identity card, the "Finish setting up" row, the settings
 * list. This draws the same four children with the same gap, so each bone
 * holds the slot its content lands in.
 *
 * The setup row is CONDITIONAL in the real landing (it disappears once payout
 * and identity are both done); the bone is always drawn, because whether it
 * shows is not known until the profile and the Stripe status load, and the
 * state every new member starts in is "something left to set up". A finished
 * account sees the list rise 64px on load.
 */
export const ProfilePageSkeleton = () => (
  <div className="flex flex-col gap-3 lg:gap-4">
    <LandingTitleSkeleton />
    <IdentityCardSkeleton />
    <Skeleton className="h-[52px] rounded-ds-md" />
    <SettingsListSkeleton />
  </div>
);
