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
    const pluginId = "@capacitor-community/in-app-review";
    const mod = await import(/* @vite-ignore */ pluginId).catch(() => null);
    if (!mod?.InAppReview) {
      return;
    }
    await mod.InAppReview.requestReview();
    safeStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch (e) {
    report(e, { severity: "warning", tags: { source: "inAppReview.requestReview" } });
  }
}
