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
  rightSlot?: ReactNode;
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
    | "2xl-5xl-7xl"
    | "container-lg-5xl-6xl";
  /**
   * Set when a sibling header (e.g. DashboardHeader) already sits ABOVE this
   * PageHeader and has already cleared the notch/status-bar safe-area inset.
   * Without this, PostJob-style pages that stack DashboardHeader + PageHeader
   * double-count `env(safe-area-inset-top)` and render a large dead band
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
  default: { outer: "max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] px-5 lg:px-8 xl:px-12" },
  lg: { outer: "max-w-lg px-5 lg:px-8" },
  "2xl": { outer: "max-w-2xl px-5 lg:px-8" },
  "3xl": { outer: "max-w-3xl px-5 lg:px-8" },
  "4xl": { outer: "max-w-4xl px-5 lg:px-8" },
  "5xl": { outer: "max-w-5xl px-5 lg:px-8" },

  // Fixed max-w-5xl body on the wider document gutter ladder.
  // Bodies: HomeHistory, WorkRecord, BenefitsPage.
  "5xl-p4": { outer: "max-w-5xl px-4 lg:px-8 xl:px-12" },

  // Single mobile column that opens into a two-column desktop layout.
  // Body: PetProfiles.
  "lg-5xl-6xl": { outer: "max-w-lg lg:max-w-5xl xl:max-w-6xl px-5 lg:px-8" },

  // Same, with a tablet step. Body: StrSettings.
  "lg-2xl-5xl-6xl": { outer: "max-w-lg md:max-w-2xl lg:max-w-5xl xl:max-w-6xl px-4 md:px-6 lg:px-8" },

  // As above but the gutter narrows again at lg (`lg:px-4`) instead of growing.
  // Body: FamilyDashboard — kept verbatim rather than normalised to lg:px-8,
  // which would have taken 32px off that page's content column.
  "lg-2xl-5xl-6xl-tight": { outer: "max-w-lg md:max-w-2xl lg:max-w-5xl xl:max-w-6xl px-4 md:px-6 lg:px-4" },

  // Wide-reading body that grows to 7xl on large desktops. Body: PayItForward.
  "2xl-5xl-7xl": { outer: "max-w-2xl lg:max-w-5xl xl:max-w-7xl px-5 lg:px-8" },

  // Nested geometry: gutter outside the ladder. Body: UserProfile
  // (`container mx-auto px-5` > `max-w-lg lg:max-w-5xl xl:max-w-6xl mx-auto`).
  "container-lg-5xl-6xl": {
    outer: "container px-5",
    inner: "max-w-lg lg:max-w-5xl xl:max-w-6xl",
  },
};

const PageHeader = ({ title, meta, onBack, rightSlot, hideBack = false, showBrand = false, width = "default", topInsetHandled = false }: PageHeaderProps) => {
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

      {frame(
        "pt-3 pb-2",
        absorbSafeArea ? { paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" } : undefined,
        <>
          {/* Back button sits to the LEFT of the title block (not stacked above
              it) so the chevron reads as a lead-in to the heading and the title
              stays the dominant element. Vertically centered against the whole
              eyebrow/title/meta stack. Consistent across every PageHeader page. */}
          <div className="flex items-center gap-3">
            {!hideBack && (
              <div className="shrink-0">
                <BackButton onClick={onBack} />
              </div>
            )}
            <div className="flex flex-col leading-none min-w-0 mb-1">
              {/* Eyebrow render intentionally removed (2026-07-25 decision):
                  the small burnt-sienna uppercase kicker above the title read as
                  redundant noise app-wide (FRESH TODAY / POSTED JOBS / ACTIVITY
                  TREND, …). The `eyebrow` prop is kept in the type so the ~140
                  existing call sites don't have to churn and the label is a
                  one-line restore if we ever want it back — it just no longer
                  paints. `meta` still renders below the title. */}
              <h1 className="text-page-title leading-tight mt-1 text-balance">
                {title}
              </h1>
              {meta && (
                <span
                  className="font-serif italic mt-0.5 text-ds-12"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  {meta}
                </span>
              )}
            </div>
          </div>
        </>,
      )}
    </>
  );
};

export default PageHeader;
