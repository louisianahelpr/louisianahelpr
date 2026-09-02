/**
 * A successful password change used to be SILENT: `:101` toasted on failure,
 * `:104-107` rendered nothing on success and just `setTimeout`-ed 800ms into
 * /dashboard. Measured 2026-09-01 in Chrome: 400ms after submit the form was
 * still on screen, untouched, and the URL was already /dashboard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ResetPassword from "./ResetPassword";

const updateUserMock = vi.fn();
const getSessionMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      updateUser: (...a: unknown[]) => updateUserMock(...a),
      getSession: (...a: unknown[]) => getSessionMock(...a),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }),
}));

vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const GOOD = "Abcdefg1234";

async function submitNewPassword() {
  render(
    <MemoryRouter initialEntries={["/reset-password"]}>
      <ResetPassword />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByLabelText(/New password/i)).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/New password/i), { target: { value: GOOD } });
  fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: GOOD } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Update Password/i }));
  });
}

describe("a successful password change leaves visible evidence", () => {
  beforeEach(() => {
    updateUserMock.mockReset().mockResolvedValue({ error: null });
    // A live recovery session, so the form (not the "use your email link"
    // branch) renders.
    getSessionMock.mockReset().mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    toastError.mockReset();
    navigateMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("renders a confirmation panel instead of nothing", async () => {
    await submitNewPassword();
    expect(await screen.findByText(/Password updated\./i)).toBeTruthy();
    // The form is gone — the old screen left it on display, filled in, as if
    // the tap had not registered.
    expect(screen.queryByRole("button", { name: /Update Password/i })).toBeNull();
  });

  it("announces it, so a screen-reader user gets the same evidence", async () => {
    await submitNewPassword();
    await screen.findByText(/Password updated\./i);
    const live = document.querySelector("[role='status']");
    expect(live).toBeTruthy();
    expect(live!.getAttribute("aria-live")).toBe("polite");
    expect((live as HTMLElement).textContent).toMatch(/Password updated/);
  });

  it("does not navigate away before the confirmation can be read", async () => {
    await submitNewPassword();
    await screen.findByText(/Password updated\./i);
    // The old delay was 800ms, which is shorter than it takes to notice a
    // screen changed at all.
    act(() => { vi.advanceTimersByTime(900); });
    expect(navigateMock).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(navigateMock).toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("offers a control so nobody has to wait out the timer", async () => {
    await submitNewPassword();
    fireEvent.click(await screen.findByRole("button", { name: /Go to Dashboard/i }));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("a FAILED change still shows the error and keeps the form", async () => {
    updateUserMock.mockResolvedValue({ error: { message: "New password should be different" } });
    await submitNewPassword();
    expect(toastError).toHaveBeenCalled();
    expect(screen.queryByText(/Password updated\./i)).toBeNull();
    expect(screen.getByRole("button", { name: /Update Password/i })).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
