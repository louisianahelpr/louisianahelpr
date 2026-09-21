import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SecurityTab } from "./SecurityTab";

/**
 * THE BIOMETRIC GATE IN FRONT OF ARMING THE APP LOCK.
 *
 * `requireBiometric()` opens with `if (!isNativePlatform) return true;`, so the
 * real module passes unconditionally under vitest. A test that imports it
 * cannot observe the gate at all — and here the gate is not merely a
 * confirmation, it is the PROOF STEP the whole flow exists for.
 *
 * Turning the lock on writes a flag that `AppLockGate` reads at every launch.
 * Persisting it without first proving the device can actually authenticate its
 * owner leaves the user staring at a lock screen they cannot pass, with the
 * only remedy outside the app. So `handleAppLockToggle` authenticates FIRST and
 * persists only on success — and this file is the only thing that can see that
 * ordering survive.
 *
 * It is also the ONE call site in the app that passes
 * `onUnsecurableDevice: "deny"`. Everywhere else a device with neither biometry
 * nor a passcode is waved through (refusing would lock a user out of their own
 * money with no in-app remedy); here that reasoning inverts, because `true`
 * would ARM a lock nothing can open. `src/lib/biometricGate.test.ts` proves the
 * POLICY denies; this proves the CALL SITE still asks for it, which is the half
 * a one-word edit here would silently delete.
 *
 * The mock defaults to `true` in `beforeEach` — a mock pinned to `true` is the
 * opposite of coverage, it removes the gate from the test's world.
 */
const requireBiometricMock = vi.fn<(reason: string, options?: unknown) => Promise<boolean>>();
vi.mock("@/lib/biometricGate", () => ({
  requireBiometric: (...args: unknown[]) =>
    (requireBiometricMock as unknown as (...a: unknown[]) => Promise<boolean>)(...args),
}));

/**
 * `setAppLockEnabled` IS the action. It is the only write — everything else
 * about the switch is local state — so "the action did not happen" is
 * measured as "the flag was never persisted".
 */
const setAppLockEnabledMock = vi.fn();
let lockEnabled = false;
vi.mock("@/lib/appLock", () => ({
  isAppLockSupported: () => true,
  isAppLockEnabled: () => lockEnabled,
  setAppLockEnabled: (...a: unknown[]) => setAppLockEnabledMock(...a),
  getAppLockGraceMs: () => 60_000,
  setAppLockGraceMs: vi.fn(),
  APP_LOCK_GRACE_OPTIONS: [
    { ms: 0, label: "Immediately" },
    { ms: 60_000, label: "After 1 minute" },
    { ms: 300_000, label: "After 5 minutes" },
  ],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
    }),
    auth: {
      updateUser: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      mfa: {
        listFactors: vi.fn(async () => ({ data: { totp: [] }, error: null })),
        enroll: vi.fn(async () => ({ data: null, error: null })),
        unenroll: vi.fn(async () => ({ error: null })),
        challengeAndVerify: vi.fn(async () => ({ error: null })),
      },
    },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}));

vi.mock("@/lib/authSignOut", () => ({ signOutWithPushCleanup: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/authRedirects", () => ({
  getPublicResetPasswordUrl: () => "https://louisianahelpr.com/reset",
  getPublicSiteUrl: () => "https://louisianahelpr.com",
}));

const confirmConsequentialMock = vi.fn();
vi.mock("@/lib/toastPolicy", () => ({
  confirmConsequential: (...a: unknown[]) => confirmConsequentialMock(...a),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(),
  hapticMedium: vi.fn(),
  hapticHeavy: vi.fn(),
  hapticSuccess: vi.fn(),
  hapticWarning: vi.fn(),
  hapticError: vi.fn(),
}));

/** Let every microtask + timer the handler could still have queued drain. */
async function drain() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <SecurityTab email="helper@example.com" onBack={() => {}} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const lockSwitch = () => screen.getByRole("switch", { name: "Require Face ID to open Helpr" });

beforeEach(() => {
  setAppLockEnabledMock.mockReset();
  confirmConsequentialMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  lockEnabled = false;
  requireBiometricMock.mockReset();
  // Default PASS: the happy-path case below must read the same as it would
  // with no gate at all.
  requireBiometricMock.mockResolvedValue(true);
});

describe("SecurityTab — the gate on arming the Face ID lock", () => {
  it("a passed confirmation arms the lock and persists the flag", async () => {
    renderTab();
    fireEvent.click(lockSwitch());

    await waitFor(() => expect(setAppLockEnabledMock).toHaveBeenCalledWith(true));
    expect(requireBiometricMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(lockSwitch()).toBeChecked());
    // The grace picker only exists once the lock is on.
    expect(screen.getByText("Lock again")).toBeInTheDocument();
  });

  it("a refused prompt ARMS NOTHING — the flag is never written, the switch stays off", async () => {
    requireBiometricMock.mockResolvedValue(false);
    renderTab();
    fireEvent.click(lockSwitch());

    // Wait for the GATE to have resolved, then drain. Asserting the absence
    // the instant the click returns would pass with the guard deleted, because
    // the write is a tick further along.
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await drain();

    // THE ACTION DID NOT HAPPEN. `setAppLockEnabled` is the persisted flag
    // `AppLockGate` reads at launch — writing it here on a device that just
    // failed to authenticate is exactly the brick this flow prevents.
    expect(setAppLockEnabledMock).not.toHaveBeenCalled();
    expect(lockSwitch()).not.toBeChecked();
    // …and the screen is usable: no success toast, and the grace picker (which
    // only renders under an armed lock) never appeared.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(confirmConsequentialMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Lock again")).not.toBeInTheDocument();
    // Silent by design — the OS already showed the sheet.
    expect(toastError).not.toHaveBeenCalled();
  });

  it("asks under onUnsecurableDevice: 'deny' — a device that can't authenticate must NOT arm", async () => {
    // The policy itself is proved in src/lib/biometricGate.test.ts. What is
    // proved here is that this call site still ASKS for it: dropping the
    // option (or flipping it to "allow") would make `requireBiometric` return
    // true on a phone with no biometry and no passcode, arming a lock nothing
    // on that device can open.
    renderTab();
    fireEvent.click(lockSwitch());
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalled());
    expect(requireBiometricMock.mock.calls[0][1]).toEqual({ onUnsecurableDevice: "deny" });
  });

  it("the OS prompt names the lock, not a generic 'confirm'", async () => {
    // A vague reason string on the sheet is how people learn to approve every
    // prompt without reading it.
    renderTab();
    fireEvent.click(lockSwitch());
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalled());
    expect(String(requireBiometricMock.mock.calls[0][0])).toMatch(/lock/i);
  });

  it("turning the lock OFF is deliberately NOT gated", async () => {
    // Pinned on purpose: someone whose Face ID stopped working must be able to
    // switch the lock off. Adding a gate here would be a lockout, not a
    // hardening — the account is still protected by the session, by
    // server-side authz, and by the gates on the money actions themselves.
    lockEnabled = true;
    renderTab();
    expect(lockSwitch()).toBeChecked();
    fireEvent.click(lockSwitch());

    await waitFor(() => expect(setAppLockEnabledMock).toHaveBeenCalledWith(false));
    expect(requireBiometricMock).not.toHaveBeenCalled();
    expect(lockSwitch()).not.toBeChecked();
  });
});

/*
 * TWO REGISTRATIONS, because two separate lines are load-bearing here and
 * either could be deleted alone.
 *
 *   1. `if (!ok)` — without it, a refused/cancelled/locked-out prompt still
 *      persists the flag and arms a lock the user may not be able to pass.
 *   2. `onUnsecurableDevice: "deny"` — without it, the gate returns TRUE on a
 *      device with neither biometry nor a passcode, which arms that same
 *      unpassable lock with no prompt at all.
 *
 * The real module returns true on web, so only the mocked refusal above can
 * see (1) disappear; only the argument assertion can see (2).
 */
// @mutate src/components/profile/SecurityTab.tsx | if (!ok) {\n      // User cancelled or failed — leave the switch off. The OS already showed\n      // the prompt, so no extra error toast.\n      setAppLockOn(false);\n      return;\n    } | if (false) { setAppLockOn(false); return; }
// @mutate src/components/profile/SecurityTab.tsx | onUnsecurableDevice: "deny", | onUnsecurableDevice: "allow",
