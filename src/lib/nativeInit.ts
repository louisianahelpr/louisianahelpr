// Native-only initialization — runs once at app boot.
// Sets the iOS/Android status bar to match the app theme and hides the
// branded splash screen after the first paint so it doesn't linger.
//
import { initSocialLogin } from "./socialLogin";
// Safe on web: every call is wrapped in a try/catch and no-ops if the
// plugin isn't available (i.e. you're in a browser).

import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

export const isNativePlatform =
  typeof window !== "undefined" &&
  (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;

// Tag <html> with the runtime platform so CSS can diverge a handful of
// color tokens between the native iOS WebView (Display-P3 wide gamut,
// where saturated accents pop harder and cool near-whites read warmer)
// and desktop web (sRGB). Set at module import — before createRoot — so
// the `html[data-platform="ios"]` overrides apply on the very first paint
// with no flash. Web stays `data-platform="web"` (no overrides = base
// :root tokens). See the `html[data-platform="ios"]` block in index.css.
if (typeof document !== "undefined") {
  const platform =
    (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ??
    "web";
  document.documentElement.setAttribute("data-platform", platform);
}

export async function initNative() {
  if (!isNativePlatform) return;

  // Pinch-zoom off — NATIVE ONLY.
  //
  // A packaged app that zooms doesn't read as an app: the whole UI scales,
  // the fixed nav dock and headers scale with it, and there is no obvious way
  // back to 100%. No native iOS app does this.
  //
  // Deliberately NOT done in index.html's viewport tag, because that tag also
  // serves the website, and `user-scalable=no` there would break WCAG 1.4.4
  // (text must reach 200%). A low-vision visitor on louisianahelpr.com keeps
  // full zoom; only the WKWebView shell loses it.
  //
  // This is the narrow "true native capability" exception to the rule that the
  // phone website and the app are one surface — it changes no layout, no nav
  // and no behaviour, only whether the OS gesture is allowed.
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, " +
        "viewport-fit=cover, interactive-widget=resizes-content",
    );
  }

  await clearNativeWebCaches();

  // Initialize @capgo/capacitor-social-login so the Apple/Google sign-in
  // buttons can call SocialLogin.login() via the native plugin path.
  // Idempotent (the helper guards against re-init). Best-effort —
  // sign-in buttons fall back to the web flow if init fails.
  try {
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
