// Q180 — the verify-email screen must HOLD an unconfirmed account.
//
// ProtectedRoute now sends an unconfirmed account to /account-pending from
// every protected route (see emailGateEveryProtectedRoute.test.tsx). But
// `complete-signup` sets `approval_status = 'approved'` at signup, and
// AccountPending's redirect effect sent any `approved` account on to
// /dashboard — which bounces it straight back: a redirect loop, and the
// Resend card never stays up. This pins that an unconfirmed account stays on
// the "Check your email" card, and that a confirmed one is let into the app.
//
// jsdom with useCurrentUser + the supabase client mocked: proves the screen's
// own routing decision, nothing about the auth server.
//
// PROVEN RED 2026-09-23: against the pre-fix AccountPending (git HEAD
// ff4ace98c) the unconfirmed case rendered DASHBOARD, not the card.
// @mutate src/pages/AccountPending.tsx | if (!user.email_confirmed_at) return; | if (false) return;

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useCurrentUserMock = vi.fn();
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => useCurrentUserMock(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resend: vi.fn(async () => ({ error: null })),
      refreshSession: vi.fn(async () => ({ data: {}, error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));
vi.mock("@/lib/authSignOut", () => ({ signOutWithPushCleanup: vi.fn() }));

import AccountPending from "@/pages/AccountPending";

const profile = {
  full_name: "Ada Boudreaux",
  approval_status: "approved",
};

const renderAt = (emailConfirmedAt: string | null) => {
  useCurrentUserMock.mockReturnValue({
    user: { id: "u1", email: "new@example.test", email_confirmed_at: emailConfirmedAt },
    profile,
    isLoading: false,
    isError: false,
    refresh: vi.fn(),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/account-pending"]}>
        <Routes>
          <Route path="/account-pending" element={<AccountPending />} />
          <Route path="/dashboard" element={<div>DASHBOARD</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  useCurrentUserMock.mockReset();
  cleanup();
});

describe("Q180: /account-pending holds an unconfirmed account", () => {
  it("an unconfirmed, approved account stays on the Check your email card", () => {
    renderAt(null);
    expect(screen.getByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Resend Email/ })).toBeTruthy();
    expect(screen.queryByText("DASHBOARD")).toBeNull();
  });

  it("a confirmed, approved account is let into the app", () => {
    renderAt("2026-09-23T00:00:00Z");
    expect(screen.getByText("DASHBOARD")).toBeTruthy();
  });
});
