/**
 * Whole-app audit 11-10, Builder 2:
 *   F260p/F487 a signed-in screen whose session ended mid-use bounced to Login saying "Your profile needs an account",
 *     as if the member were a stranger. When the screen HAD a user and the app's own Sign out was not pressed, the
 *     bounce now carries signed_out=session-lost, so Login says "You were signed out on this browser...".
 *     (A device whose storage was cleared before the visit has no signal and keeps the gated-page line.)
 *   F252 /payment-success and /complete-profile told a returning member to create an account; they say log in.
 *   F456 the Two-step verification card said "Authenticator code at sign-in."; it says what it adds.
 *
 * @mutate src/components/ProtectedRoute.tsx |   if (user) hadUser.current = true; |
 * @mutate src/components/ProtectedRoute.tsx |     const lostMidUse = hadUser.current && !signedOutOnPurposeRecently(); |     const lostMidUse = hadUser.current;
 * @mutate src/lib/unexpectedSignOut.ts |   return since >= 0 && since < INTENTIONAL_WINDOW_MS; |   return since < INTENTIONAL_WINDOW_MS;
 * @mutate src/pages/auth/loginNotice.ts |   if (returning) return `${returning} ${LOG_BACK_IN}`; |
 * @mutate src/pages/auth/loginNotice.ts |   ["/complete-profile", "Log in to finish your profile."], |
 * @mutate src/components/profile/TwoFactorCard.tsx | Extra safety: a 6-digit app code when you | Authenticator code at
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

const useCurrentUserMock = vi.fn();
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => useCurrentUserMock() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: { ForcedLogoutBounce: "forced_logout_bounce" } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn(), refreshSession: vi.fn() } },
}));

import ProtectedRoute from "@/components/ProtectedRoute";
import { markIntentionalSignOut, signedOutOnPurposeRecently } from "@/lib/unexpectedSignOut";
import { gatedPageNotice, loginNotice } from "@/pages/auth/loginNotice";

const signedIn = {
  user: { id: "u1", email_confirmed_at: "2026-08-01T00:00:00Z" },
  profile: { full_name: "A B", avatar_url: "x", date_of_birth: "1990-01-01", phone: "1", location: "Rayne" },
  isLoading: false,
  isError: false,
  refresh: vi.fn(),
};
const signedOut = { user: null, profile: null, isLoading: false, isError: false, refresh: vi.fn() };

function LoginProbe() {
  const loc = useLocation();
  return <div data-testid="login">{loc.pathname + loc.search}</div>;
}

// A fresh element each time: React skips a child whose element object is unchanged, so a rerender with the same
// `tree` constant would never re-run ProtectedRoute.
const tree = () => (
  <Routes>
    <Route path="/profile" element={<ProtectedRoute><div>PROTECTED</div></ProtectedRoute>} />
    <Route path="/login" element={<LoginProbe />} />
  </Routes>
);
const mount = () => render(<MemoryRouter initialEntries={["/profile?tab=settings"]}>{tree()}</MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
});
afterEach(() => cleanup());

describe("F260p/F487: a screen that loses its user mid-use says so on Login", () => {
  it("bounces with signed_out=session-lost after it had a user and nobody pressed Sign out", () => {
    // No Sign out in the last 15 s: an earlier test's mark is dated far in the past.
    vi.useFakeTimers({ now: Date.now() + 60_000 });
    useCurrentUserMock.mockReturnValue(signedIn);
    const r = mount();
    expect(screen.getByText("PROTECTED")).toBeTruthy();
    useCurrentUserMock.mockReturnValue(signedOut);
    r.rerender(<MemoryRouter initialEntries={["/profile?tab=settings"]}>{tree()}</MemoryRouter>);
    expect(screen.getByTestId("login").textContent).toBe("/login?redirect=%2Fprofile%3Ftab%3Dsettings&signed_out=session-lost");
    // Login turns that into the signed-out line, not "needs an account".
    const n = loginNotice({ oauthError: null, connect: null, signedOutForInactivity: false, sessionLost: true, arrivedFromSignup: false, bouncedFromGatedRoute: true, redirect: "/profile?tab=settings" });
    expect(n.notice).toMatch(/^You were signed out on this browser\./);
    expect(n.leadWithSignup).toBe(false);
  });

  it("a fresh visit with no session (storage cleared) keeps the plain gated bounce", () => {
    useCurrentUserMock.mockReturnValue(signedOut);
    mount();
    expect(screen.getByTestId("login").textContent).toBe("/login?redirect=%2Fprofile%3Ftab%3Dsettings");
  });

  it("the app's own Sign out is not a lost session", () => {
    useCurrentUserMock.mockReturnValue(signedIn);
    const r = mount();
    markIntentionalSignOut();
    useCurrentUserMock.mockReturnValue(signedOut);
    r.rerender(<MemoryRouter initialEntries={["/profile?tab=settings"]}>{tree()}</MemoryRouter>);
    expect(screen.getByTestId("login").textContent).toBe("/login?redirect=%2Fprofile%3Ftab%3Dsettings");
  });

  it("signedOutOnPurposeRecently: within 15 s of a mark, never for a mark dated in the future", () => {
    const t0 = 1_700_000_000_000;
    vi.useFakeTimers({ now: t0 });
    expect(signedOutOnPurposeRecently(t0)).toBe(false);
    markIntentionalSignOut();
    expect(signedOutOnPurposeRecently(t0 + 1_000)).toBe(true);
    expect(signedOutOnPurposeRecently(t0 + 15_000)).toBe(false);
    expect(signedOutOnPurposeRecently(t0 - 1)).toBe(false);
  });
});

describe("F252: pages only a member reaches say log in, not create an account", () => {
  const base = { oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false, bouncedFromGatedRoute: true };
  it("payment-success and complete-profile", () => {
    expect(gatedPageNotice("/payment-success?session_id=cs_x")).toBe("Log in to see your payment. We'll take you straight back to it.");
    expect(gatedPageNotice("/complete-profile")).toBe("Log in to finish your profile. We'll take you straight back to it.");
    const pay = loginNotice({ ...base, redirect: "/payment-success?session_id=cs_x" });
    expect(pay.notice).toMatch(/^Log in to see your payment\./);
    expect(pay.leadWithSignup).toBe(false);
    // Other gated pages still lead with Create an account (F080).
    const profile = loginNotice({ ...base, redirect: "/profile" });
    expect(profile.leadWithSignup).toBe(true);
    expect(gatedPageNotice("/payment-successish")).toBeNull();
  });
});

describe("F456: the Two-step verification card says what it adds", () => {
  it("one line under the title", () => {
    const src = blankComments(readFileSync("src/components/profile/TwoFactorCard.tsx", "utf8"));
    expect(src).toContain("Extra safety: a 6-digit app code when you");
    expect(src).not.toContain("Authenticator code at");
  });
});
