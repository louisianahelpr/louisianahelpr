// In-App Review prompt — fires the native StoreKit/Play review sheet at the
// "aha moment": when a user has just completed a job AND left a 5-star review.
//
// Apple/Google rate-limit the actual prompt (max ~3 per year per user) so this
// is safe to call liberally. We additionally guard with safeStorage to avoid
// asking the same user twice in 90 days even if Apple's quota resets and to
// survive WebKit eviction on iOS.
//
// Falls back to a no-op on web — there is no equivalent native prompt in browsers.

import { isNativePlatform } from "./nativeInit";
import { safeStorage } from "./safeStorage";
import { report } from "./errorLogger";

const STORAGE_KEY = "helpr_in_app_review_last";
const COOLDOWN_DAYS = 90;

export async function maybeRequestInAppReview(opts?: { force?: boolean }) {
  if (!isNativePlatform) return;

  if (!opts?.force) {
    const last = Number(safeStorage.getItem(STORAGE_KEY) || 0);
    const ageDays = (Date.now() - last) / (1000 * 60 * 60 * 24);
    if (last && ageDays < COOLDOWN_DAYS) return;
  }

  try {
    // @capacitor-community/in-app-review is added at native build time
    // (Xcode/Capacitor sync). It's intentionally not in the web bundle, so
    // we resolve it dynamically and silently no-op if unavailable.
    // @ts-expect-error — optional native-only module, no types in web build
    const mod = await import(/* @vite-ignore */ "@capacitor-community/in-app-review").catch(() => null);
    if (!mod?.InAppReview) {
      // Plugin not installed in this build — silent no-op.
      return;
    }
    await mod.InAppReview.requestReview();
    safeStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch (e) {
    // Never let a review prompt failure break the app.
    report(e, { severity: "warning", tags: { source: "inAppReview.requestReview" } });
  }
}
