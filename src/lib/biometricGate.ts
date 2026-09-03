import { isNativePlatform } from "@/lib/nativeInit";

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

/**
 * What to do on a device that has NO way to authenticate its owner at all:
 * no enrolled biometry AND no passcode / PIN / pattern.
 *
 * - `"allow"` — pass through. There is no challenge to present, and refusing
 *   would permanently block the user from an action with no in-app remedy.
 *   The account is still protected by the authenticated Supabase session and
 *   by server-side authorization on every write.
 * - `"deny"` — refuse. Only correct where a `true` would ARM something the
 *   user then cannot pass (see `SecurityTab`'s app-lock switch).
 */
export type UnsecurableDevicePolicy = "allow" | "deny";

/** Error codes that mean "this device cannot authenticate its owner". */
const UNSECURABLE_CODES = new Set(["passcodeNotSet", "noDeviceCredential"]);

function errorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : "";
}

/**
 * Require proof of device ownership — Face ID / Touch ID, or the device
 * passcode — before a sensitive action.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BUG THIS WAS REWRITTEN FOR (NB-008 / OA-012): IT FAILED OPEN ON LOCKOUT.
 *
 * The old body was `if (!info.isAvailable) return true;`. In the plugin's own
 * Swift (node_modules/@aparajita/capacitor-biometric-auth/ios/Sources/
 * BiometricAuthNative/BiometricAuthNative.swift), `isAvailable` is
 * `context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` — the
 * biometrics-ONLY policy — which iOS reports as **false** on
 * `LAError.biometryLockout`, i.e. after five failed Face ID attempts.
 *
 * So the single condition that most strongly indicates an attack — someone
 * repeatedly failing Face ID on a phone that is not theirs — was read as
 * "this device has no biometry" and waved through. On a stolen phone: fail
 * Face ID five times, and Helpr opened with no authentication at all. That is
 * both the app-unlock check (`AppLockGate`) and the gate on every payout,
 * refund, ban, admin grant and account deletion.
 *
 * THE FIX. `checkBiometry()` also returns `deviceIsSecure`, which is
 * `canEvaluatePolicy(.deviceOwnerAuthentication)` — biometry OR passcode — and
 * that stays **true** through a biometry lockout, because the passcode is
 * exactly the escape iOS provides from one. So the gate now branches on
 * "can this device authenticate its owner AT ALL", not on "is biometry
 * currently usable", and lets the OS pick which challenge to present.
 *
 * This also makes the passcode fallback we already asked for REACHABLE. The
 * old early return skipped the `authenticate()` call entirely, so
 * `allowDeviceCredential` / `iosFallbackTitle` were configured on a code path
 * that never ran on any device where they would have mattered.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Returns true when:
 *   - the platform is web (no-op pass-through; there is no device owner to
 *     challenge in a browser), OR
 *   - the user successfully authenticates with biometry or passcode, OR
 *   - the device has neither biometry nor a passcode — or the bridge could not
 *     be reached to find out — AND `onUnsecurableDevice` is `"allow"` (the
 *     default).
 *
 * Returns false when the user fails or cancels, when the OS refuses to
 * authenticate for any reason, and — with `onUnsecurableDevice: "deny"` — on a
 * device that cannot authenticate anyone or that we could not evaluate.
 *
 * Callers should abort the action and stay SILENT on false: the OS already
 * showed the prompt, so an extra toast is noise.
 *
 * Dynamic import keeps the plugin chunk off the web critical-path bundle.
 */
export async function requireBiometric(
  reason: string,
  { onUnsecurableDevice = "allow" }: { onUnsecurableDevice?: UnsecurableDevicePolicy } = {},
): Promise<boolean> {
  if (!isNativePlatform) return true;
  const unsecurable = onUnsecurableDevice === "allow";
  openPrompts += 1;
  try {
    // Both of these are "we could not evaluate the device at all", so they
    // share one branch rather than behaving oppositely for no reason. The
    // plugin's `checkBiometry()` does not reject in its native code and the
    // chunk is bundled, so neither should ever happen on a real build — but if
    // one does, the caller's policy is the only information left to act on.
    let bridge: {
      BiometricAuth: (typeof import("@aparajita/capacitor-biometric-auth"))["BiometricAuth"];
      info: { isAvailable: boolean; deviceIsSecure: boolean };
    } | null = null;
    try {
      const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
      bridge = { BiometricAuth, info: await BiometricAuth.checkBiometry() };
    } catch {
      bridge = null;
    }
    if (!bridge) return unsecurable;
    const { BiometricAuth, info } = bridge;

    // No biometry AND no passcode: nothing exists to challenge with.
    // `authenticate()` would reject with `passcodeNotSet` here, so asking is
    // pointless — the ONLY decision left is the caller's policy.
    if (!info.isAvailable && !info.deviceIsSecure) return unsecurable;

    // Everything else prompts, INCLUDING the lockout case (`isAvailable`
    // false, `deviceIsSecure` true). `allowDeviceCredential: true` selects
    // LAPolicy.deviceOwnerAuthentication, so iOS presents Face ID when it can
    // and the passcode when it can't — which is precisely what a locked-out
    // device needs, and what an attacker who just burned five Face ID attempts
    // does not have.
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "Cancel",
      allowDeviceCredential: true,
      iosFallbackTitle: "Use passcode",
    });
    return true;
  } catch (err) {
    // The passcode was removed between `checkBiometry()` and the prompt, or
    // the platform has no device credential to offer. Same situation as the
    // pre-flight check above, reached a few milliseconds later.
    if (UNSECURABLE_CODES.has(errorCode(err))) return unsecurable;
    // Everything else — userCancel, authenticationFailed, biometryLockout,
    // systemCancel, appCancel, notInteractive — is a hard DENY. The user was
    // asked and did not pass.
    return false;
  } finally {
    // `finally` runs on every exit path, including the early returns above —
    // the counter must never leak.
    openPrompts = Math.max(0, openPrompts - 1);
  }
}

/**
 * The name of the biometric this device will actually prompt with — "Face ID",
 * "Touch ID", "fingerprint" — or null when we can't tell, there is none
 * enrolled, or biometry is currently locked out.
 *
 * Only for LABELLING. Never gate on it: null here does NOT mean
 * `requireBiometric()` will pass, and does not mean no prompt will appear —
 * a locked-out or biometry-less device with a passcode still gets challenged.
 * Null callers should fall back to neutral copy ("Unlock") rather than
 * guessing "Face ID" on a Touch ID phone, which would be a small lie on a
 * security screen. Neutral copy is also the honest label during a lockout,
 * where the sheet the user is about to see asks for a passcode.
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
