/**
 * A signed-in screen whose device has lost its session goes to Log In instead
 * of sitting on failed loads (2026-10-09: Kaci L. and Destiny O. sat on "We
 * couldn't load this" for minutes after their email-confirm landing; every
 * read came back "permission denied" with no JWT on the request).
 *
 * And it goes there ONLY when the session is really gone (2026-10-09 21:45Z,
 * the owner's Mac): a token refresh that failed on the network made
 * getSession() null for about a second while the session was alive, and this
 * net sent the owner to Log In. It now asks refreshSession() first and never
 * redirects on a network failure (src/lib/sessionLoss.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const useCurrentUserMock = vi.fn();
const getSessionMock = vi.fn();
const refreshSessionMock = vi.fn();
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => useCurrentUserMock() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: { ForcedLogoutBounce: "forced_logout_bounce" } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => getSessionMock(), refreshSession: () => refreshSessionMock() } },
}));

import ProtectedRoute from "./ProtectedRoute";
import { PERMISSION_DENIED_EVENT } from "@/lib/permissionDenied";

const signedIn = {
  user: { id: "u1", email_confirmed_at: "2026-08-01T00:00:00Z" },
  profile: { full_name: "A B", avatar_url: "x", date_of_birth: "1990-01-01", phone: "1", location: "Rayne" },
  isLoading: false,
  isError: false,
  refresh: vi.fn(),
};

const NETWORK = { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" };

const replace = vi.fn();
beforeEach(() => {
  useCurrentUserMock.mockReturnValue(signedIn);
  replace.mockReset();
  getSessionMock.mockReset();
  refreshSessionMock.mockReset();
  vi.stubGlobal("location", { ...window.location, replace });
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/profile?tab=payment"]}>
      <Routes>
        <Route path="/profile" element={<ProtectedRoute><div>PROTECTED</div></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>,
  );

const deny = () => act(() => { window.dispatchEvent(new CustomEvent(PERMISSION_DENIED_EVENT)); });
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("ProtectedRoute: session lost on a signed-in screen", () => {
  it("goes to Log In with a note when a refresh confirms no session is left", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    refreshSessionMock.mockResolvedValue({
      data: { session: null, user: null },
      error: { name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" },
    });
    mount();
    deny();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?redirect=%2Fprofile%3Ftab%3Dpayment&signed_out=session-lost"));
  });

  it("goes to Log In when the auth server refuses the refresh token (a definite 4xx)", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    refreshSessionMock.mockResolvedValue({
      data: { session: null, user: null },
      error: { name: "AuthApiError", status: 400, message: "Invalid Refresh Token: Refresh Token Not Found" },
    });
    mount();
    deny();
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it("stays put when the session is still there (a real refusal, not a lost sign-in)", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    mount();
    deny();
    await settle();
    expect(replace).not.toHaveBeenCalled();
  });

  // The owner's Mac, 2026-10-09 21:45Z.
  it("stays put when getSession() is null but the refresh failed on the NETWORK", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: NETWORK });
    refreshSessionMock.mockResolvedValue({ data: { session: null, user: null }, error: NETWORK });
    mount();
    deny();
    await settle();
    expect(refreshSessionMock).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("stays put when getSession() is null but refreshSession() brings the session back", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: NETWORK });
    refreshSessionMock.mockResolvedValue({ data: { session: { access_token: "t2" }, user: { id: "u1" } }, error: null });
    mount();
    deny();
    await settle();
    expect(replace).not.toHaveBeenCalled();
  });

  // Review 2026-10-09: a concurrent refresh discarded by auth-js (409) is a no-op.
  it("stays put when auth-js discards the refresh because another tab stored a newer session (409)", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    refreshSessionMock.mockResolvedValue({
      data: { session: null, user: null },
      error: { name: "AuthRefreshDiscardedError", status: 409, message: "Refresh discarded" },
    });
    mount();
    deny();
    await settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it("stays put when a fresh session appears before the answer (last look)", async () => {
    getSessionMock
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValue({ data: { session: { access_token: "t3" } }, error: null });
    refreshSessionMock.mockResolvedValue({
      data: { session: null, user: null },
      error: { name: "AuthApiError", status: 400, message: "Invalid Refresh Token: Already Used" },
    });
    mount();
    deny();
    await settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not redirect when the screen unmounts before the check answers", async () => {
    let answer!: (v: unknown) => void;
    getSessionMock.mockReturnValueOnce(new Promise((r) => { answer = r; })).mockResolvedValue({ data: { session: null }, error: null });
    refreshSessionMock.mockResolvedValue({
      data: { session: null, user: null },
      error: { name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" },
    });
    const { unmount } = mount();
    deny();
    unmount();
    answer({ data: { session: null }, error: null });
    await settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it("stays put on a server error (5xx) during the refresh", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    refreshSessionMock.mockResolvedValue({ data: { session: null, user: null }, error: { name: "AuthRetryableFetchError", status: 502, message: "Bad Gateway" } });
    mount();
    deny();
    await settle();
    expect(replace).not.toHaveBeenCalled();
  });
});

// @mutate src/components/ProtectedRoute.tsx |         if (cancelled \|\| fired \|\| !lost) return; |         if (fired \|\| !lost) return;
// @mutate src/lib/sessionLoss.ts |   if (err.name !== "AuthApiError") return false;\n | \n
// @mutate src/lib/sessionLoss.ts |     return !after.session; |     return true;
// @mutate src/lib/sessionLoss.ts |     if (!isDefiniteAuthLoss(error)) return false; |     if (false) return false;
