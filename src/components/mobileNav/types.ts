/**
 * Props for the internal tab button — extracted from MobileNav so each
 * tab's markup lives in one place. Renders the same `<button>` shell the
 * inline version did; layout + visual treatment is unchanged.
 */
export interface TabButtonProps {
  onTap: () => void;
  onPrefetch: () => void;
  ariaLabel: string;
  ariaCurrent: "page" | undefined;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  /**
   * Optional long-press gesture handlers (from `@/hooks/useLongPress`),
   * spread onto the underlying `<button>`. Only Posts and Messages wire
   * this up today — every other tab renders exactly as before.
   */
  longPress?: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
    onMouseDown: (e: React.MouseEvent) => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
  };
}
