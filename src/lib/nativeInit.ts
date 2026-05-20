// Native-only initialization — runs once at app boot.
// Sets the iOS/Android status bar to match the app theme and hides the
// branded splash screen after the first paint so it doesn't linger.
//
// @capgo/capacitor-social-login is dynamically imported (NOT statically)
// to keep its ~55KB chunk out of the entry bundle. Without this,
// main.tsx -> nativeInit -> socialLogin pulled the plugin into the
// critical static graph and forced it to load before React could mount
// on native cold starts. initNative() runs after the first paint
// (`initNative()` is called from inside the `hydrateStorage().finally`
// post-render block in main.tsx), so the import latency is invisible.
// Safe on web: every call is wrapped in a try/catch and no-ops if the
// plugin isn't available (i.e. you're in a browser).

import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

export const isNativePlatform =
  typeof window !== "undefined" &&
  (window as any).Capacitor?.isNativePlatform?.() === true;

export async function initNative() {
  if (!isNativePlatform) return;

  await clearNativeWebCaches();

  // Initialize @capgo/capacitor-social-login so the Apple/Google sign-in
  // buttons can call SocialLogin.login() via the native plugin path.
  // Idempotent (the helper guards against re-init). Best-effort —
  // sign-in buttons fall back to the web flow if init fails. Dynamic
  // import keeps the plugin chunk out of the critical entry graph.
  try {
    const { initSocialLogin } = await import("./socialLogin");
    await initSocialLogin();
  } catch { /* ignore */ }

  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch { }

  // Hide splash after React mounts.
  await hideSplash();
}

async function clearNativeWebCaches() {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations ?? []).map((registration) => registration.unregister()));
  } catch { /* service workers unavailable in native webview */ }

  try {
    const keys = await window.caches?.keys?.();
    await Promise.all((keys ?? []).map((key) => window.caches.delete(key)));
  } catch { /* cache storage unavailable in native webview */ }
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
// after 1.5s so the app can never be stuck on a green screen. Tightened
// from 4s — a brief blank flash is far better than 4 seconds of stuck
// splash if React fails to mount in time. Fires once at module import on
// native only.
if (isNativePlatform) {
  setTimeout(() => {
    SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
  }, 1500);
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
