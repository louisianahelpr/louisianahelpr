// Tiny haptics wrapper — safe to call from anywhere.
// On the web (or if the plugin isn't available) these are no-ops.
// On iOS/Android (Capacitor native), they trigger system haptics.
//
// All call sites go through `safe()` below, which centralizes:
//   1. Native-platform guard (web → no-op).
//   2. `Capacitor.isPluginAvailable("Haptics")` guard — on Android devices
//      the plugin is occasionally not bridged (custom builds, broken
//      bridges); without this guard a `Haptics.impact(...)` call rejects
//      with "Plugin not implemented" and the consumer's try/catch can't
//      always catch it (e.g. fire-and-forget callbacks).
//   3. Reduce-motion guard — when the user has Reduce Motion on, we skip
//      the threshold-crossing / passive feedback haptics. Explicit
//      result haptics (success/warning/error notifications) still fire
//      since they convey accept/reject status that motion-reduction does
//      not override.

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { prefersReducedMotion } from "@/lib/accessibility";

const isNative =
  typeof window !== "undefined" &&
  (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;

/**
 * Single source of truth — is the Haptics plugin actually bridged and
 * callable on this platform right now?
 *
 * The result is memoized after the first read; the answer can't change
 * during a single web-view lifetime (Capacitor doesn't hot-bridge
 * plugins), and re-reading it is cheap but called from input handlers.
 */
let _hapticsAvailable: boolean | null = null;
const isHapticsAvailable = (): boolean => {
  if (_hapticsAvailable !== null) return _hapticsAvailable;
  if (!isNative) {
    _hapticsAvailable = false;
    return false;
  }
  try {
    const cap = (window as { Capacitor?: { isPluginAvailable?: (name: string) => boolean } }).Capacitor;
    _hapticsAvailable = cap?.isPluginAvailable?.("Haptics") ?? true;
  } catch {
    _hapticsAvailable = false;
  }
  return _hapticsAvailable;
};

/**
 * `kind: "impact"` is a passive feedback haptic (tap, toggle, threshold
 * crossing) — these are suppressed when Reduce Motion is on. `kind:
 * "result"` is a result-confirming haptic (success/warning/error) and
 * still fires under Reduce Motion since it's status, not motion.
 */
const safe = async (
  fn: () => Promise<unknown>,
  kind: "impact" | "result" = "impact",
) => {
  if (!isHapticsAvailable()) return;
  if (kind === "impact" && prefersReducedMotion()) return;
  try { await fn(); } catch { /* ignore */ }
};

/**
 * Explicit-action impact that bypasses Reduce Motion.
 *
 * Use this only when the haptic acknowledges a user-initiated, completed
 * action (e.g. "you released past the refresh threshold → refresh
 * starting") rather than ambient motion. Almost all sites should keep
 * using `hapticLight/Medium/Heavy`.
 */
export const hapticImpactForce = (style: ImpactStyle = ImpactStyle.Light) =>
  safe(() => Haptics.impact({ style }), "result");

/** Light tap — use for taps, toggles, minor interactions. */
export const hapticLight = () => safe(() => Haptics.impact({ style: ImpactStyle.Light }));

/** Medium tap — use for primary action confirmations (Apply, Accept). */
export const hapticMedium = () => safe(() => Haptics.impact({ style: ImpactStyle.Medium }));

/** Strong tap — reserved for critical, irreversible actions. */
export const hapticHeavy = () => safe(() => Haptics.impact({ style: ImpactStyle.Heavy }));

/** Success buzz — job complete, payment received, etc. Result haptic;
 *  not suppressed by Reduce Motion. */
export const hapticSuccess = () => safe(
  () => Haptics.notification({ type: NotificationType.Success }),
  "result",
);

/** Warning buzz — destructive confirmations, errors recoverable. Result
 *  haptic; not suppressed by Reduce Motion. */
export const hapticWarning = () => safe(
  () => Haptics.notification({ type: NotificationType.Warning }),
  "result",
);

/** Error buzz — failed actions, validation errors. Result haptic; not
 *  suppressed by Reduce Motion. */
export const hapticError = () => safe(
  () => Haptics.notification({ type: NotificationType.Error }),
  "result",
);
