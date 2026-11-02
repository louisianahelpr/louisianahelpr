/**
 * Audit 1102c P2 (Auditor 3, 11-02): when a view in the Declutter stage preview crashed, the route's error boundary
 * unmounted the preview backend, which put the window's own fetch back: the app's chrome then read PROD
 * (declutter_my_cart, notifications, shop_orders ...) and the error page's "Go Home" navigated for real.
 *
 * Now a crash is caught INSIDE the backend. This test makes the buyer view throw, then proves:
 *  - the preview's own fallback shows (no link, no Go Home), and the route-level boundary never sees the error;
 *  - every Supabase request made afterwards (a read the chrome would make, and a write) is answered by the preview,
 *    so the real fetch is called ZERO times;
 *  - the fetch layer is put back only when the route unmounts.
 *
 * @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx |           <PreviewErrorBoundary resetKey={`${stage}:${side}`}>\n            <Views key={`${stage}:${side}`} sample={sample} />\n          </PreviewErrorBoundary> |           <Views key={`${stage}:${side}`} sample={sample} />
 * @mutate src/pages/admin/preview/DeclutterPreviewPage.tsx |     if (!this.state.error) return this.props.children; |     if (!this.state.error) return this.props.children;\n    throw this.state.error;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ReactNode } from "react";

const ADMIN = "00000000-0000-4000-a000-000000000001";
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: ADMIN }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: ADMIN }, isReady: true }) }));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/declutter/DeclutterMineViews", () => ({
  BuyingDash: () => { throw new TypeError("Cannot read properties of undefined (reading 'title')"); },
  SellingDash: () => null,
}));

const SUPABASE = "https://unit-test.invalid";
const realFetch = globalThis.fetch;
let spy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  spy = vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
  globalThis.fetch = spy as unknown as typeof fetch;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

import DeclutterPreviewPage from "./DeclutterPreviewPage";

/** Stands in for the route's RouteErrorBoundary: it must never catch the preview's crash. */
class RouteBoundary extends Component<{ onCatch: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onCatch(); }
  render() { return this.state.failed ? <p>Route error page with Go Home</p> : this.props.children; }
}

const supabaseCalls = () => spy.mock.calls.filter(([u]) => String(u instanceof Request ? u.url : u).startsWith(SUPABASE));

describe("audit 1102c P2: a crashed preview view still sends nothing", () => {
  it("catches the crash inside the preview and keeps answering every Supabase request until the route unmounts", async () => {
    const routeCaught = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/admin/preview/declutter?stage=paid&side=buyer"]}>
          <Routes>
            <Route path="/admin/preview/declutter" element={<RouteBoundary onCatch={routeCaught}><DeclutterPreviewPage /></RouteBoundary>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("This stage hit a problem in the preview.")).toBeInTheDocument();
    expect(routeCaught).not.toHaveBeenCalled();
    expect(screen.queryByText(/Go Home/)).toBeNull();
    expect(document.querySelector("[data-preview-crashed] a")).toBeNull();
    // The controls are still there to pick another stage.
    expect(screen.getByRole("region", { name: "Declutter preview controls" })).toBeInTheDocument();

    // What the app's chrome does after a crash: reads (and a stray write). None may reach the network.
    const after = [
      fetch(`${SUPABASE}/rest/v1/rpc/declutter_my_cart`, { method: "POST", body: "{}" }),
      fetch(`${SUPABASE}/rest/v1/notifications?select=*&user_id=eq.someone`),
      fetch(`${SUPABASE}/rest/v1/shop_orders?select=*`),
      fetch(`${SUPABASE}/rest/v1/rpc/declutter_watch_item`, { method: "POST", body: "{}" }),
    ];
    for (const res of await Promise.all(after)) expect(res.status).toBeLessThan(500);
    expect(supabaseCalls()).toHaveLength(0);
    expect(after.length).toBe(4);

    // Only when the route goes does the window get its own fetch back.
    expect(globalThis.fetch).not.toBe(spy);
    r.unmount();
    expect(globalThis.fetch).toBe(spy);
  });
});
