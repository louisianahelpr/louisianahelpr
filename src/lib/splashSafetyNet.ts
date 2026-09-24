// NB-009: the splash safety net, armed FIRST. main.tsx imports this before
// anything else, and it imports nothing that reaches the Supabase client, so
// it evaluates before client.ts's top-level `await hydratePromise` (up to
// HYDRATE_TIMEOUT_MS of Preferences bridge I/O). When it lived at the bottom
// of nativeInit.ts it armed only AFTER that await, so it covered nothing
// during hydration and a hang could hold the splash ~3.5s, not 1.5s.
// Keep this module's imports to @capacitor/* only (src/test/splashSafetyNet
// ArmsFirst.test.ts).
import { SplashScreen } from "@capacitor/splash-screen";

const isNative =
  typeof window !== "undefined" &&
  (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;

// If anything hangs before React paints, force-hide after 1.5s so the app can
// never be stuck on the splash. main.tsx's hideSplash() normally wins.
if (isNative) {
  setTimeout(() => {
    SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
  }, 1500);
}
