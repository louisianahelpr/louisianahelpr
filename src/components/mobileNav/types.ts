/**
 * Props for the internal tab button — extracted from MobileNav so each
 * tab's markup lives in one place. Renders the same `<button>` shell the
 * inline version did; layout + visual treatment is unchanged.
 */
export interface TabButtonProps {
  onTap: () => void;
  onPrefetch: () => void;
  ariaLabel: string;
  /** The tab's path, on the button as `data-dock-tab` (the Help tour's coach marks find a tab by it, in any language). */
  dockPath?: string;
  ariaCurrent: "page" | undefined;
  /** A section whose switch is off for the viewer: shown greyed, never navigates. */
  ariaDisabled?: boolean;
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
