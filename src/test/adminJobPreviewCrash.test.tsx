/**
 * B177 (lead 11-02, the Declutter preview's pattern from audit 1102c P2): when the previewed job page crashes, the crash
 * is caught INSIDE the preview backend. Before, the route's error boundary unmounted the backend, which put the
 * window's own fetch back, so the app read PROD and the error page's "Go Home" navigated for real.
 *
 * This makes the job page throw, then proves the preview's own fallback shows (no link), the route boundary never sees
 * the error, every Supabase request made afterwards (a read and a write) reaches the real fetch ZERO times, and the
 * window gets its fetch back only when the route unmounts.
 *
 * @mutate src/pages/admin/preview/previewParts.tsx |   static getDerivedStateFromError(error: Error) { return { error }; } |   static getDerivedStateFromError(error: Error): { error: Error } { throw error; }
 * @mutate src/pages/admin/preview/previewParts.tsx |     if (!this.state.error) return this.props.children; |     if (!this.state.error) return this.props.children;\n    throw this.state.error;
 * @mutate src/pages/admin/preview/previewBackend.ts | if (!base \|\| !url.startsWith(base)) return o.realFetch(input, init); | if (base) return o.realFetch(input, init);
 * @mutate src/pages/admin/preview/previewBackend.ts |      o.onUnlisted?.(`rpc ${name}`); |      void name;
 * @mutate src/pages/admin/preview/previewBackend.ts |      if (listed === undefined) o.onUnlisted?.(`table ${table}`); |      void listed;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ReactNode } from "react";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, profile: {}, isLoading: false, isAdmin: true }) }));
vi.mock("@/pages/jobs/jobPage/JobPage", () => ({
  default: () => { throw new TypeError("Cannot read properties of undefined (reading 'status')"); },
}));

const SUPABASE = String(import.meta.env.VITE_SUPABASE_URL);
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

import JobPreviewPage from "@/pages/admin/preview/JobPreviewPage";
import { installPreviewFetch } from "@/pages/admin/preview/previewBackend";
import { previewSample } from "@/pages/admin/preview/jobPreviewSamples";

/** Stands in for the route's RouteErrorBoundary: it must never catch the preview's crash. */
class RouteBoundary extends Component<{ onCatch: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onCatch(); }
  render() { return this.state.failed ? <p>Route error page with Go Home</p> : this.props.children; }
}

const supabaseCalls = () => spy.mock.calls.filter(([u]) => String(u instanceof Request ? u.url : u).startsWith(SUPABASE));

describe("admin job preview: a crashed page still sends nothing", () => {
  it("catches the crash inside the preview and keeps answering every Supabase request until the route unmounts", async () => {
    const routeCaught = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/admin/preview/job?stage=working&viewer=poster"]}>
          <Routes>
            <Route path="/admin/preview/job" element={<RouteBoundary onCatch={routeCaught}><JobPreviewPage /></RouteBoundary>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("This stage hit a problem in the preview.")).toBeInTheDocument();
    expect(routeCaught).not.toHaveBeenCalled();
    expect(screen.queryByText(/Go Home/)).toBeNull();
    expect(document.querySelector("[data-preview-crashed] a")).toBeNull();
    // The controls are still there to pick another stage.
    expect(screen.getByRole("region", { name: "Job page preview controls" })).toBeInTheDocument();

    // What the app's chrome does after a crash: reads (and a stray write). None may reach the network.
    const after = [
      fetch(`${SUPABASE}/rest/v1/notifications?select=*&user_id=eq.someone`),
      fetch(`${SUPABASE}/rest/v1/jobs?select=*&id=eq.00000000-0000-4000-b000-000000000001`),
      fetch(`${SUPABASE}/rest/v1/rpc/get_my_activity_cores`, { method: "POST", body: "{}" }),
      fetch(`${SUPABASE}/rest/v1/rpc/release_payment`, { method: "POST", body: "{}" }),
      fetch(`${SUPABASE}/functions/v1/create-payment`, { method: "POST", body: "{}" }),
    ];
    for (const res of await Promise.all(after)) expect(res.status).toBeLessThan(500);
    expect(after.length).toBe(5);
    expect(supabaseCalls()).toHaveLength(0);

    // Only when the route goes does the window get its own fetch back.
    expect(globalThis.fetch).not.toBe(spy);
    r.unmount();
    expect(globalThis.fetch).toBe(spy);
  });
});

describe("admin job preview backend: a read the sample does not answer", () => {
  it("is answered null (an RPC) or [] (a table), reported, and never sent", async () => {
    const unlisted: string[] = [];
    const { uninstall } = installPreviewFetch({
      supabaseUrl: SUPABASE, sample: () => previewSample("working", "poster"), ownUserId: () => null,
      onBlocked: () => {}, onUnlisted: (w) => unlisted.push(w),
    });
    try {
      const rpc = await fetch(`${SUPABASE}/rest/v1/rpc/get_something_new`, { method: "POST", body: "{}" });
      expect(await rpc.json()).toBeNull();
      const table = await fetch(`${SUPABASE}/rest/v1/some_new_table?select=*`);
      expect(await table.json()).toEqual([]);
      // A listed read answers from the sample and is not reported.
      const job = await fetch(`${SUPABASE}/rest/v1/jobs?select=*&id=eq.x`);
      expect(((await job.json()) as unknown[]).length).toBe(1);
    } finally {
      uninstall();
    }
    expect(unlisted).toEqual(["rpc get_something_new", "table some_new_table"]);
    expect(supabaseCalls()).toHaveLength(0);
  });
});
