import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SignupPending from "./SignupPending";

const resendMock = vi.fn();
const getSessionMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resend: (...args: unknown[]) => resendMock(...args),
      getSession: (...args: unknown[]) => getSessionMock(...args),
      // AuthShell renders the shared Navbar on web, which reads useAuthReady.
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const EMAIL = "jane.doe@example.com";
const STORAGE_KEY = "helpr.pendingSignupEmail";

/** Renders the screen as if Signup had navigated here with `state.email`. */
const renderWithRouterState = (email?: string) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/signup-pending", state: email ? { email } : null }]}>
      <SignupPending />
    </MemoryRouter>,
  );

const noSession = { data: { session: null }, error: null };

describe("SignupPending", () => {
  beforeEach(() => {
    resendMock.mockReset().mockResolvedValue({ error: null });
    getSessionMock.mockReset().mockResolvedValue(noSession);
    toastSuccess.mockReset();
    toastError.mockReset();
    navigateMock.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the address it's waiting on", () => {
    it("shows the address passed in router state", async () => {
      renderWithRouterState(EMAIL);
      expect(await screen.findByText(EMAIL)).toBeInTheDocument();
    });

    it("survives a reload — router state is lost, the address is not", async () => {
      // First visit seeds storage…
      const first = renderWithRouterState(EMAIL);
      await screen.findByText(EMAIL);
      first.unmount();

      // …a reload arrives with NO router state (it lives in the history entry).
      renderWithRouterState(undefined);
      expect(await screen.findByText(EMAIL)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /resend/i })).toBeInTheDocument();
    });

    it("degrades honestly when no address is known anywhere", async () => {
      renderWithRouterState(undefined);
      // The sentence is assembled from several JSX children, so match the
      // paragraph as a whole rather than a single text node.
      expect(
        await screen.findByText(
          (_, el) => el?.tagName === "P" && /verification link to your email/i.test(el.textContent ?? ""),
        ),
      ).toBeInTheDocument();
      // Nothing to resend TO, so the control isn't offered…
      expect(screen.queryByRole("button", { name: /resend/i })).not.toBeInTheDocument();
      // …but the route that does work still is.
      expect(screen.getByRole("link", { name: /start over/i })).toBeInTheDocument();
    });
  });

  describe("resend", () => {
    it("sends to the known address on one tap and reports back", async () => {
      renderWithRouterState(EMAIL);
      fireEvent.click(await screen.findByRole("button", { name: /resend/i }));

      await waitFor(() => {
        expect(resendMock).toHaveBeenCalledWith({ type: "signup", email: EMAIL });
      });
      const button = await screen.findByRole("button", { name: /resent/i });
      expect(button).toBeDisabled();
    });

    it("surfaces a rate limit — 'slow down' is actionable", async () => {
      resendMock.mockResolvedValue({ error: { message: "Email rate limit exceeded" } });
      renderWithRouterState(EMAIL);
      fireEvent.click(await screen.findByRole("button", { name: /resend/i }));

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      // Still offering the retry it just told them to make.
      expect(screen.getByRole("button", { name: /^resend$/i })).toBeInTheDocument();
    });

    it("hides every other failure — this screen is not an account oracle", async () => {
      // Supabase with enumeration protection OFF answers like this for an
      // address that has no account. Reporting it would let anyone test which
      // emails are registered, so it has to look exactly like success.
      resendMock.mockResolvedValue({ error: { message: "User not found" } });
      renderWithRouterState(EMAIL);
      fireEvent.click(await screen.findByRole("button", { name: /resend/i }));

      expect(await screen.findByRole("button", { name: /resent/i })).toBeInTheDocument();
      expect(toastError).not.toHaveBeenCalled();
    });
  });

  describe("waiting for the click in the inbox", () => {
    it("stays put while the account is unconfirmed", async () => {
      renderWithRouterState(EMAIL);
      await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it("advances the moment the session comes back confirmed", async () => {
      getSessionMock.mockResolvedValue({
        data: { session: { user: { email_confirmed_at: "2026-07-26T12:00:00Z" } } },
        error: null,
      });
      renderWithRouterState(EMAIL);

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/complete-profile", { replace: true });
      });
      // The pending address is spent — it must not outlive the wait.
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("keeps polling, so a confirmation mid-wait is still caught", async () => {
      vi.useFakeTimers();
      renderWithRouterState(EMAIL);
      await act(async () => { await Promise.resolve(); });
      const callsAfterMount = getSessionMock.mock.calls.length;

      getSessionMock.mockResolvedValue({
        data: { session: { user: { email_confirmed_at: "2026-07-26T12:00:00Z" } } },
        error: null,
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

      expect(getSessionMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
      expect(navigateMock).toHaveBeenCalledWith("/complete-profile", { replace: true });
    });

    it("ignores a session error rather than routing on bad data", async () => {
      getSessionMock.mockResolvedValue({ data: { session: null }, error: { message: "network" } });
      renderWithRouterState(EMAIL);
      await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });
});
