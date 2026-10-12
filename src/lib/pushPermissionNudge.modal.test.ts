/**
 * Q1504: the "Turn on notifications?" nudge never shows over an open modal.
 * Seen 2026-10-07 at 375 on /posts: the nudge sat above a BrandConfirmDialog
 * and hid its "Send request" button until dismissed. The nudge now waits for
 * every open dialog to close; if one stays open past the wait it is skipped
 * and NOT marked shown, so the next trigger can try again. And a nudge that
 * is already up when a dialog opens (seen on prod 2026-10-12 at 375, the
 * Cancel dialog from a /posts job card) is dismissed at once, without the
 * 14-day cooldown and with its "shown" mark cleared.
 *
 * @mutate src/lib/pushPermissionNudge.ts |         if (!(await waitForNoModal())) return;\n | \n
 * @mutate src/lib/pushPermissionNudge.ts |           toast.dismiss(id); |           void id;
 * @mutate src/lib/pushPermissionNudge.ts |             if (!yieldedToModal) recordNudgeDismissal(); |             recordNudgeDismissal();
 * @mutate src/lib/pushPermissionNudge.ts |           unmarkNudgeShown(reason); |           void reason;
 * @mutate src/lib/pushPermissionNudge.ts | export const OPEN_MODAL_SELECTOR = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'; | export const OPEN_MODAL_SELECTOR = '[role="dialog"][data-state="open"]';
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const toast = vi.fn((..._a: unknown[]) => "nudge-1");
const dismiss = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign((...a: unknown[]) => toast(...a), { dismiss: (...a: unknown[]) => dismiss(...a) }) }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), get: vi.fn(), keys: vi.fn() },
}));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/lib/pushNotifications", () => ({ isPushSupported: () => true, getPushPermission: () => "default" }));
vi.mock("@/lib/nativePush", () => ({ useRequestPushPermission: () => async () => true }));
vi.mock("@/hooks/usePermissionRationale", () => ({ markRationaleConfirmed: vi.fn() }));

import { NUDGE_DISMISSED_KEY, NUDGE_SHOWN_PREFIX, modalIsOpen, usePushPermissionNudge } from "./pushPermissionNudge";

function openModal(role: "dialog" | "alertdialog") {
  const el = document.createElement("div");
  el.setAttribute("role", role);
  el.setAttribute("data-state", "open");
  document.body.appendChild(el);
  return el;
}

describe("Q1504: the push nudge waits for an open modal to close", () => {
  beforeEach(() => {
    localStorage.clear();
    toast.mockClear();
    dismiss.mockClear();
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("inventory: the Radix dialog, alert dialog and a closed one are told apart", () => {
    expect(modalIsOpen()).toBe(false);
    const d = openModal("alertdialog");
    expect(modalIsOpen()).toBe(true);
    d.setAttribute("data-state", "closed");
    expect(modalIsOpen()).toBe(false);
  });

  for (const role of ["dialog", "alertdialog"] as const) {
    it(`no toast while a ${role} is open; it shows once the ${role} closes`, async () => {
      const modal = openModal(role);
      const { result } = renderHook(() => usePushPermissionNudge());
      let done!: Promise<void>;
      act(() => {
        done = result.current("customer-first-bid");
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(toast).not.toHaveBeenCalled();
      modal.remove();
      await vi.advanceTimersByTimeAsync(600);
      await done;
      expect(toast).toHaveBeenCalledTimes(1);
    });
  }

  it("a modal still open after the wait: skipped, and not marked shown", async () => {
    openModal("dialog");
    const { result } = renderHook(() => usePushPermissionNudge());
    let done!: Promise<void>;
    act(() => {
      done = result.current("customer-first-bid");
    });
    await vi.advanceTimersByTimeAsync(121_000);
    await done;
    expect(toast).not.toHaveBeenCalled();
    expect(localStorage.getItem(`${NUDGE_SHOWN_PREFIX}customer-first-bid`)).toBeNull();
  });

  it("no modal: shows at once", async () => {
    const { result } = renderHook(() => usePushPermissionNudge());
    await act(async () => {
      await result.current("customer-first-bid");
    });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  // Seen on prod 2026-10-12 at 375 (poster-e2e, /posts): the nudge was already
  // up when a job card's Cancel dialog opened, and stayed over the dialog.
  for (const role of ["dialog", "alertdialog"] as const) {
    it(`already up when a ${role} opens: dismissed at once, no cooldown, asked again next time`, async () => {
      const { result } = renderHook(() => usePushPermissionNudge());
      await act(async () => {
        await result.current("customer-first-bid");
      });
      expect(toast).toHaveBeenCalledTimes(1);
      expect(dismiss).not.toHaveBeenCalled();
      openModal(role);
      await vi.advanceTimersByTimeAsync(0);
      expect(dismiss).toHaveBeenCalledWith("nudge-1");
      // sonner calls onDismiss for a programmatic dismiss: it must not set the cooldown.
      const opts = toast.mock.calls[0][1] as { onDismiss: () => void };
      opts.onDismiss();
      expect(localStorage.getItem(NUDGE_DISMISSED_KEY)).toBeNull();
      expect(localStorage.getItem(`${NUDGE_SHOWN_PREFIX}customer-first-bid`)).toBeNull();
    });
  }

  it("the user's own x still sets the cooldown, and a later dialog does nothing", async () => {
    const { result } = renderHook(() => usePushPermissionNudge());
    await act(async () => {
      await result.current("customer-first-bid");
    });
    const opts = toast.mock.calls[0][1] as { onDismiss: () => void };
    opts.onDismiss();
    expect(localStorage.getItem(NUDGE_DISMISSED_KEY)).not.toBeNull();
    openModal("dialog");
    await vi.advanceTimersByTimeAsync(0);
    expect(dismiss).not.toHaveBeenCalled();
    expect(localStorage.getItem(`${NUDGE_SHOWN_PREFIX}customer-first-bid`)).toBe("1");
  });
});
