/**
 * A signed-in screen whose device has lost its session goes to Log In instead
 * of sitting on failed loads (2026-10-09: Kaci L. and Destiny O. sat on "We
 * couldn't load this" for minutes after their email-confirm landing; every
 * read came back "permission denied" with no JWT on the request).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const useCurrentUserMock = vi.fn();
const getSessionMock = vi.fn();
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => useCurrentUserMock() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: { ForcedLogoutBounce: "forced_logout_bounce" } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: () => getSessionMock() } } }));

import ProtectedRoute from "./ProtectedRoute";
import { PERMISSION_DENIED_EVENT } from "@/lib/permissionDenied";

const signedIn = {
  user: { id: "u1", email_confirmed_at: "2026-08-01T00:00:00Z" },
  profile: { full_name: "A B", avatar_url: "x", date_of_birth: "1990-01-01", phone: "1", location: "Rayne" },
  isLoading: false,
  isError: false,
  refresh: vi.fn(),
};

const replace = vi.fn();
beforeEach(() => {
  useCurrentUserMock.mockReturnValue(signedIn);
  replace.mockReset();
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

describe("ProtectedRoute: session lost on a signed-in screen", () => {
  it("goes to Log In with a note when a permission-denied arrives and no session is left", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    mount();
    act(() => { window.dispatchEvent(new CustomEvent(PERMISSION_DENIED_EVENT)); });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?redirect=%2Fprofile%3Ftab%3Dpayment&signed_out=session-lost"));
  });

  it("stays put when the session is still there (a real refusal, not a lost sign-in)", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mount();
    act(() => { window.dispatchEvent(new CustomEvent(PERMISSION_DENIED_EVENT)); });
    await new Promise((r) => setTimeout(r, 20));
    expect(replace).not.toHaveBeenCalled();
  });
});

// @mutate src/components/ProtectedRoute.tsx |         if (fired \|\| data.session) return; |         if (fired) return;
