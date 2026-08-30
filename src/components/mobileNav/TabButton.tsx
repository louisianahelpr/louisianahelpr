import { useRef } from "react";
import { useLongPress } from "@/hooks/useLongPress";
import { hapticMedium } from "@/lib/haptics";
import type { TabButtonProps } from "./types";

/**
 * Internal tab button — extracted from MobileNav so we can call
 * `useLongPress` once per tab (hooks can't be called inside a `.map()`
 * loop). Renders the same `<button>` shell the inline version did; layout
 * + visual treatment is unchanged. Long-press fires `onLongPress` after
 * ~500ms; short taps fall through to `onTap`. When `longPressEnabled` is
 * false (guest-locked tabs, no actions defined) we strip the long-press
 * handlers so the gesture stays a plain tap.
 */
export const TabButton = ({
  onTap,
  onLongPress,
  longPressEnabled,
  onPrefetch,
  ariaLabel,
  ariaCurrent,
  className,
  style,
  children,
}: TabButtonProps) => {
  // The tab's own DOM node — captured so a long-press can anchor the
  // quick-action popover to THIS specific button (nav tab position varies:
  // it's whichever tab was pressed, not one fixed trigger like Filters or
  // the bell). See QuickActionSheet.tsx / MobileNav's quickActionAnchorRef.
  const buttonRef = useRef<HTMLButtonElement>(null);

  // `useLongPress` returns props to spread on the element. When long-press
  // isn't enabled, we ignore the press handlers and wire onClick directly
  // so the tab keeps behaving as a normal button.
  const longPress = useLongPress({
    threshold: 500,
    // Fire a medium haptic the moment the long-press threshold hits so the
    // gesture feels acknowledged BEFORE the quick-actions sheet slides up.
    // Matches the long-press pattern the dashboard cards already use — no
    // silent gestures anywhere in the app.
    onLongPress: onLongPress
      ? () => {
          hapticMedium();
          onLongPress(buttonRef.current);
        }
      : onLongPress,
    onTap,
  });

  if (!longPressEnabled) {
    return (
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
  }

  return (
    <button
      ref={buttonRef}
      // useLongPress drives both onTouch* and onMouse*, including `release`
      // which fires the short-tap callback if the threshold wasn't crossed.
      // We DON'T set onClick here — the hook's onTouchEnd / onMouseUp paths
      // already cover both pointer types, and a duplicate onClick would
      // either double-fire on touch (web → both touchend + a synthetic
      // click) or fight with the tap-on-release logic.
      //
      // Edge case: a mouse user without onClick wouldn't get a keyboard
      // Enter activation (Enter dispatches click, not mousedown). We wire
      // an explicit onKeyDown so the tab is still keyboard-operable.
      {...longPress}
      onTouchStart={(e) => {
        longPress.onTouchStart(e);
        onPrefetch();
      }}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap();
        }
      }}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
      aria-haspopup="menu"
      className={className}
      style={style}
    >
      {children}
    </button>
  );
};
