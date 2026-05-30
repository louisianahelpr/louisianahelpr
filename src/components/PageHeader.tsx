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
  /** Render the pinned brand top-nav bar (Helpr·LA wordmark on the left),
      matching the primary pages (Dashboard). Use on document-scroll pages
      that should keep the standard sticky top nav rather than dropping
      straight into the title block. */
  showBrand?: boolean;
}

const PageHeader = ({ title, eyebrow, meta, onBack, rightSlot, hideBack = false, showBrand = false }: PageHeaderProps) => {

  // When no rightSlot is provided, skip the empty 48px sticky bar and let
  // the title block absorb the safe-area-top padding instead. Pages like
  // PostJob were paying ~100px of dead space at the top of the viewport
  // for a header bar that had nothing in it.
  //
  // `showBrand` opts a page back into the pinned top nav — the brand mark
  // on the left and any rightSlot controls on the right — so it matches the
  // Dashboard's sticky header instead of feeling chromeless.
  const showBar = showBrand || !!rightSlot;
  return (
    <>
      {showBar && (
        <header className="glass-header sticky top-0 z-50">
          <div className="mx-auto flex h-12 max-w-5xl lg:max-w-6xl 2xl:max-w-7xl items-center justify-between gap-2 px-5 lg:px-8 xl:px-12">
            {showBrand ? (
              <HelprMark to="/dashboard" size="sm" />
            ) : (
              <span />
            )}
            {rightSlot && <div className="flex items-center gap-1 shrink-0">{rightSlot}</div>}
          </div>
        </header>
      )}

      <div
        className="mx-auto max-w-5xl lg:max-w-6xl 2xl:max-w-7xl px-5 lg:px-8 xl:px-12 pt-3 pb-2"
        style={!showBar ? { paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" } : undefined}
      >
        <div className="flex items-start gap-3 mb-1">
          {!hideBack && <BackButton onClick={onBack} />}
          <div className="flex flex-col leading-none min-w-0 flex-1">
            {eyebrow && (
              <span
                className="font-serif italic uppercase text-[0.62rem]"
                style={{
                  color: "hsl(var(--burnt-sienna) / 0.78)",
                  letterSpacing: "0.18em",
                }}
              >
                {eyebrow}
              </span>
            )}
            <h1 className="text-page-title leading-tight mt-1 truncate">
              {title}
            </h1>
            {meta && (
              <span
                className="font-serif italic mt-0.5 text-[0.78rem]"
                style={{ color: "hsl(var(--olivewood) / 0.7)" }}
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
