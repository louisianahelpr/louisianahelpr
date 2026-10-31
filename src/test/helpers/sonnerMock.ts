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
import { vi } from "vitest";

export function callableToast() {
  return Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
    custom: vi.fn(),
  });
}

export function sonnerMock() {
  return { toast: callableToast(), Toaster: () => null };
}
