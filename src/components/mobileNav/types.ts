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
}
