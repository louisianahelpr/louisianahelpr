import BackButton from "@/components/BackButton";
import HelprMark from "@/components/HelprMark";
import type { CSSProperties, ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Italic Garamond uppercase small-caps eyebrow line above the title. */
  eyebrow?: string;
  /** Italic Garamond meta line below the title — accepts strings or
      JSX (e.g., counts with Sienna-tinted dividers). Use this for the
      editorial brand pattern. */
  meta?: ReactNode;
  onBack?: () => void;
  /**
   * Fallback destination for the back button when there is NO in-app history —
   * i.e. the route was deep-linked or opened cold. Prefer this over
   * `onBack={() => navigate("/somewhere")}`: an onClick handler short-circuits
   * BackButton's history pop, which turns "back" into a forward PUSH. That
   * mints a new history entry, so ScrollToTop's POP branch never runs and the
   * page you return to is rebuilt scrolled to the top.
   */
  backTo?: string;
  /**
   * Actions rendered in a SEPARATE sticky top bar ABOVE the title block.
   * That bar is a second band of chrome, so it only earns its place on a page
   * that also wants the brand mark pinned (`showBrand`). If all you have is a
   * couple of icon actions, use `titleActions` instead — it puts them on the
   * title row and keeps the page to ONE header.
   */
  rightSlot?: ReactNode;
  /**
   * Trailing actions for the title row itself — rendered flush right, on the
   * same line as the back button and the `title`.
   *
   * This exists so a page with header actions does not have to stack a second
   * bar above its own back-button header. UserProfile did exactly that (an app
   * bar carrying message / favourite / overflow, then the "Profile" header
   * beneath it) — two bands of chrome before any content, the same pattern
   * already removed from Messages, Profile, My Jobs, My Posts and PostJob.
   *
   * It also keeps the top safe-area inset correct by construction: `rightSlot`
   * moves the notch clearance onto `.glass-header`, so a page that dropped the
   * bar would lose the inset with it. `titleActions` leaves `showTopBar` false,
   * which is what makes the title block absorb `var(--safe-area-top)` below.
   */
  titleActions?: ReactNode;
  hideBack?: boolean;
  /** Render the pinned brand top-nav (HelprMark on the left, matching the
   *  dashboard's top bar) above the title block. Use on standalone flows
   *  like Post a Task so the app's top nav is present, not just a bare
   *  back button. */
  showBrand?: boolean;
  /**
   * Constrains the header container so the back button + title sit directly
   * above a page body that is a narrower, centered column. Without this the
   * header spans the wide app container and the title floats far to the left
   * of centered content. Pass the SAME max-width the page body uses
   * (`max-w-lg` → "lg", `max-w-2xl` → "2xl", `max-w-5xl` → "5xl") so the title
   * reads as the page's main heading, aligned with the content beneath it.
   * "lg" is the canonical single-column card-list width (Dashboard, Activity,
   * Analytics, Profile) — use it whenever the body is `max-w-lg mx-auto`.
   *
   * The horizontal GUTTER is part of the match, not a detail: with `max-w-*`
   * the padding lives inside the box, so a body on `px-4` under a header on
   * `px-5` puts the title 4px off the content edge. Every value below carries
   * the gutter ladder of the bodies it mirrors — pick the one whose max-width
   * AND px-* ladder equal the body's, or add a new one. Never "fix" a mismatch
   * by shrinking the body: dead side gutters are a hard layout failure here.
   */
  width?:
    | "default"
    | "lg"
    | "2xl"
    | "3xl"
    | "4xl"
    | "5xl"
    // ── Responsive ladders ──────────────────────────────────────────────
    // A fixed max-width can't express a body that widens by breakpoint, and
    // approximating one leaves the title visibly off-column at every other
    // size. These mirror, verbatim, the ladders real page bodies use.
    | "5xl-p4"
    | "lg-5xl-6xl"
    | "lg-2xl-5xl-6xl"
    | "lg-2xl-5xl-6xl-tight"
    | "lg-5xl-6xl-7xl-tight"
    | "2xl-5xl-7xl"
    | "container-lg-5xl-6xl"
    | "public"
    // No container at all — for a header rendered INSIDE a body that has
    // already applied the app's max-width + gutter. See WIDTH_CLASS below.
    | "none";
  /**
   * Set when a sibling header (e.g. DashboardHeader) already sits ABOVE this
   * PageHeader and has already cleared the notch/status-bar safe-area inset.
   * Without this, PostJob-style pages that stack DashboardHeader + PageHeader
   * double-count `var(--safe-area-top, 0px)` and render a large dead band
   * between the top bar and the title block. When true, use plain top padding.
   */
  topInsetHandled?: boolean;
}

/**
 * Container geometry for one `width` value.
 *
 * `outer` is normally the only wrapper. `inner` exists for the one body shape
 * that nests a max-width ladder INSIDE a padded wrapper (`.container px-5` >
 * `max-w-… mx-auto`): there the gutter sits OUTSIDE the max-width, which shifts
 * the content edge relative to the usual `max-w-… px-…` box. The header has to
 * repeat the same nesting to land on the same pixel — flattening it into one
 * class is off by the gutter at every width where the max-width binds.
 */
type WidthSpec = { outer: string; inner?: string };

const WIDTH_CLASS: Record<NonNullable<PageHeaderProps["width"]>, WidthSpec> = {
  default: { outer: "page-measure px-5 lg:px-8 xl:px-12" },
  lg: { outer: "max-w-lg px-5 lg:px-8" },
  "2xl": { outer: "max-w-2xl px-5 lg:px-8" },
  "3xl": { outer: "max-w-3xl px-5 lg:px-8" },
  "4xl": { outer: "max-w-4xl px-5 lg:px-8" },
  "5xl": { outer: "max-w-5xl px-5 lg:px-8" },

  // Fixed max-w-5xl body on the wider document gutter ladder.
  // Bodies: HomeHistory, WorkRecord.
  "5xl-p4": { outer: "max-w-5xl px-4 lg:px-8 xl:px-12" },

  // Single mobile column that opens into a two-column desktop layout.
  // Body: PetProfiles.
  "lg-5xl-6xl": { outer: "max-w-lg lg:max-w-5xl xl:max-w-6xl px-5 lg:px-8" },

  // Same, with a tablet step. Body: StrSettings.
  "lg-2xl-5xl-6xl": { outer: "max-w-lg md:max-w-2xl lg:max-w-5xl xl:max-w-6xl px-4 md:px-6 lg:px-8" },

  // As above but the gutter narrows again at lg (`lg:px-4`) instead of growing.
  // Body: StrSettings-adjacent pages that kept the tighter desktop gutter
  // verbatim rather than normalising to lg:px-8, which would have taken 32px
  // off the content column.
  "lg-2xl-5xl-6xl-tight": { outer: "max-w-lg md:max-w-2xl lg:max-w-5xl xl:max-w-6xl px-4 md:px-6 lg:px-4" },

  // Same tight desktop gutter, on the wider ladder FamilyDashboard's body
  // actually uses. Body: FamilyDashboard — copied from its column verbatim so
  // the back button + h1 land in the same column as the content beneath them.
  "lg-5xl-6xl-7xl-tight": {
    outer: "max-w-lg md:page-measure px-4 md:px-6 lg:px-4",
  },

  // Wide-reading body that grows to 7xl on large desktops. Body: PayItForward.
  "2xl-5xl-7xl": { outer: "max-w-2xl lg:max-w-5xl xl:max-w-7xl px-5 lg:px-8" },

  // The PUBLIC / marketing gutter ladder — `px-5 sm:px-8 lg:px-12`, the same
  // scale the marketing <Navbar> and <Footer> use, over the unbounded
  // `.page-measure` column. It is NOT the `default` ladder: `default` steps at
  // lg/xl (`px-5 lg:px-8 xl:px-12`), so a public page using it would sit 12px
  // in from its own sections between sm and lg and 16px in above xl.
  // Bodies: HelpCenter, Support (and the other `px-5 sm:px-8 lg:px-12`
  // PublicLayout sections).
  public: { outer: "page-measure px-5 sm:px-8 lg:px-12" },

  // NO container. The one legitimate case for this is a header rendered by a
  // panel that is ALREADY inside the page's max-width + gutter box, where any
  // container here would be a second one. Profile's tabs are exactly that:
  // Profile.tsx wraps every tab in `container mx-auto px-5 lg:px-8 xl:px-12`
  // > `page-measure mx-auto`, i.e. the `default` geometry, applied one layer
  // up. Re-applying it here would inset the title by a second full gutter and
  // leave a dead side band — the hard layout failure documented above. The
  // header spans its parent and inherits that column verbatim.
  // Body: every Profile tab (via ProfileTabHeader).
  none: { outer: "" },

  // Nested geometry: gutter outside the ladder. Body: UserProfile
  // (`container mx-auto px-5` > `max-w-lg lg:max-w-5xl xl:max-w-6xl mx-auto`).
  "container-lg-5xl-6xl": {
    outer: "container px-5",
    inner: "max-w-lg lg:max-w-5xl xl:max-w-6xl",
  },
};

// `meta` stays destructured-but-unpainted per the 2026-08-13 owner decision
// recorded in the retirement note below (title only; ~15 call sites still pass it).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PageHeader = ({ title, meta, onBack, backTo, rightSlot, titleActions, hideBack = false, showBrand = false, width = "default", topInsetHandled = false }: PageHeaderProps) => {
  // `eyebrow` is accepted by PageHeaderProps for call-site compatibility but
  // intentionally not destructured/rendered — see the removal note below.
  const { outer, inner } = WIDTH_CLASS[width];

  /**
   * Renders `children` inside the header's container geometry. `className` and
   * `style` always land on the element that carries the max-width, so the flex
   * row's `justify-between` spaces against the content column (not the padded
   * outer wrapper) and the safe-area padding is never double-counted across
   * two nested divs.
   */
  const frame = (className: string, style: CSSProperties | undefined, children: ReactNode) =>
    inner ? (
      <div className={`mx-auto ${outer}`}>
        <div className={`mx-auto ${inner} ${className}`} style={style}>
          {children}
        </div>
      </div>
    ) : (
      <div className={`mx-auto ${outer} ${className}`} style={style}>
        {children}
      </div>
    );

  // The sticky top bar renders when there's brand or a rightSlot to show.
  // Otherwise we skip the empty 48px bar and let the title block absorb the
  // safe-area-top padding — pages like PostJob were paying ~100px of dead
  // space for a header bar that had nothing in it.
  const showTopBar = showBrand || !!rightSlot;
  // Only absorb the safe-area inset when nothing above us has already cleared
  // it: no own top bar AND no sibling header stacked above (topInsetHandled).
  const absorbSafeArea = !showTopBar && !topInsetHandled;
  return (
    <>
      {showTopBar && (
        <header className="glass-header sticky top-0 z-50">
          {frame(
            `flex h-14 items-center gap-2 ${showBrand ? "justify-between" : "justify-end"}`,
            undefined,
            <>
              {showBrand && <HelprMark to="/dashboard" size="md" hideEmblem />}
              {rightSlot && <div className="flex items-center gap-1 shrink-0">{rightSlot}</div>}
            </>,
          )}
        </header>
      )}

      {/* EQUAL AIR ABOVE AND BELOW THE TITLE — one rule, every page.
          THIS COMPONENT OWNS BOTH GAPS: 16px each side on phone, 24px each
          side from `sm` up (owner, 2026-08-30: "24 spacing is too much on a
          phone so the phone and webpage should not be the same" — supersedes
          the earlier "all of these should be 24" pass, which had made it a
          single fixed value). This is the ONE place the value lives; changing
          it moves every page in the app at once, which is the point. Do not
          add padding on either side of it anywhere else.

          The page body below must contribute NO top padding of its own. That
          is the whole contract — a body on `pt-4` under this header stacks a
          second gap onto the bottom and the title is instantly lopsided
          again.

          Two dead ends are recorded here so they are not re-attempted:

          1. It was originally `pt-3 pb-2` with an `mt-1` on the h1 and an
             `mb-1` on its column — FOUR contributors to a two-sided gap.
             Measured 20 above / 32 below on UserProfile.
          2. Then it was `pt-4 pb-0`, on the theory that the page body's own
             `pt-4` should own the bottom gap. That is what most bodies had, so
             it looked right on UserProfile — but it is not universal, and the
             pages without it collapsed to 24 above / 8 below (measured on
             /help, /legal and /pets). A gap whose size depends on
             what the page underneath happens to declare cannot be global.

          So: the header owns both sides, bodies own neither. If a page needs
          more air under its title, it belongs to that page's first section as
          a deliberate exception — never as top padding on the body wrapper,
          which is indistinguishable from the title's own gap. */}
      {frame(
        absorbSafeArea
          // Can't mix a Tailwind breakpoint class with an inline safe-area
          // calc() on the same property, so the safe-area addition is baked
          // into the arbitrary-value class itself at each breakpoint instead
          // of an inline `style` override.
          ? "pt-[calc(var(--safe-area-top,0px)+1rem)] sm:pt-[calc(var(--safe-area-top,0px)+1.5rem)] pb-4 sm:pb-6"
          : "pt-4 pb-4 sm:pt-6 sm:pb-6",
        undefined,
        <>
          {/* Back button sits to the LEFT of the title block (not stacked above
              it) so the chevron reads as a lead-in to the heading and the title
              stays the dominant element. Vertically centered against the whole
              eyebrow/title/meta stack. Consistent across every PageHeader page. */}
          <div className="flex items-center gap-3">
            {!hideBack && (
              <div className="shrink-0">
                <BackButton onClick={onBack} to={backTo} />
              </div>
            )}
            {/* No `mb-1` — see the equal-air note above; the space below the
                title belongs to the page body's `pt-4`, not to this column. */}
            <div className="flex flex-col leading-none min-w-0">
              {/* Eyebrow render intentionally removed (2026-07-25 decision):
                  the small burnt-sienna uppercase kicker above the title read as
                  redundant noise app-wide (FRESH TODAY / POSTED JOBS / ACTIVITY
                  TREND, …). The `eyebrow` prop is kept in the type so the ~140
                  existing call sites don't have to churn and the label is a
                  one-line restore if we ever want it back — it just no longer
                  paints.

                  `meta` is now retired the same way (owner decision
                  2026-08-13): a title sitting next to a back button must not
                  carry a small line beneath it. In practice the meta line was
                  restating the title in smaller type — "Post a job / Pick how
                  you'd like to begin", "My Pets / Care details your Helpr
                  should know" — and on a screen that already has its own body
                  copy it read as a third heading nobody asked for.

                  Prop kept for the same reason as `eyebrow`: ~15 call sites
                  pass it, and neither churning them nor breaking their types
                  buys anything. One line restores it. */}
              <h1 className="text-page-title leading-tight truncate">
                {title}
              </h1>
            </div>
            {/* Trailing actions on the TITLE row, not in a bar of their own.
                `ml-auto` (rather than `justify-between` on the row, or
                `flex-1` on the title column) is deliberate: it pushes the
                actions right without changing a single pixel of layout for the
                ~140 call sites that pass no `titleActions`. `shrink-0` keeps
                the icon buttons at full size when the title is long enough to
                claim the rest of the row. */}
            {titleActions && (
              <div className="ml-auto flex items-center gap-1 shrink-0">{titleActions}</div>
            )}
          </div>
        </>,
      )}
    </>
  );
};

export default PageHeader;
