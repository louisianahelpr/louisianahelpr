import type { TabButtonProps } from "./types";

/**
 * Internal tab button — extracted from MobileNav so each tab's markup lives
 * in one place. Renders the same `<button>` shell the inline version did;
 * layout + visual treatment is unchanged.
 *
 * A previous "Mark all read" / "Open filter chips" long-press pair was
 * removed (owner review, 2026-08-30) as redundant with entry points that
 * already existed elsewhere. Posts/Messages now carry a DIFFERENT long-press
 * — quick-filter and recent-conversation preview popovers (see MobileNav's
 * `longPress` prop below) — added back per product request; the optional
 * `longPress` handlers are a no-op passthrough for every other tab.
 */
export const TabButton = ({
  onTap,
  onPrefetch,
  ariaLabel,
  ariaCurrent,
  className,
  style,
  children,
  longPress,
}: TabButtonProps) => (
  <button
    onClick={onTap}
    onMouseEnter={onPrefetch}
    onFocus={onPrefetch}
    onTouchStart={(e) => {
      onPrefetch();
      longPress?.onTouchStart(e);
    }}
    onTouchMove={longPress?.onTouchMove}
    onTouchEnd={longPress?.onTouchEnd}
    onTouchCancel={longPress?.onTouchCancel}
    onMouseDown={longPress?.onMouseDown}
    onMouseMove={longPress?.onMouseMove}
    onMouseUp={longPress?.onMouseUp}
    onMouseLeave={longPress?.onMouseLeave}
    aria-label={ariaLabel}
    aria-current={ariaCurrent}
    className={className}
    style={style}
  >
    {children}
  </button>
);
