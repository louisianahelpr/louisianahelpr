import { isNativePlatform } from "@/lib/nativeInit";

/**
 * Require a device biometric (Face ID / Touch ID, with passcode fallback)
 * before a sensitive money-movement action.
 *
 * Returns true when:
 *   - the platform is web (no-op pass-through), OR
 *   - no biometric is available/enrolled on the device — we do NOT lock a
 *     user out of their own money just because they haven't set up Face ID;
 *     the action is still protected by the authenticated Supabase session
 *     and server-side authorization, OR
 *   - the user successfully authenticates.
 *
 * Returns false ONLY when a biometric IS available and the user fails or
 * cancels the prompt. Callers should abort the action and stay silent on
 * false (the OS already showed the prompt — no extra toast needed).
 *
 * Dynamic import keeps the plugin chunk off the web critical-path bundle.
 */
/**
 * How many biometric prompts are currently on screen, app-wide.
 *
 * Read by `AppLockGate`: presenting the OS biometric sheet fires
 * `UIApplication.willResignActive`, which is otherwise the gate's cue to raise
 * its privacy shield over the app. Without this, confirming an instant payout
 * flashed a full-screen shield over the dialog you were confirming. A counter
 * rather than a boolean so overlapping prompts can't leave it stuck on.
 */
let openPrompts = 0;

/** True while an OS biometric sheet is (or is about to be) on screen. */
export function isBiometricPromptOpen(): boolean {
  return openPrompts > 0;
}

export async function requireBiometric(reason: string): Promise<boolean> {
  if (!isNativePlatform) return true;
  openPrompts += 1;
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    const info = await BiometricAuth.checkBiometry();
    if (!info.isAvailable) return true;
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "Cancel",
      allowDeviceCredential: true,
      iosFallbackTitle: "Use passcode",
    });
    return true;
  } catch {
    // BiometryError on cancel/failure — treat as a hard deny.
    return false;
  } finally {
    // `finally` runs on every exit path, including the early `return true` for
    // "no biometry enrolled" — the counter must never leak.
    openPrompts = Math.max(0, openPrompts - 1);
  }
}

/**
 * The name of the biometric this device will actually prompt with — "Face ID",
 * "Touch ID", "fingerprint" — or null when we can't tell or there is none
 * enrolled.
 *
 * Only for LABELLING. Never gate on it: `requireBiometric()` deliberately
 * passes on devices with no enrolled biometry, and this returning null must not
 * change that. Null callers should fall back to neutral copy ("Unlock") rather
 * than guessing "Face ID" on a Touch ID phone, which would be a small lie on a
 * security screen.
 */
export async function getBiometryLabel(): Promise<string | null> {
  if (!isNativePlatform) return null;
  try {
    const { BiometricAuth, BiometryType } = await import("@aparajita/capacitor-biometric-auth");
    const info = await BiometricAuth.checkBiometry();
    if (!info.isAvailable) return null;
    switch (info.biometryType) {
      case BiometryType.touchId:
        return "Touch ID";
      case BiometryType.faceId:
        return "Face ID";
      case BiometryType.fingerprintAuthentication:
        return "your fingerprint";
      case BiometryType.faceAuthentication:
        return "face unlock";
      case BiometryType.irisAuthentication:
        return "iris unlock";
      default:
        return null;
    }
  } catch {
    return null;
  }
}
