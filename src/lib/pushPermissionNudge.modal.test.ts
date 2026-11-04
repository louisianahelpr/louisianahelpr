/**
 * Q1504: the notifications ask never shows over an open modal. Seen
 * 2026-10-07 at 375 on /posts: the old "Get notified?" toast sat above a
 * BrandConfirmDialog and hid its "Send request" button. The toast is gone
 * (Q2003); the ask is now the in-app sheet (src/hooks/useWebPush.ts), which
 * still waits on waitForNoModal before it opens, so the modal detection it
 * relies on is pinned here.
 *
 * @mutate src/lib/pushPermissionNudge.ts | export const OPEN_MODAL_SELECTOR = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'; | export const OPEN_MODAL_SELECTOR = '[role="dialog"][data-state="open"]';
 * @mutate src/lib/pushPermissionNudge.ts |     if (Date.now() >= until) return false; |     if (Date.now() >= until) return true;
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/lib/pushNotifications", () => ({ isPushSupported: () => true, getPushPermission: () => "default" }));

import { modalIsOpen, waitForNoModal } from "./pushPermissionNudge";

function openModal(role: "dialog" | "alertdialog") {
  const el = document.createElement("div");
  el.setAttribute("role", role);
  el.setAttribute("data-state", "open");
  document.body.appendChild(el);
  return el;
}

describe("Q1504: the ask waits for an open modal to close", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("inventory: the Radix dialog, alert dialog and a closed one are told apart", () => {
    expect(modalIsOpen()).toBe(false);
    for (const role of ["dialog", "alertdialog"] as const) {
      const d = openModal(role);
      expect(modalIsOpen(), role).toBe(true);
      d.setAttribute("data-state", "closed");
      expect(modalIsOpen(), `${role} closed`).toBe(false);
    }
  });

  it("no modal: resolves true at once", async () => {
    await expect(waitForNoModal(1000)).resolves.toBe(true);
  });

  it("resolves true once the modal closes", async () => {
    const d = openModal("alertdialog");
    const p = waitForNoModal(10_000, 500);
    await vi.advanceTimersByTimeAsync(1000);
    d.setAttribute("data-state", "closed");
    await vi.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toBe(true);
  });

  it("a modal still open after the wait: false, so the ask is skipped", async () => {
    openModal("dialog");
    const p = waitForNoModal(2000, 500);
    await vi.advanceTimersByTimeAsync(2600);
    await expect(p).resolves.toBe(false);
  });
});
