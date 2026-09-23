// Q180 — OWNER RULE (2026-09-23): nobody enters the app until their email is
// verified. "In order to actually finish sign up they must verify their email.
// So once they sign up the verify email goes to email then they verify and come
// back to the page to actually enter. They can't enter until they verify email."
//
// The bug this pins: ProtectedRoute's email gate read
// `!allowPending && !user.email_confirmed_at`, so every `allowPending` route
// (/dashboard, /my-jobs, /my-posts, /messages) let an unconfirmed account in to
// "browse while they wait". The route list is DERIVED from the route table in
// src/App.tsx, not typed here, so a route added tomorrow with `allowPending` (or
// `allowUnapproved`) is covered the day it lands.
//
// SOURCE-TEXT + jsdom: `useCurrentUser` is mocked, so this proves the CLIENT
// gate. The server half is Supabase Auth's "confirm email" setting
// (`mailer_autoconfirm: false` on /auth/v1/settings, measured 2026-09-23),
// which refuses a password session to an unconfirmed address.
//
// PROVEN RED 2026-09-23: against the pre-fix ProtectedRoute (git HEAD
// ff4ace98c) 14 of 20 cases failed — every allowPending route (/dashboard,
// /my-jobs, /my-posts, /messages) and both allowUnapproved routes (/profile,
// /complete-profile) rendered PROTECTED for an unconfirmed account. The first
// registered mutation below (skipping the email gate outright — the
// allowPending bypass it used to restore no longer exists, Q193) re-opens it.
// @mutate src/components/ProtectedRoute.tsx | if (!user.email_confirmed_at) { | if (false) {
//
// Q193 (owner 2026-09-23): the verify-email destination is /signup-pending,
// the 3-step "Check Your Email" page — the old /account-pending card was
// deleted ("no duplicate pages with the same info"). And there is no approval
// gate: a confirmed, complete account whose approval_status still says
// `pending` or `denied` is let into EVERY protected route.
// PROVEN RED 2026-09-23 against HEAD 40fd919ff's ProtectedRoute: 41 of 42
// failed — all 11 protected routes (and the 4 allowPending ones, twice) sent
// the unverified account to /account-pending instead of /signup-pending, and
// all 11 bounced a complete, confirmed account whose approval_status was
// `pending` or `denied` (22 cases).
// @mutate src/components/ProtectedRoute.tsx | return <Navigate to="/signup-pending" replace />; | return <Navigate to="/account-pending" replace />;
// @mutate src/components/ProtectedRoute.tsx | if (isLockedOut(profile.ban_status, profile.auto_suspended_until)) { | if ((profile as { approval_status?: string }).approval_status === "denied") return <Navigate to="/account-denied" replace />; if (isLockedOut(profile.ban_status, profile.auto_suspended_until)) {

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";

const useCurrentUserMock = vi.fn();
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => useCurrentUserMock(),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  AhaEvent: { ForcedLogoutBounce: "forced_logout_bounce" },
}));

import ProtectedRoute from "@/components/ProtectedRoute";

type RouteRow = { path: string; allowPending: boolean; allowUnapproved: boolean };

// Every `<Route path="…" element={… <ProtectedRoute …>…</ProtectedRoute> …}>`
// in the route table, with the gate props it is mounted with.
const appSrc = blankComments(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));
const protectedRoutes: RouteRow[] = appSrc
  .split("\n")
  .filter((line) => /<Route\s+path="/.test(line) && line.includes("<ProtectedRoute"))
  .map((line) => {
    const path = line.match(/<Route\s+path="([^"]+)"/)![1];
    const open = line.indexOf("<ProtectedRoute");
    const close = line.indexOf("</ProtectedRoute>", open);
    const seg = line.slice(open, close === -1 ? undefined : close);
    return {
      path,
      allowPending: /\ballowPending\b/.test(seg),
      allowUnapproved: /\ballowUnapproved\b/.test(seg),
    };
  });
const allowPendingRoutes = protectedRoutes.filter((r) => r.allowPending);

const completeApproved = {
  full_name: "Ada Boudreaux",
  avatar_url: "https://example.test/a.png",
  date_of_birth: "1990-01-01",
  phone: "(504) 555-0100",
  location: "New Orleans",
  approval_status: "approved",
  is_legacy_user: false,
};

const concrete = (path: string) => path.replace(/:[^/]+/g, "x");

const renderRoute = (row: RouteRow, profile: Record<string, unknown> | null) => {
  useCurrentUserMock.mockReturnValue({
    user: { id: "u1", email: "new@example.test", email_confirmed_at: null },
    profile,
    isLoading: false,
    isError: false,
    refresh: vi.fn(),
  });
  render(
    <MemoryRouter initialEntries={[concrete(row.path)]}>
      <Routes>
        <Route
          path={row.path}
          element={
            <ProtectedRoute allowPending={row.allowPending} allowUnapproved={row.allowUnapproved}>
              <div>PROTECTED</div>
            </ProtectedRoute>
          }
        />
        <Route path="/signup-pending" element={<div>VERIFY_EMAIL</div>} />
        <Route path="/complete-profile" element={<div>COMPLETE_PROFILE</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  useCurrentUserMock.mockReset();
  cleanup();
});

describe("Q180: the email gate covers EVERY protected route", () => {
  it("the route table was actually read (inventory floor)", () => {
    // Every <ProtectedRoute in App.tsx must sit on a one-line <Route path=…>,
    // or the parser above would skip it silently.
    const uses = (appSrc.match(/<ProtectedRoute\b/g) ?? []).length;
    expect(uses).toBe(protectedRoutes.length);
    expect(protectedRoutes.length).toBeGreaterThan(8);
    expect(allowPendingRoutes.length).toBeGreaterThan(3);
    expect(allowPendingRoutes.map((r) => r.path)).toContain("/dashboard");
  });

  it.each(allowPendingRoutes.map((r) => [r.path, r] as const))(
    "allowPending route %s sends an unverified account to verify-email",
    (_path, row) => {
      renderRoute(row, completeApproved);
      expect(screen.getByText("VERIFY_EMAIL")).toBeTruthy();
      expect(screen.queryByText("PROTECTED")).toBeNull();
    },
  );

  it.each(protectedRoutes.map((r) => [r.path, r] as const))(
    "protected route %s sends an unverified account to verify-email",
    (_path, row) => {
      renderRoute(row, completeApproved);
      expect(screen.getByText("VERIFY_EMAIL")).toBeTruthy();
    },
  );

  it.each(
    protectedRoutes.flatMap((r) => [
      [r.path, "pending", r] as const,
      [r.path, "denied", r] as const,
    ]),
  )("protected route %s admits a confirmed, complete %s account (no approval gate, Q193)", (_path, status, row) => {
    useCurrentUserMock.mockReturnValue({
      user: { id: "u1", email: "ok@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" },
      profile: { ...completeApproved, approval_status: status },
      isLoading: false,
      isError: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter initialEntries={[concrete(row.path)]}>
        <Routes>
          <Route path={row.path} element={<ProtectedRoute><div>PROTECTED</div></ProtectedRoute>} />
          <Route path="*" element={<div>BOUNCED</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("PROTECTED")).toBeTruthy();
  });

  it.each(allowPendingRoutes.map((r) => [r.path, r] as const))(
    "allowPending route %s does not render optimistically while the profile loads",
    (_path, row) => {
      renderRoute(row, null);
      expect(screen.getByText("VERIFY_EMAIL")).toBeTruthy();
      expect(screen.queryByText("PROTECTED")).toBeNull();
    },
  );
});
