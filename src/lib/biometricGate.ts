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
export async function requireBiometric(reason: string): Promise<boolean> {
  if (!isNativePlatform) return true;
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
  }
}
