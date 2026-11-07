/**
 * 11-07 (owner posting free Declutter items in local Facebook groups): a shared link opens in Facebook's or
 * Instagram's built-in browser, where Google refuses OAuth sign-in (its embedded-web-view "disallowed_useragent"
 * policy). "Continue with Google" there could only fail, so in those browsers it is replaced by one line saying to open
 * the page in Safari or Chrome. Apple and email sign-up are unchanged. Every other browser keeps the Google button.
 *
 * @mutate src/components/auth/SocialAuthButtons.tsx | {isSocialInAppBrowser() ? <GoogleInAppNote /> : <SocialAuthButton provider="google" | {false ? <GoogleInAppNote /> : <SocialAuthButton provider="google"
 * @mutate src/lib/inAppBrowser.ts | FBAN\|FBAV\|FB_IAB\|FBIOS\|FB4A\|Instagram\| | FB_IAB\|
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn() }));

import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { isSocialInAppBrowser } from "@/lib/inAppBrowser";

const UA = {
  facebookIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.97;FBBV/601234567;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]",
  facebookAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/462.0.0.48.81;]",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.40.92 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 601234567)",
  safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

function withUa(ua: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
}

describe("Continue with Google inside Facebook's and Instagram's browser (11-07)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("the in-app browser marks are recognised, and ordinary browsers are not", () => {
    expect(isSocialInAppBrowser(UA.facebookIos)).toBe(true);
    expect(isSocialInAppBrowser(UA.facebookAndroid)).toBe(true);
    expect(isSocialInAppBrowser(UA.instagram)).toBe(true);
    expect(isSocialInAppBrowser(UA.safari)).toBe(false);
    expect(isSocialInAppBrowser(UA.chrome)).toBe(false);
    expect(isSocialInAppBrowser("")).toBe(false);
    expect(isSocialInAppBrowser(undefined)).toBe(false);
  });

  for (const [name, ua] of [["Facebook (iPhone)", UA.facebookIos], ["Facebook (Android)", UA.facebookAndroid], ["Instagram", UA.instagram]] as const) {
    it(`${name}: no Google button, a line saying to open the page in a browser; Apple stays`, () => {
      withUa(ua);
      render(<MemoryRouter><SocialAuthButtons /></MemoryRouter>);
      expect(screen.queryByRole("button", { name: /Continue with Google/i })).toBeNull();
      expect(document.querySelector("[data-google-in-app]")?.textContent).toBe(
        "To continue with Google, open this page in your browser (Safari or Chrome). Google sign-in doesn't work inside Facebook or Instagram.");
      expect(screen.getByRole("button", { name: /Continue with Apple/i })).toBeTruthy();
    });
  }

  it("Safari: the Google button shows as before", () => {
    withUa(UA.safari);
    render(<MemoryRouter><SocialAuthButtons /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeTruthy();
    expect(document.querySelector("[data-google-in-app]")).toBeNull();
  });
});
