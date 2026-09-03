import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pins the biometric gate's fail-open boundary.
 *
 * THE BUG THIS FILE EXISTS FOR (NB-008 / OA-012). The gate read only
 * `checkBiometry().isAvailable` and returned TRUE when it was false. On iOS
 * that field is `canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)`,
 * which the OS reports as false on `LAError.biometryLockout` — after five
 * failed Face ID attempts. So the single strongest signal that the phone is in
 * the wrong hands opened the app, the payout dialogs, the ban button and the
 * admin grant with no authentication at all.
 *
 * The LOCKOUT case is therefore the load-bearing test here. A suite that only
 * covered "biometry not enrolled" passes against the broken code, because
 * not-enrolled and locked-out are the exact two states the old condition
 * collapsed into one.
 *
 * `checkBiometry()` shapes below are the real ones the plugin's Swift emits
 * (node_modules/@aparajita/capacitor-biometric-auth/ios/Sources/
 * BiometricAuthNative/BiometricAuthNative.swift): `isAvailable` is the
 * biometrics-only policy, `deviceIsSecure` is `.deviceOwnerAuthentication`
 * (biometry OR passcode), which stays true through a lockout.
 */

let nativeFlag = true;

vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return nativeFlag;
  },
}));

type Check = {
  isAvailable: boolean;
  strongBiometryIsAvailable: boolean;
  biometryType: number;
  biometryTypes: number[];
  deviceIsSecure: boolean;
  reason: string;
  code: string;
};

let checkResult: Check | Error;
let authenticateResult: undefined | Error;
const authenticate = vi.fn();

/** A rejection shaped like the plugin's `BiometryError` (a `.code` string). */
function biometryError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

vi.mock("@aparajita/capacitor-biometric-auth", () => ({
  BiometricAuth: {
    checkBiometry: async () => {
      if (checkResult instanceof Error) throw checkResult;
      return checkResult;
    },
    authenticate: async (opts: unknown) => {
      // Return the spy's own result so a test can hold the sheet open with a
      // pending promise.
      const pending = authenticate(opts);
      if (authenticateResult instanceof Error) throw authenticateResult;
      return await pending;
    },
  },
  BiometryType: {
    none: 0,
    touchId: 1,
    faceId: 2,
    fingerprintAuthentication: 3,
    faceAuthentication: 4,
    irisAuthentication: 5,
  },
}));

/** Face ID enrolled and usable; passcode set. The ordinary phone. */
const ENROLLED: Check = {
  isAvailable: true,
  strongBiometryIsAvailable: true,
  biometryType: 2,
  biometryTypes: [2],
  deviceIsSecure: true,
  reason: "",
  code: "",
};

/**
 * FIVE FAILED FACE ID ATTEMPTS. Note `isAvailable: false` with
 * `deviceIsSecure: true` — that pair IS the bug, and iOS still has a passcode
 * to challenge with.
 */
const LOCKED_OUT: Check = {
  ...ENROLLED,
  isAvailable: false,
  strongBiometryIsAvailable: false,
  reason: "Biometry is locked out.",
  code: "biometryLockout",
};

/** No Face ID enrolled, but the phone has a passcode. */
const NOT_ENROLLED: Check = {
  ...ENROLLED,
  isAvailable: false,
  strongBiometryIsAvailable: false,
  biometryType: 0,
  biometryTypes: [],
  reason: "Biometry is not enrolled.",
  code: "biometryNotEnrolled",
};

/** No biometry AND no passcode — nothing on the device can authenticate anyone. */
const UNSECURABLE: Check = {
  ...NOT_ENROLLED,
  deviceIsSecure: false,
  reason: "Passcode not set.",
  code: "passcodeNotSet",
};

async function load() {
  vi.resetModules();
  return await import("./biometricGate");
}

beforeEach(() => {
  nativeFlag = true;
  checkResult = ENROLLED;
  authenticateResult = undefined;
  authenticate.mockReset();
});

describe("requireBiometric — biometry LOCKOUT must not fail open", () => {
  it("PROMPTS on lockout instead of waving the caller through", async () => {
    checkResult = LOCKED_OUT;
    const { requireBiometric } = await load();

    const ok = await requireBiometric("Confirm this payout");

    // The old code returned true here without ever calling authenticate().
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("asks with allowDeviceCredential so iOS presents the PASSCODE sheet", async () => {
    checkResult = LOCKED_OUT;
    const { requireBiometric } = await load();

    await requireBiometric("Confirm this payout");

    // LAPolicy.deviceOwnerAuthentication is the only policy that can be
    // satisfied during a lockout; the plugin selects it off this flag.
    expect(authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ allowDeviceCredential: true }),
    );
  });

  it("DENIES when the locked-out user cannot produce the passcode either", async () => {
    checkResult = LOCKED_OUT;
    authenticateResult = biometryError("authenticationFailed");
    const { requireBiometric } = await load();

    expect(await requireBiometric("Confirm this payout")).toBe(false);
  });

  it("DENIES when the locked-out user dismisses the sheet", async () => {
    checkResult = LOCKED_OUT;
    authenticateResult = biometryError("userCancel");
    const { requireBiometric } = await load();

    expect(await requireBiometric("Unlock Louisiana Helpr")).toBe(false);
  });

  it("DENIES if authenticate() itself reports lockout (Android, no credential)", async () => {
    checkResult = LOCKED_OUT;
    authenticateResult = biometryError("biometryLockout");
    const { requireBiometric } = await load();

    expect(await requireBiometric("Confirm this payout")).toBe(false);
  });
});

describe("requireBiometric — the passcode fallback is now REACHABLE", () => {
  it("prompts when no biometry is enrolled but a passcode is set", async () => {
    checkResult = NOT_ENROLLED;
    const { requireBiometric } = await load();

    const ok = await requireBiometric("Confirm your instant cash-out");

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("denies a failed passcode on a device with no biometry", async () => {
    checkResult = NOT_ENROLLED;
    authenticateResult = biometryError("authenticationFailed");
    const { requireBiometric } = await load();

    expect(await requireBiometric("Confirm your instant cash-out")).toBe(false);
  });
});

describe("requireBiometric — the ordinary enrolled path", () => {
  it("passes on a successful prompt", async () => {
    const { requireBiometric } = await load();
    expect(await requireBiometric("Confirm this refund")).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("denies a cancelled prompt", async () => {
    authenticateResult = biometryError("userCancel");
    const { requireBiometric } = await load();
    expect(await requireBiometric("Confirm this refund")).toBe(false);
  });
});

describe("requireBiometric — a device that cannot authenticate anyone", () => {
  it("passes through by default: refusing would block the user with no remedy", async () => {
    checkResult = UNSECURABLE;
    const { requireBiometric } = await load();

    const ok = await requireBiometric("Confirm your instant cash-out");

    // No point raising a sheet that can only reject with passcodeNotSet.
    expect(authenticate).not.toHaveBeenCalled();
    expect(ok).toBe(true);
  });

  it("DENIES under onUnsecurableDevice: 'deny' — arming an unpassable lock", async () => {
    checkResult = UNSECURABLE;
    const { requireBiometric } = await load();

    const ok = await requireBiometric("Turn on the Face ID lock for Helpr", {
      onUnsecurableDevice: "deny",
    });

    expect(ok).toBe(false);
  });

  it("treats a passcode removed mid-prompt the same way", async () => {
    checkResult = NOT_ENROLLED; // deviceIsSecure true at check time…
    authenticateResult = biometryError("passcodeNotSet"); // …gone by the prompt.
    const { requireBiometric } = await load();

    expect(await requireBiometric("Confirm your instant cash-out")).toBe(true);
    expect(
      await requireBiometric("Turn on the Face ID lock for Helpr", {
        onUnsecurableDevice: "deny",
      }),
    ).toBe(false);
  });
});

describe("requireBiometric — degraded bridge", () => {
  it("does not silently pass a 'deny' caller when checkBiometry() throws", async () => {
    checkResult = new Error("bridge unavailable");
    const { requireBiometric } = await load();

    expect(
      await requireBiometric("Turn on the Face ID lock for Helpr", {
        onUnsecurableDevice: "deny",
      }),
    ).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("keeps money actions usable when checkBiometry() throws", async () => {
    checkResult = new Error("bridge unavailable");
    const { requireBiometric } = await load();

    expect(await requireBiometric("Confirm your instant cash-out")).toBe(true);
  });
});

describe("requireBiometric — web", () => {
  it("is a pass-through and never touches the plugin", async () => {
    nativeFlag = false;
    const { requireBiometric } = await load();

    expect(await requireBiometric("Confirm this refund")).toBe(true);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("passes on web even under onUnsecurableDevice: 'deny'", async () => {
    // There is no device owner to challenge in a browser; the app-lock switch
    // is native-only and this branch only exists for the dev harness.
    nativeFlag = false;
    const { requireBiometric } = await load();

    expect(
      await requireBiometric("Turn on the Face ID lock for Helpr", {
        onUnsecurableDevice: "deny",
      }),
    ).toBe(true);
  });
});

describe("isBiometricPromptOpen — the counter must never leak", () => {
  it("is false again after a successful prompt", async () => {
    const { requireBiometric, isBiometricPromptOpen } = await load();
    await requireBiometric("Confirm this refund");
    expect(isBiometricPromptOpen()).toBe(false);
  });

  it("is false again after a denial", async () => {
    authenticateResult = biometryError("userCancel");
    const { requireBiometric, isBiometricPromptOpen } = await load();
    await requireBiometric("Confirm this refund");
    expect(isBiometricPromptOpen()).toBe(false);
  });

  it("is false again after the no-authenticator early return", async () => {
    // This is the path the `finally` was written for — an early return that
    // skips the prompt entirely must still decrement, or AppLockGate's privacy
    // shield stays suppressed for the rest of the session.
    checkResult = UNSECURABLE;
    const { requireBiometric, isBiometricPromptOpen } = await load();
    await requireBiometric("Confirm your instant cash-out");
    expect(isBiometricPromptOpen()).toBe(false);
  });

  it("is TRUE while the sheet is up, so the shield does not flash over it", async () => {
    let release: () => void = () => {};
    authenticate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { requireBiometric, isBiometricPromptOpen } = await load();

    // The mocked module returns `authenticate(opts)`'s value, so a pending
    // promise here holds the sheet "open".
    const pending = requireBiometric("Confirm this payout");
    // The gate dynamically imports the plugin and awaits checkBiometry()
    // first, so wait for the sheet to actually be raised rather than
    // guessing a tick count.
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));

    expect(isBiometricPromptOpen()).toBe(true);
    release();
    await pending;
    expect(isBiometricPromptOpen()).toBe(false);
  });
});

describe("getBiometryLabel", () => {
  it("labels an enrolled Face ID device", async () => {
    const { getBiometryLabel } = await load();
    expect(await getBiometryLabel()).toBe("Face ID");
  });

  it("is null during a lockout — the sheet will ask for the passcode", async () => {
    checkResult = LOCKED_OUT;
    const { getBiometryLabel } = await load();
    // Callers fall back to a neutral "Unlock", which is the honest label for
    // the passcode sheet the user is about to see.
    expect(await getBiometryLabel()).toBeNull();
  });

  it("is null on web", async () => {
    nativeFlag = false;
    const { getBiometryLabel } = await load();
    expect(await getBiometryLabel()).toBeNull();
  });
});
