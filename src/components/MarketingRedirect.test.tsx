// MarketingRedirect is the gate in front of the two promotional routes. Its
// job is as much about what it does NOT do as what it does:
//
//   • a guest must get the landing page synchronously, with no Supabase chunk
//     fetched and no redirect mounted (the LCP contract);
//   • native must be a complete no-op — the app already has its own signed-in
//     redirect in Index.tsx and must behave exactly as it does today;
//   • a persisted token must hold a calm surface, then defer to the real auth
//     check, which is free to disagree (stale/revoked token → landing page).
//
// `isNativePlatform` is a module-level constant read at import time, so each
// platform case re-imports the module under its own mock via vi.resetModules.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const useCurrentUserMock = vi.fn();
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => useCurrentUserMock(),
}));

const LANDING = "Louisiana's Local Job Partner.";
const AUTH_KEY = "sb-fncmgoasalhdgfwzhsqa-auth-token";

/** Load MarketingRedirect fresh with `isNativePlatform` pinned. */
const loadWith = async (native: boolean) => {
  vi.resetModules();
  vi.doMock("@/lib/nativeInit", () => ({ isNativePlatform: native }));
  const mod = await import("./MarketingRedirect");
  return mod.default;
};

const renderGate = (Gate: React.ComponentType<{ children: React.ReactNode; to?: string }>) =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Gate><h1>{LANDING}</h1></Gate>} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  useCurrentUserMock.mockReset();
  useCurrentUserMock.mockReturnValue({ user: null, isLoading: false });
});

afterEach(() => {
  localStorage.clear();
  vi.doUnmock("@/lib/nativeInit");
});

describe("MarketingRedirect", () => {
  it("renders the landing page synchronously for a guest — no auth check at all", async () => {
    const Gate = await loadWith(false);
    renderGate(Gate);
    // Synchronously present: no Suspense boundary was entered, which is the
    // whole point — the Supabase-backed check is never even mounted.
    expect(screen.getByText(LANDING)).toBeInTheDocument();
    expect(useCurrentUserMock).not.toHaveBeenCalled();
  });

  it("is a complete no-op on native, even with a token present", async () => {
    // Native already redirects signed-in users via NativeRedirect in Index.tsx.
    // This gate must not double up on it or change anything a native user sees.
    localStorage.setItem(AUTH_KEY, "{}");
    const Gate = await loadWith(true);
    renderGate(Gate);
    expect(screen.getByText(LANDING)).toBeInTheDocument();
    expect(useCurrentUserMock).not.toHaveBeenCalled();
  });

  it("redirects a signed-in web visitor once the lazy auth check resolves", async () => {
    localStorage.setItem(AUTH_KEY, "{}");
    useCurrentUserMock.mockReturnValue({ user: { id: "u1" }, isLoading: false });
    const Gate = await loadWith(false);
    renderGate(Gate);
    expect(await screen.findByText("DASHBOARD")).toBeInTheDocument();
    expect(screen.queryByText(LANDING)).not.toBeInTheDocument();
  });

  it("never flashes the marketing page on the way to the redirect", async () => {
    localStorage.setItem(AUTH_KEY, "{}");
    useCurrentUserMock.mockReturnValue({ user: { id: "u1" }, isLoading: false });
    const Gate = await loadWith(false);
    renderGate(Gate);
    // Before the lazy chunk resolves the visitor is on the calm placeholder,
    // NOT on the landing page.
    expect(screen.queryByText(LANDING)).not.toBeInTheDocument();
    expect(await screen.findByText("DASHBOARD")).toBeInTheDocument();
  });

  it("falls back to the landing page when the persisted token turns out to be stale", async () => {
    // The probe is a hint, never an authorization decision: a revoked or
    // expired token resolves to `user: null` and the guest sees the page.
    localStorage.setItem(AUTH_KEY, "{}");
    useCurrentUserMock.mockReturnValue({ user: null, isLoading: false });
    const Gate = await loadWith(false);
    renderGate(Gate);
    expect(await screen.findByText(LANDING)).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD")).not.toBeInTheDocument();
  });

  it("holds the calm placeholder while the token-bearing visitor's auth resolves", async () => {
    localStorage.setItem(AUTH_KEY, "{}");
    useCurrentUserMock.mockReturnValue({ user: null, isLoading: true });
    const Gate = await loadWith(false);
    const { container } = renderGate(Gate);
    await waitFor(() => expect(useCurrentUserMock).toHaveBeenCalled());
    expect(container.querySelector(".min-h-screen.bg-premium-page")).not.toBeNull();
    expect(screen.queryByText(LANDING)).not.toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD")).not.toBeInTheDocument();
  });
});
