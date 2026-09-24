/**
 * A successful password change used to be SILENT: `:101` toasted on failure,
 * `:104-107` rendered nothing on success and just `setTimeout`-ed 800ms into
 * /home. Measured 2026-09-01 in Chrome: 400ms after submit the form was
 * still on screen, untouched, and the URL was already /home.
 *
 * OA-006: the panel promises other devices must re-authenticate; the page now
 * revokes every other session (signOut scope "others") and says so honestly
 * when that fails.
 *
 * @mutate src/pages/auth/ResetPassword.tsx | setOthersSignedOut(await signOutOtherDevices()); | setOthersSignedOut(true);
 * @mutate src/lib/authSignOut.ts | return !error; | return true;
 *
 * OA-014: a `#type=recovery` fragment alone no longer unlocks the form; it
 * waits for a real session and calls the link dead if none arrives.
 *
 * @mutate src/pages/auth/ResetPassword.tsx | if (hashParams.get("type") === "recovery" && !hashParams.get("error")) { | if (hashParams.get("type") === "recovery" && !hashParams.get("error")) { setReady(true);
 * @mutate src/pages/auth/ResetPassword.tsx | setLinkError((cur) => cur ?? "expired"); | void 0;
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ResetPassword from "./ResetPassword";

const updateUserMock = vi.fn();
const getSessionMock = vi.fn();
const signOutMock = vi.fn();
let authCb: ((e: string, s: unknown) => void) | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      updateUser: (...a: unknown[]) => updateUserMock(...a),
      getSession: (...a: unknown[]) => getSessionMock(...a),
      signOut: (...a: unknown[]) => signOutMock(...a),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCb = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
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

// A password the SUPABASE PROJECT accepts, not merely one this screen used to
// accept. The old value here was "Abcdefg1234" — 11 characters, no symbol —
// which satisfied the three rules the form stated and would have been refused
// by prod with 422 weak_password. See PASSWORD_RULES in signupHelpers for the
// probe that established the real policy (12 chars + all four classes).
const GOOD = "Qa#Helpr2026!x";

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
    signOutMock.mockReset().mockResolvedValue({ error: null });
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

  it("revokes every other session, so the promise on the panel is kept (OA-006)", async () => {
    await submitNewPassword();
    await screen.findByText(/Password updated\./i);
    expect(signOutMock).toHaveBeenCalledWith({ scope: "others" });
    expect(screen.getByText(/Anywhere else you were signed in will ask/i)).toBeTruthy();
  });

  it("says so instead of promising it when revoking the other sessions fails", async () => {
    signOutMock.mockResolvedValue({ error: { message: "boom" } });
    await submitNewPassword();
    await screen.findByText(/Password updated\./i);
    expect(screen.queryByText(/Anywhere else you were signed in will ask/i)).toBeNull();
    expect(screen.getByText(/couldn.t sign out your other devices/i)).toBeTruthy();
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
    expect(navigateMock).toHaveBeenCalledWith("/home", { replace: true });
  });

  it("offers a control so nobody has to wait out the timer", async () => {
    await submitNewPassword();
    fireEvent.click(await screen.findByRole("button", { name: /Go to Dashboard/i }));
    expect(navigateMock).toHaveBeenCalledWith("/home", { replace: true });
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

/**
 * The failure this screen could not report.
 *
 * External QA typed `CoworkQA2026x` into both fields. The helper text said "At
 * least 8 characters, 1 uppercase, 1 number", the meter said "Strong", the
 * green tick and "✓ Passwords match" both showed, the button was enabled — and
 * `PUT /auth/v1/user` answered 422 `weak_password`, because the project also
 * requires a symbol and twelve characters. Nothing on screen said so. What DID
 * appear was "Couldn't sign you in — give it another try?", the login-flavoured
 * fallback in `friendlyAuthError`, on a page where the sign-in had already
 * succeeded — and it stacked a copy per tap.
 */
describe("a REFUSED password says why", () => {
  beforeEach(() => {
    updateUserMock.mockReset().mockResolvedValue({ error: null });
    getSessionMock.mockReset().mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    toastError.mockReset();
    navigateMock.mockReset();
  });

  async function typeAndSubmit(password: string) {
    render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <ResetPassword />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByLabelText(/New password/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/New password/i), { target: { value: password } });
    fireEvent.change(screen.getByLabelText(/Confirm password/i), { target: { value: password } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update Password/i }));
    });
  }

  it("names the missing rule instead of sending a request the server will refuse", async () => {
    await typeAndSubmit("CoworkQA2026x");
    // Caught in the client — no round-trip, so no 422 to mistranslate.
    expect(updateUserMock).not.toHaveBeenCalled();
    // And the reason is IN THE FORM, not only in a toast that expires in 4s.
    const inline = document.getElementById("reset-password-error");
    expect(inline).toBeTruthy();
    expect(inline!.textContent).toMatch(/symbol/i);
    expect(inline!.getAttribute("role")).toBe("alert");
  });

  it("never blames the sign-in for a password the server refused", async () => {
    // Client rules pass, server refuses anyway — the policy-drift case. The
    // guarantee is that the server's own reason reaches the user; the one
    // thing that must never happen is it being replaced by a sign-in error.
    updateUserMock.mockResolvedValue({
      error: { code: "weak_password", message: "Password should be at least 12 characters." },
    });
    await typeAndSubmit(GOOD);
    const inline = document.getElementById("reset-password-error");
    expect(inline).toBeTruthy();
    expect(inline!.textContent).not.toMatch(/sign you in/i);
    expect(inline!.textContent).toMatch(/12 characters/);
  });

  it("replaces the message on a repeat tap rather than stacking copies", async () => {
    await typeAndSubmit("CoworkQA2026x");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update Password/i }));
      fireEvent.click(screen.getByRole("button", { name: /Update Password/i }));
    });
    // Every call carries the same sonner id, which is what makes the third tap
    // replace the first toast instead of adding a third one to the pile.
    expect(toastError).toHaveBeenCalled();
    for (const call of toastError.mock.calls) {
      expect((call[1] as { id?: string } | undefined)?.id).toBe("reset-password-error");
    }
  });
});

// Shown able to fail:
// Drop the early return, so a password the project policy refuses is sent to
// /auth/v1/user anyway and comes back as a 422 this screen then has to translate —
// the account-recovery lockout this guard exists to prevent.
// @mutate src/pages/auth/ResetPassword.tsx | if (problem) { fail(problem); return; } | if (problem) { fail(problem); }

describe("a recovery fragment is a claim, not a session (OA-014)", () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    authCb = null;
    window.history.replaceState(null, "", "/reset-password#type=recovery&access_token=stale");
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <ResetPassword />
      </MemoryRouter>,
    );

  it("shows no form while the link is being checked", async () => {
    renderPage();
    expect(await screen.findByText(/Checking your reset link/i)).toBeTruthy();
    expect(screen.queryByLabelText(/New password/i)).toBeNull();
  });

  it("calls the link expired when no session ever arrives", async () => {
    renderPage();
    await screen.findByText(/Checking your reset link/i);
    await act(async () => { vi.advanceTimersByTime(9000); });
    expect(await screen.findByText(/link has expired/i)).toBeTruthy();
    expect(screen.queryByLabelText(/New password/i)).toBeNull();
  });

  it("opens the form once the recovery session exists", async () => {
    renderPage();
    await screen.findByText(/Checking your reset link/i);
    await act(async () => { authCb?.("PASSWORD_RECOVERY", { user: { id: "u1" } }); });
    expect(await screen.findByLabelText(/New password/i)).toBeTruthy();
  });
});
