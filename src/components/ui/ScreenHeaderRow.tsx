import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * ScreenHeaderRow — the ONE header row the panelled screens share.
 *
 * My Posts / My Jobs (`ActivityHeader`) and the Browse feed
 * (`BrowseTasksToolbar`) render the same row: the screen's name on the left,
 * an optional small state label beside it, and an icon cluster (search ·
 * filters) pinned to the trailing edge. This component IS that row, so the two
 * screens cannot drift apart on the geometry that makes them read as one
 * family — the 44px floor, the `gap-3`, the `gap-1` action cluster, the
 * `min-w-0` + truncate on the title, and the `shrink-0` on everything that
 * must never be what gets cut.
 *
 * It owns the row's INSIDE only. The surface it sits on stays the caller's:
 * ActivityHeader is mounted as PageScaffold's `titleCard` (so the card gives
 * it its liquid-glass background, radius and `px-5`), while the browse toolbar
 * renders it as the first row inside the panel with its own `px-4`. Pass those
 * through `className` / `style`.
 *
 * 44px, not 52: the row's tallest content is a 44px icon button (every
 * `<button>` is floored at 44×44 by the HIG rule in index.css), so anything
 * above 44 is dead space between the screen name and the first row of content.
 *
 * `children` replaces the title + actions for the inline-search state both
 * screens have, WITHOUT giving up the row geometry — and the title still
 * renders `sr-only`, because swapping a visible h1 for a text input used to
 * leave the screen with ZERO headings for as long as search was open. "Exactly
 * one h1 per screen" has to hold in every state, not just at rest.
 */
const SCREEN_HEADER_ROW_MIN_HEIGHT = "44px";

/**
 * THE MAGNIFIER'S LANDING SLOT — the whole of the three-click fix.
 *
 * Owner, 2026-09-19 (/my-posts): "the x on search needed to be clicked 3 times
 * to close the search bar". The state machine was never the problem (proved by
 * instrumentation, see src/test/searchDismissAndOverlay.test.tsx): one press
 * already clears the query and closes the field. The problem is WHERE the
 * magnifier comes back.
 *
 * The arithmetic, and it is invariant — it does not depend on how many icons
 * the cluster holds. Write `W` for the magnifier's box, `cg` for the cluster's
 * own gap and `g` for the gap between the field and the cluster. The trailing
 * cluster is right-aligned, so dropping the magnifier from it while the field
 * is open pulls every remaining icon `W + cg` to the right, and the field's
 * trailing edge follows:
 *
 *     fieldRight      = closedCluster.left + W + cg - g
 *     magnifier.left  = closedCluster.left
 *     ✕.right         = fieldRight - inset            (inset ≈ 10px)
 *
 * so ✕.right - magnifier.left = W + cg - g - inset, which for this app's own
 * numbers (44 + 4 - 12 - 10) is +26px of OVERLAP, with the ✕'s visual centre
 * landing INSIDE the magnifier's box. One tap closes; the magnifier
 * materialises under the finger; the next tap re-opens. Close, re-open, close
 * — three taps for one intent. Measured at 375 on /my-posts before this
 * change: ✕ at 224…268, the trigger returning at 242…286.
 *
 * Shrinking the ✕ cannot fix it: the ✕ is anchored to the field's RIGHT edge,
 * so a narrower box moves its left edge, never its right. The only lever is
 * the field's trailing edge — so the row HOLDS THE MAGNIFIER'S SLOT OPEN while
 * the field is up. The field then stops exactly where the magnifier will come
 * back to, which is also, word for word, what the owner asked for on Home:
 * "it needs to open where it was clicked, open slightly to the left of the
 * icon so it doesn't cover anything."
 *
 * `width` must match the trigger's own box — 44px for a HIG icon button, 40px
 * for the Browse cluster's `h-10 w-10`, 28px for the desktop-website row's
 * `h-7 w-7`. Pass the trigger's actual size, not a guess: the clearance this
 * buys is `width + clusterGap - rowGap - inset`, and a slot that is too narrow
 * hands the overlap straight back.
 *
 * Measured after, at 320 / 375 / 1440 on every surface that has one, by
 * e2e/prod-audit/expanding-search-geometry.spec.ts — which also deletes this
 * element from the live DOM and fails unless the overlap comes straight back.
 */
export const SEARCH_TRIGGER_SLOT_WIDTH = "44px";

/**
 * The width below which `narrowTitleStepsAside` takes the visible title out of
 * the open-search row, and the floor that decision is made against.
 *
 * Exported for the guard that proves the field stays typable
 * (`src/test/activityHeaderPhoneWidthBudget.test.ts`), which derives both from
 * here rather than restating them. The Tailwind class beside the title is a
 * LITERAL — `min-[500px]:block` — because a template built from this constant
 * compiles to no rule at all and would hide the title at every width.
 */
export const NARROW_TITLE_ASIDE_PX = 500;
/**
 * THE FLOOR: a field narrower than this cannot show a word while you type it.
 *
 * The field carries the magnifier at `pl-9` and the ✕ at `pr-10`, so 76px of
 * its width is chrome before a character is drawn. 120px therefore leaves
 * ~44px of text — about six characters at the field's 13px — which is the
 * least that can still be read back. The row as shipped gives the field
 * `rowWidth - 104` once the title steps aside: 134px at 320, 189px at 375,
 * 228px at 414, and 220px at 500 where the title comes back.
 *
 * What it is really guarding is the REGRESSION, not the aesthetics: before the
 * title stepped aside the same field measured 76px at 320 and 95px at 375,
 * with the ✕ drawn ON TOP of the magnifier at 320 (a -26px gap between them),
 * and "oak tree" typed into it rendered as "ree". Any new fixed-width item on
 * this row takes its width from the field, because the field is the only
 * flexible thing on it — so the floor is where that shows up.
 */
export const MIN_TYPABLE_FIELD_PX = 120;

export function SearchTriggerSlot({
  width = SEARCH_TRIGGER_SLOT_WIDTH,
}: {
  width?: string;
}) {
  return (
    <div
      aria-hidden
      data-search-trigger-slot
      className="shrink-0 pointer-events-none"
      style={{ width, alignSelf: "stretch" }}
    />
  );
}

export interface ScreenHeaderRowProps {
  /** The screen's name — rendered as its single `<h1>`. */
  title: string;
  /**
   * Render the h1 for screen readers only. Home does: it shows the brand
   * emblem and nothing else (owner decision, "home will not have a title just
   * the H logo"). The heading is hidden, never dropped.
   */
  titleSrOnly?: boolean;
  /**
   * Small live-state label placed to the right of the title, on its baseline
   * — "· 2 Active" on My Posts, "Filtered · 3 active" on Browse. Fully styled
   * by the caller; this row only positions it (and keeps it `shrink-0`, so a
   * long title yields first and the thing telling you what you are looking at
   * is never what gets cut).
   */
  meta?: ReactNode;
  /** Trailing icon cluster — search, filters. */
  actions?: ReactNode;
  /** Inline-search content, replacing title + actions for that state. */
  children?: ReactNode;
  /**
   * THE EXPANDING SEARCH, as one shape for every screen that has one.
   *
   * Three screens used to hand-roll this state on top of the row — My Posts /
   * My Jobs through `children`, the Messages inbox through its `rowTakeover`,
   * and the Browse desktop strip through a ternary that swapped the whole row
   * out. Three arrangements of the same idea is how the ✕ ended up over the
   * magnifier on one of them and over the jobs count on another.
   *
   * What this slot guarantees, and what none of the three did on its own:
   *
   *   1. the screen KEEPS ITS NAME while you type into it (the h1 goes
   *      `sr-only`, and a visible `<span>` stands in unless the screen has no
   *      visible title at all);
   *   2. the field takes FREE SPACE, growing leftward out of the trailing
   *      cluster — it never takes a sibling's place, and `leading` content
   *      stays mounted beside it;
   *   3. the magnifier's slot in the cluster is HELD OPEN — see
   *      {@link SearchTriggerSlot} for why that is the whole three-click fix;
   *   4. the rest of the cluster (filters · map · saved · the status chevron)
   *      stays exactly where it was. Opening search hides no other control.
   *
   * Takes precedence over `children` when open, so a screen with BOTH a
   * search takeover and another one (Messages' select mode) keeps the other
   * on `children`.
   */
  expandingSearch?: {
    /** True while the field is up. False renders the ordinary title row. */
    open: boolean;
    /**
     * Content that stays mounted beside the field — the desktop status tabs,
     * the Browse jobs count. `shrink-0` is the caller's job: it is what makes
     * the field yield first.
     */
    leading?: ReactNode;
    /**
     * The field. The magnifier lives INSIDE it on the left and the ✕ inside it
     * on the right (owner, 2026-09-19: "the magnifier should move to the left
     * and the x stay") — so while search is open the ✕ is the only control in
     * the field, and the magnifier is not in the cluster at all.
     */
    field: ReactNode;
    /** Width of the held-open magnifier slot. MUST match the trigger's box. */
    triggerWidth?: string;
    /**
     * ON A NARROW PHONE THE NAME STEPS ASIDE, so the field is typable.
     *
     * ── WHAT THE ROW ACTUALLY HAD, MEASURED AT 375 ON /my-posts ────────────
     *     title 0…132 · field 135…230 (95px) · slot 242…286 · chevron 286…330
     *
     * 95px of field, and the magnifier and the ✕ live INSIDE it (a 36px inset
     * between them), so the typing area was ~59px: you could not see the word
     * you were searching for. Every other claimant on that row is fixed-width
     * — a 20px display title at its natural size, a 44px held-open slot, a
     * 44px status chevron and three 12px gaps — so the field, the one flexible
     * item, absorbs the whole shortfall. It is the only thing that can.
     *
     * The name is not dropped: the `<h1>` is `sr-only` in this state either
     * way, so the screen keeps exactly one heading and a screen-reader user
     * still hears where they are. What steps aside is its VISIBLE twin, and
     * only while the field is open, and only below 500px — which is where
     * the arithmetic says the field falls under 200px with the title present
     * (132 + 36 of gaps + 88 of cluster + 200 = 456, plus the 42px the page
     * gutters and card padding take = 498). At 500 and up nothing changes.
     *
     * Opt-in, not automatic: Browse's strip has no title in this state at all
     * and the Messages inbox is its own measurement. A row that has not been
     * measured does not get a behaviour change on a guess.
     */
    narrowTitleStepsAside?: boolean;
    /** The cluster minus the magnifier. Never unmounted by search. */
    actions?: ReactNode;
  };
  className?: string;
  style?: CSSProperties;
}

export function ScreenHeaderRow({
  title,
  titleSrOnly = false,
  meta,
  actions,
  children,
  expandingSearch,
  className,
  style,
}: ScreenHeaderRowProps) {
  if (expandingSearch?.open) {
    return (
      <div
        className={cn("flex items-center gap-3", className)}
        style={{ minHeight: SCREEN_HEADER_ROW_MIN_HEIGHT, ...style }}
      >
        {/* Exactly one h1 per screen, in EVERY state. Swapping a visible
            heading for a text input used to leave the screen with zero
            headings for as long as search was open. */}
        <h1 className="sr-only">{title}</h1>
        {/* And the screen keeps its name on SCREEN too, for everyone else —
            the one piece of context you need while typing into it. `shrink-0`
            + a 40% cap so the field yields first and the name truncates rather
            than pushing the field off the row. `aria-hidden` because the h1
            above is already the accessible name; this is its visible twin, not
            a second heading. */}
        {!titleSrOnly && (
          <span
            aria-hidden
            className={cn(
              "font-display font-bold text-foreground text-ds-20 leading-none shrink-0 max-w-[40%] truncate",
              // A media query, not a JS width branch: the right arrangement is
              // painted on the first frame, and there is no width state that
              // can go stale behind a resize. The literal is spelled out so
              // Tailwind's scanner can see it (see NARROW_TITLE_ASIDE_PX).
              expandingSearch.narrowTitleStepsAside && "hidden min-[500px]:block",
            )}
          >
            {title}
          </span>
        )}
        {expandingSearch.leading}
        {expandingSearch.field}
        <div className="flex items-center gap-1 shrink-0">
          <SearchTriggerSlot width={expandingSearch.triggerWidth} />
          {expandingSearch.actions}
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn("flex items-center gap-3", className)}
      style={{ minHeight: SCREEN_HEADER_ROW_MIN_HEIGHT, ...style }}
    >
      {children ? (
        <>
          <h1 className="sr-only">{title}</h1>
          {children}
        </>
      ) : (
        <>
          {/* Title and state label on ONE line, label to the right of the name.
              `items-baseline` so the small italic label sits on the wordmark's
              baseline rather than centring against a much larger cap-height. */}
          <div className="flex items-baseline min-w-0 flex-1 gap-2 py-2.5">
            <h1
              className={
                titleSrOnly
                  ? "sr-only"
                  : "font-display font-bold text-foreground text-ds-20 truncate m-0 leading-none min-w-0"
              }
            >
              {title}
            </h1>
            {meta}
          </div>
          <div className="flex items-center gap-1 shrink-0">{actions}</div>
        </>
      )}
    </div>
  );
}
