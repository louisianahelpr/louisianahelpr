// V-005 — the app-lock screen rendered perfectly and was completely inert.
//
// If a Radix dialog was open when the app was backgrounded, the lock came back
// looking exactly right and NOTHING on it responded. Recovery was
// force-quitting the app. Cause: an open Radix modal sets
// `pointer-events: none` on <body>, `pointer-events` inherits, and the lock
// panel rendered inline inside #root — itself a <body> child — with no
// override. Measured in Chromium and WebKit: the Unlock handler fired zero
// times.
//
// THESE TESTS DELIBERATELY DO NOT ASSERT "THE LOCK RENDERS". It always
// rendered; rendering is what made the bug invisible. What they assert is the
// three things that were actually missing, each of which fails against the
// pre-fix component:
//
//   1. the panel is a direct child of <body> (portaled out of the transformed
//      #root subtree, so `position: fixed` really is viewport-relative);
//   2. it declares `pointer-events: auto`, so the inherited `none` from an
//      open Radix modal cannot reach it — jsdom does not hit-test
//      pointer-events, so the assertion is on the declaration, which is the
//      thing whose absence was the defect;
//   3. `aria-hidden="true"` stamped on it after mount (which is exactly what
//      Radix's hideOthers() does to late-added <body> children) is stripped
//      back off, so the lock is never
//      `role="dialog" aria-modal="true" aria-hidden="true"`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

// Default FALSE — the user dismissed the OS sheet. The gate auto-prompts once
// on a cold start, so a mock that resolves `true` would unlock the screen out
// from under every assertion below and make these tests race the runtime.
let biometricPasses = false;
const requireBiometricMock = vi.fn(async () => biometricPasses);

vi.mock("@/lib/biometricGate", () => ({
  getBiometryLabel: async () => "Face ID",
  isBiometricPromptOpen: () => false,
  requireBiometric: (...args: unknown[]) => requireBiometricMock(...(args as [])),
}));

vi.mock("@/lib/appLock", () => ({
  APP_LOCK_DEMO: false,
  APP_LOCK_DEMO_EMAIL: "demo@louisianahelpr.test",
  clearBackgroundedAt: vi.fn(),
  isAppLockEnabled: () => true,
  isAppLockSupported: () => true,
  readBackgroundedAt: () => null,
  recordBackgroundedAt: vi.fn(),
  shouldLockOnFreshStart: () => true,
  shouldLockOnResume: () => true,
}));

vi.mock("@/lib/safeStorage", () => ({
  ensureHydrated: async () => undefined,
}));

vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: { id: "u1", email: "owner@example.com" }, isReady: true }),
}));

// The gate dynamically imports @capacitor/app for its lifecycle listeners.
vi.mock("@capacitor/app", () => ({
  App: { addListener: async () => ({ remove: async () => undefined }) },
}));

import { AppLockGate } from "./AppLockGate";

/** What Radix does to <body> for the whole life of an open modal. */
function openRadixModal() {
  document.body.style.pointerEvents = "none";
}

beforeEach(() => {
  requireBiometricMock.mockClear();
  biometricPasses = false;
  document.body.style.pointerEvents = "";
});

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
});

describe("AppLockGate — reachable while a Radix modal holds <body> inert", () => {
  it("portals the lock panel to <body> rather than nesting it in the app tree", async () => {
    const { container } = render(
      <AppLockGate>
        <div data-testid="app">app</div>
      </AppLockGate>,
    );

    const panel = await screen.findByRole("dialog", { name: /locked/i });

    // Portaled: NOT inside the render container (#root's stand-in), and a
    // direct child of <body>. An inline panel is a `position: fixed`
    // descendant of whatever transform / backdrop-filter happens to be above
    // it, which makes "fixed inset-0" size to a panel instead of the viewport.
    expect(container.contains(panel)).toBe(false);
    expect(panel.parentElement).toBe(document.body);
  });

  it("declares pointer-events:auto so an open modal's inherited `none` cannot reach it", async () => {
    openRadixModal();
    render(
      <AppLockGate>
        <div>app</div>
      </AppLockGate>,
    );

    const panel = await screen.findByRole("dialog", { name: /locked/i });

    // The precondition the bug needed — assert it really is in force, so a
    // future change to how Radix inerts <body> cannot quietly neuter this test.
    expect(document.body.style.pointerEvents).toBe("none");

    // The fix. Without it the panel declares nothing, inherits `none`, and
    // every tap on the Unlock button lands on no one.
    expect(panel.style.pointerEvents).toBe("auto");
    expect(getComputedStyle(panel).pointerEvents).toBe("auto");

    // And the button inside it must not be independently opted out.
    const button = screen.getByRole("button", { name: /unlock/i });
    expect(getComputedStyle(button).pointerEvents).not.toBe("none");
  });

  it("clicking Unlock while <body> is inert still runs the unlock", async () => {
    openRadixModal();
    render(
      <AppLockGate>
        <div>app</div>
      </AppLockGate>,
    );

    const button = await screen.findByRole("button", { name: /unlock/i });

    // Let the cold-start auto-prompt fire and be declined first, so the count
    // below can only have come from the click. `disabled` mirrors `checking`,
    // so an enabled button means that round-trip has settled and the
    // stacked-prompt guard is no longer swallowing input.
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("dialog", { name: /locked/i })).toBeTruthy();

    biometricPasses = true;
    button.click();

    // The click reached the handler — this is the count that was ZERO in both
    // Chromium and WebKit before the fix.
    await waitFor(() => expect(requireBiometricMock).toHaveBeenCalledTimes(2));
    // ...and the lock actually comes down, rather than the handler firing into
    // a screen that stays up.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /locked/i })).toBeNull(),
    );
  });

  it("un-hides itself when hideOthers() stamps aria-hidden on it", async () => {
    render(
      <AppLockGate>
        <div>app</div>
      </AppLockGate>,
    );

    const panel = await screen.findByRole("dialog", { name: /locked/i });

    // Exactly what the `aria-hidden` package does to every <body> child that
    // is not the active dialog — including nodes added after it ran.
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("data-aria-hidden", "true");

    await waitFor(() => {
      expect(panel.getAttribute("aria-hidden")).toBeNull();
      expect(panel.getAttribute("data-aria-hidden")).toBeNull();
    });
  });
});
