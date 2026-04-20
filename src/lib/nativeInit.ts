// Native-only initialization — runs once at app boot.
// Sets the iOS/Android status bar to match the app theme and hides the
// branded splash screen after the first paint so it doesn't linger.
//
// Safe on web: every call is wrapped in a try/catch and no-ops if the
// plugin isn't available (i.e. you're in a browser).

import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

const isNative =
  typeof window !== "undefined" &&
  (window as any).Capacitor?.isNativePlatform?.() === true;

export async function initNative() {
  if (!isNative) return;

  // Status bar: dark icons (Style.Light = dark icons on light bg) so the
  // iOS clock/battery stay visible against our cream-white background.
  try {
    await StatusBar.setStyle({ style: Style.Light });
    // Background color only applies on Android; iOS uses the launch screen color.
    await StatusBar.setBackgroundColor({ color: "#F4F8F5" });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch { /* ignore */ }

  // Hide the splash screen after the React tree mounts.
  try {
    await SplashScreen.hide({ fadeOutDuration: 300 });
  } catch { /* ignore */ }
}
