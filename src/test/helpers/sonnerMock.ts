/**
 * THE shared mock of "sonner" (LEAD-TOASTMOCK, 2026-10-31).
 *
 * The app's member confirmations are bare `toast(...)` calls (toast.success and toast.info render nothing under
 * toastPolicy). A test that mocked sonner as `{ toast: { success: vi.fn(), error: vi.fn() } }` made `toast` a plain
 * object, so a bare `toast("...")` threw "toast is not a function" inside the code under test: swallowed by an
 * onSuccess or a catch, it hid the confirmation and whatever ran after it (deliveryRoute.test.tsx, b81). Every test
 * that mocks sonner uses this instead (guard: src/test/sonnerMocksAreCallable.test.ts):
 *
 *   vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
 *
 * and reads the spies through `import { toast } from "sonner"` (`expect(toast).toHaveBeenCalledWith(...)`,
 * `vi.mocked(toast.error)`).
 */
import { vi, type Mock } from "vitest";

const METHODS = ["success", "error", "info", "warning", "message", "loading", "dismiss", "promise", "custom"] as const;
export type CallableToast = Mock & Record<(typeof METHODS)[number], Mock>;

export function callableToast(): CallableToast {
  return Object.assign(vi.fn(), Object.fromEntries(METHODS.map((m) => [m, vi.fn()]))) as unknown as CallableToast;
}

export function sonnerMock(): { toast: CallableToast; Toaster: () => null } {
  return { toast: callableToast(), Toaster: () => null };
}
