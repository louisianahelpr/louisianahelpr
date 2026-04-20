// Tiny haptics wrapper — safe to call from anywhere.
// On the web (or if the plugin isn't available) these are no-ops.
// On iOS/Android (Capacitor native), they trigger system haptics.

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

const isNative =
  typeof window !== "undefined" &&
  (window as any).Capacitor?.isNativePlatform?.() === true;

const safe = async (fn: () => Promise<unknown>) => {
  if (!isNative) return;
  try { await fn(); } catch { /* ignore */ }
};

/** Light tap — use for taps, toggles, minor interactions. */
export const hapticLight = () => safe(() => Haptics.impact({ style: ImpactStyle.Light }));

/** Medium tap — use for primary action confirmations (Apply, Accept). */
export const hapticMedium = () => safe(() => Haptics.impact({ style: ImpactStyle.Medium }));

/** Strong tap — reserved for critical, irreversible actions. */
export const hapticHeavy = () => safe(() => Haptics.impact({ style: ImpactStyle.Heavy }));

/** Success buzz — job complete, payment received, etc. */
export const hapticSuccess = () => safe(() => Haptics.notification({ type: NotificationType.Success }));

/** Warning buzz — destructive confirmations, errors recoverable. */
export const hapticWarning = () => safe(() => Haptics.notification({ type: NotificationType.Warning }));

/** Error buzz — failed actions, validation errors. */
export const hapticError = () => safe(() => Haptics.notification({ type: NotificationType.Error }));
