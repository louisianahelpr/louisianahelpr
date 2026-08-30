import type { TabButtonProps } from "./types";

/**
 * Internal tab button — extracted from MobileNav so each tab's markup lives
 * in one place. Renders the same `<button>` shell the inline version did;
 * layout + visual treatment is unchanged.
 *
 * Long-press quick-actions were removed (owner review, 2026-08-30 — live
 * demo of the anchored-popover migration for "Mark all read" / "Open filter
 * chips" showed both were redundant with entry points that already exist
 * elsewhere: Mark all read lives in NotificationPanel, and Open filter
 * chips just opens the same Filters button's own popover). Tabs are plain
 * taps only now.
 */
export const TabButton = ({
  onTap,
  onPrefetch,
  ariaLabel,
  ariaCurrent,
  className,
  style,
  children,
}: TabButtonProps) => (
  <button
    onClick={onTap}
    onMouseEnter={onPrefetch}
    onFocus={onPrefetch}
    onTouchStart={onPrefetch}
    aria-label={ariaLabel}
    aria-current={ariaCurrent}
    className={className}
    style={style}
  >
    {children}
  </button>
);
