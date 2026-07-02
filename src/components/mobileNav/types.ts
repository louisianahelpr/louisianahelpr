import type { LucideIcon } from "lucide-react";

/**
 * Props for the quick-action row used inside the long-press action sheet.
 * Generic icon + label + tap target — kept co-located with MobileNav
 * (rather than promoted to a shared component) because no other surface in
 * the app currently needs this exact shape.
 */
export interface QuickActionRowProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

/**
 * Props for the internal tab button — extracted from MobileNav so we can call
 * `useLongPress` once per tab (hooks can't be called inside a `.map()`
 * loop). Renders the same `<button>` shell the inline version did; layout
 * + visual treatment is unchanged. Long-press fires `onLongPress` after
 * ~500ms; short taps fall through to `onTap`. When `longPressEnabled` is
 * false (guest-locked tabs, no actions defined) we strip the long-press
 * handlers so the gesture stays a plain tap.
 */
export interface TabButtonProps {
  onTap: () => void;
  onLongPress: () => void;
  longPressEnabled: boolean;
  onPrefetch: () => void;
  ariaLabel: string;
  ariaCurrent: "page" | undefined;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}
