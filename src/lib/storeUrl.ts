/**
 * App Store / Play Store URL detection, shared by the force-update gate
 * (src/components/ForceUpdate.tsx) and the soft update prompt
 * (src/hooks/useSoftUpdatePrompt.ts).
 */
export const APP_STORE_URL = "https://apps.apple.com/app/id6748060989";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.louisianahelpr.app";

export const detectStoreUrl = (): string => {
  if (typeof navigator === "undefined") return APP_STORE_URL;
  // Capacitor exposes the platform via the global; fall back to a UA
  // string sniff so this works even if the bridge is half-initialized.
  const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const platform = cap?.getPlatform?.();
  if (platform === "android") return PLAY_STORE_URL;
  if (platform === "ios") return APP_STORE_URL;
  return /Android/i.test(navigator.userAgent) ? PLAY_STORE_URL : APP_STORE_URL;
};
