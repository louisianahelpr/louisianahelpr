import BackButton from "@/components/BackButton";
import HelprMark from "@/components/HelprMark";
import type { ReactNode } from "react";

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
   * Analytics, Profile, STR Settings, Family) — use it whenever the body is
   * `max-w-lg mx-auto`.
   */
  width?: "default" | "lg" | "2xl" | "5xl";
  /**
   * Set when a sibling header (e.g. DashboardHeader) already sits ABOVE this
   * PageHeader and has already cleared the notch/status-bar safe-area inset.
   * Without this, PostJob-style pages that stack DashboardHeader + PageHeader
   * double-count `env(safe-area-inset-top)` and render a large dead band
   * between the top bar and the title block. When true, use plain top padding.
   */
  topInsetHandled?: boolean;
}

const WIDTH_CLASS: Record<NonNullable<PageHeaderProps["width"]>, string> = {
  default: "max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] px-5 lg:px-8 xl:px-12",
  lg: "max-w-lg px-5 lg:px-8",
  "2xl": "max-w-2xl px-5 lg:px-8",
  "5xl": "max-w-5xl px-5 lg:px-8",
};

const PageHeader = ({ title, eyebrow, meta, onBack, rightSlot, hideBack = false, showBrand = false, width = "default", topInsetHandled = false }: PageHeaderProps) => {
  const containerWidth = WIDTH_CLASS[width];

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
          <div className={`mx-auto flex h-14 items-center gap-2 ${containerWidth} ${showBrand ? "justify-between" : "justify-end"}`}>
            {showBrand && <HelprMark to="/dashboard" size="md" />}
            {rightSlot && <div className="flex items-center gap-1 shrink-0">{rightSlot}</div>}
          </div>
        </header>
      )}

      <div
        className={`mx-auto ${containerWidth} pt-3 pb-2`}
        style={absorbSafeArea ? { paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" } : undefined}
      >
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
            {eyebrow && (
              <span
                className="font-serif italic uppercase text-[0.62rem]"
                style={{
                  color: "hsl(var(--burnt-sienna))",
                  letterSpacing: "0.18em",
                }}
              >
                {eyebrow}
              </span>
            )}
            <h1 className="text-page-title leading-tight mt-1 text-balance">
              {title}
            </h1>
            {meta && (
              <span
                className="font-serif italic mt-0.5 text-[0.78rem]"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {meta}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default PageHeader;
