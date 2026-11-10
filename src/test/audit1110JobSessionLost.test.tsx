/**
 * F260o (audit 11-10): a member whose session ended while on /jobs/<id> (Apply gave 401s) saw "This job isn't
 * available. It may have been filled, expired, or removed." The job was fine; the page had fallen through to the guest
 * branch and the public view did not list it. Now the page remembers it had a user and, when that user goes away
 * without the app's own Sign out, says "You've been signed out." with Log in back to this job.
 *
 * @mutate src/pages/jobs/JobDetail.tsx | if (user) hadUser.current = true; | if (user) hadUser.current = false;
 * @mutate src/pages/jobs/JobDetail.tsx | hadUser.current && !signedOutOnPurposeRecently(); | hadUser.current;
 * @mutate src/pages/jobs/JobDetail.tsx | &signed_out=session-lost`}>Log in | `}>Log in
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { markIntentionalSignOut } from "@/lib/unexpectedSignOut";

const JOB_ID = "3f0c9a4e-0000-4000-8000-000000000000";
const state = vi.hoisted(() => ({
  auth: { user: null as null | Record<string, unknown>, profile: null as null | Record<string, unknown>, isLoading: false },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ ...state.auth, isError: false, refresh: vi.fn(), profileQuery: { fetchStatus: "idle", status: "success" } }),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("@/hooks/usePendingSaveConsumer", () => ({ usePendingSaveConsumer: vi.fn() }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/components/marketing/PublicLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/pages/jobs/jobPage/JobPage", () => ({ default: () => <div>MEMBER JOB PAGE</div> }));
// The public view does not list this job (the member's own, or one they applied to): the guest read answers nothing.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) },
}));
import JobDetail from "@/pages/jobs/JobDetail";

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A fresh element each time: the same element object would let React skip the re-render.
  const ui = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/jobs/${JOB_ID}`]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const r = render(ui());
  return { ...r, again: () => r.rerender(ui()) };
}

describe("F260o: the job page after the session ends", () => {
  beforeEach(() => {
    vi.useRealTimers();
    state.auth = { user: { id: "u1" }, profile: { id: "u1" }, isLoading: false };
  });

  it("says the member was signed out and offers Log in back to this job, not 'This job isn't available'", async () => {
    const { again } = open();
    expect(await screen.findByText("MEMBER JOB PAGE")).toBeTruthy();
    state.auth = { user: null, profile: null, isLoading: false };
    again();
    expect(await screen.findByText("You've been signed out.")).toBeTruthy();
    expect(screen.queryByText("This job isn't available.")).toBeNull();
    const login = screen.getByRole("link", { name: "Log in" });
    expect(login.getAttribute("href")).toBe(`/login?redirect=${encodeURIComponent(`/jobs/${JOB_ID}`)}&signed_out=session-lost`);
  });

  it("after the app's own Sign out it is the ordinary guest page", async () => {
    const { again } = open();
    expect(await screen.findByText("MEMBER JOB PAGE")).toBeTruthy();
    markIntentionalSignOut();
    state.auth = { user: null, profile: null, isLoading: false };
    again();
    expect(await screen.findByText("This job isn't available.")).toBeTruthy();
    expect(screen.queryByText("You've been signed out.")).toBeNull();
  });

  it("a visitor who never had a session sees the guest page", async () => {
    state.auth = { user: null, profile: null, isLoading: false };
    open();
    expect(await screen.findByText("This job isn't available.")).toBeTruthy();
    expect(screen.queryByText("You've been signed out.")).toBeNull();
  });
});
