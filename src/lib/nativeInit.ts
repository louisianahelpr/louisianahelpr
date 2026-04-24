// Native-only initialization — runs once at app boot.
// Sets the iOS/Android status bar to match the app theme and hides the
// branded splash screen after the first paint so it doesn't linger.
//
// Safe on web: every call is wrapped in a try/catch and no-ops if the
// plugin isn't available (i.e. you're in a browser).

import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

export const isNativePlatform =
  typeof window !== "undefined" &&
  (window as any).Capacitor?.isNativePlatform?.() === true;

export async function initNative() {
  if (!isNativePlatform) return;

  // Default status bar: dark icons on light cream background.
  // Pages can override per-route via useStatusBar(Style.Dark).
  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#F4F8F5" });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch { /* plugin missing on web */ }

  // Hide splash after React mounts.
  await hideSplash();
}

/**
 * Hide the native splash screen with a short fade. Safe to call from web
 * (no-op). Use this from the top-level App useEffect to guarantee the
 * splash comes down as soon as the first paint is ready.
 */
export async function hideSplash() {
  if (!isNativePlatform) return;
  try {
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch { /* ignore */ }
}

// Safety net: if something hangs in initNative(), force-hide the splash
// after 4s so the app can never be stuck on a green screen. Fires once
// at module import on native only.
if (isNativePlatform) {
  setTimeout(() => {
    SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
  }, 4000);
}

/**
 * Set status bar style for the current screen. Call from a useEffect in
 * any page that needs a different style (e.g. dark hero sections).
 */
export async function setStatusBarStyle(style: "light" | "dark") {
  if (!isNativePlatform) return;
  try {
    // Style.Light = dark text/icons (for light backgrounds)
    // Style.Dark  = light text/icons (for dark backgrounds)
    await StatusBar.setStyle({
      style: style === "dark" ? Style.Dark : Style.Light,
    });
  } catch { /* ignore */ }
}
