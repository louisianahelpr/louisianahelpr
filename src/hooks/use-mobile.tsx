import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * A phone-width window (under 768px, useIsMobile's line), known on the FIRST render. useIsMobile starts false and
 * flips in an effect after the first paint, so a phone painted every guide page once without its count row ("159
 * gifts", the pill and the icons) and then pushed the gifts 54px down (owner 2026-11-24 ~7 PM, the Kids page: "It
 * shouldn't move like this"; layout shift 0.0255 at 375, measured on a local build). Guard:
 * src/test/giftGuideKidsThemeRow1124.test.tsx. Lives here (not in GiftGuides.tsx) so the guide prerender's width stub
 * (src/prerender/useIsMobileStub.ts) answers it too when the build draws each guide at both widths.
 */
const PHONE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
const phoneNow = () => window.innerWidth < MOBILE_BREAKPOINT;
const onPhoneChange = (fire: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", fire);
  return () => mql.removeEventListener("change", fire);
};
export function usePhoneNow(): boolean {
  return React.useSyncExternalStore(onPhoneChange, phoneNow, phoneNow);
}
