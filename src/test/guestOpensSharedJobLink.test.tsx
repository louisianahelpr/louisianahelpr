/**
 * A shared job link shows the job to a guest (10-30 jobs audit, items 1 and 2).
 * The owner shares jobs on Facebook; since 2026-09-02 the person tapping met a
 * login wall with no job, price or town, and the wall's "Create an account" link
 * was a bare /signup whenever the link carried ?ref=share.
 *
 * Holds: the guest sees the job from the masked public view with nothing private
 * asked for; every way on goes to sign-up carrying the job; a signed-in visitor
 * still meets ProtectedRoute's gates, because allowGuest widens it for guests only.
 *
 * @mutate src/App.tsx | <ProtectedRoute allowGuest><PageTransition><JobDetail /> | <ProtectedRoute><PageTransition><JobDetail />
 * @mutate src/components/ProtectedRoute.tsx |   if (!user && allowGuest) return <>{children}</>;\n | \n
 * @mutate src/components/ProtectedRoute.tsx |   if (!user && allowGuest) return <>{children}</>; |   if (allowGuest) return <>{children}</>;
 * @mutate src/pages/jobs/JobDetail.tsx | category, budget, location, urgent_fee, | category, budget, location, customer_id, urgent_fee,
 * @mutate src/pages/jobs/JobDetail.tsx | "id, title, category, budget, location, urgent_fee, | "id, title, description, category, budget, location, urgent_fee,
 * @mutate src/pages/jobs/JobDetail.tsx | navigate(signupUrlFor(id ? `/jobs/${id}` : null)) | navigate("/signup")
 * @mutate src/pages/jobs/JobDetail.tsx | onClose={() => navigate("/browse")} | onClose={() => navigate("/home")}
 * @mutate src/pages/auth/Login.tsx | const signupHref = signupUrlFor(pendingRedirect); | const signupHref = pendingRedirect?.match(/^\/jobs\/([^/?#]+)$/) ? signupUrlFor(pendingRedirect) : "/signup";
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { postAuthDestination, rememberSignupRedirect, signupUrlFor } from "@/lib/jobIntent";
import { guestTakeHome } from "@/components/dashboard/GuestJobPreview";

const JOB_ID = "3f0c9a4e-0000-4000-8000-000000000000";
const state = vi.hoisted(() => ({
  auth: { user: null as null | Record<string, unknown>, profile: null as null | Record<string, unknown>, isLoading: false },
  columns: [] as string[],
  row: null as null | Record<string, unknown>,
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
// The real guest preview (GuestJobPreview, JOBS-29): title, category, parish, budget, "Sign Up to Apply".
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => {
        state.columns = columns.split(",").map((c) => c.trim());
        return { eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }) };
      },
    }),
  },
}));

import ProtectedRoute from "@/components/ProtectedRoute";
import JobDetail from "@/pages/jobs/JobDetail";

const Where = () => {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
};

function openLink(path = `/jobs/${JOB_ID}?ref=share`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/jobs/:id" element={<ProtectedRoute allowGuest><JobDetail /></ProtectedRoute>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  state.auth = { user: null, profile: null, isLoading: false };
  state.columns = [];
  state.row = { id: JOB_ID, title: "Move a sofa", category: "moving", budget: 120, location: "Lafayette, LA", description: "Gate code 1234, 12 Oak St", expires_at: null, boost_expires_at: null };
});

describe("the route", () => {
  it("/jobs/:id is the only route that lets a guest through", () => {
    const app = blankComments(readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8"));
    const routes = [...app.matchAll(/<Route path="([^"]+)" element=\{(.*)\} \/>/g)];
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.filter((m) => m[2].includes("allowGuest")).map((m) => m[1])).toEqual(["/jobs/:id"]);
  });
});

describe("a guest opening a shared link", () => {
  it("sees the job, not the login wall, with ?ref=share on the link", async () => {
    openLink();
    expect(await screen.findByText("Sign Up to Apply")).toBeTruthy();
    expect(screen.getAllByText("Move a sofa").length).toBeGreaterThan(0);
    expect(screen.getByText("Lafayette Parish")).toBeTruthy();
    // The take-home the guest Browse card shows for the same row (lead 10-31), never the $120 budget.
    const net = guestTakeHome({ id: JOB_ID, title: "Move a sofa", category: "moving", budget: 120, location: "Lafayette, LA" });
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(120);
    expect(screen.getByText(`$${Math.floor(net!)}`)).toBeTruthy();
    expect(screen.getByText("You'd take home")).toBeTruthy();
    expect(screen.queryByText("$120")).toBeNull();
    expect(screen.queryByText(/Oak St/)).toBeNull();
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("asks the public view for nothing private", async () => {
    openLink();
    await screen.findByText("Sign Up to Apply");
    // JOBS-29 (lead 2026-10-31): exactly the preview's facts (the take-home's inputs among them) plus id, status
    // and expiry.
    expect(state.columns).toEqual([
      "id", "title", "category", "budget", "location",
      "urgent_fee", "is_group_job", "helpers_needed", "helper_fee_flat_cents", "helper_fee_percent",
      "status", "expires_at",
    ]);
    for (const column of ["customer_id", "latitude", "longitude", "description", "photos", "offered_to_helper_id", "direct_offer_status", "applicant_count", "special_requirements"]) {
      expect(state.columns, column).not.toContain(column);
    }
  });

  it("goes to sign-up carrying the job, and the job survives it", async () => {
    openLink();
    fireEvent.click(await screen.findByText("Sign Up to Apply"));
    const where = screen.getByTestId("where").textContent!;
    expect(where).toBe(`/signup?redirect=${encodeURIComponent(`/jobs/${JOB_ID}`)}`);
    rememberSignupRedirect(new URLSearchParams(where.split("?")[1]).get("redirect"));
    expect(postAuthDestination()).toBe(`/jobs/${JOB_ID}`);
  });

  it("closing goes to the public Browse list, never a page that bounces them to log in", async () => {
    openLink();
    await screen.findByText("Sign Up to Apply");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("where").textContent).toBe("/browse");
  });

  it("a job that is not public says so and offers Browse", async () => {
    state.row = null;
    openLink();
    expect(await screen.findByText("This job isn't available.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /browse open jobs/i }));
    expect(screen.getByTestId("where").textContent).toBe("/browse");
  });
});

describe("a signed-in visitor still meets the gates", () => {
  it("a complete member gets the job page and no guest read", async () => {
    state.auth = { user: { id: "u1", email_confirmed_at: "2026-01-01", app_metadata: { provider: "email" } }, profile: { is_legacy_user: true, full_name: "A", location: "B" }, isLoading: false };
    openLink();
    expect(await screen.findByText("MEMBER JOB PAGE")).toBeTruthy();
    expect(state.columns).toEqual([]);
  });

  it("an unconfirmed account is still sent to Check your email", () => {
    state.auth = { user: { id: "u1", email_confirmed_at: null, app_metadata: { provider: "email" } }, profile: { is_legacy_user: true, full_name: "A", location: "B" }, isLoading: false };
    openLink();
    expect(screen.getByTestId("where").textContent).toMatch(/^\/signup-pending/);
    expect(screen.queryByText("MEMBER JOB PAGE")).toBeNull();
  });

  it("a half-finished account is still sent to Complete Profile", () => {
    state.auth = { user: { id: "u1", email_confirmed_at: "2026-01-01", app_metadata: { provider: "email" } }, profile: { is_legacy_user: false }, isLoading: false };
    openLink();
    expect(screen.getByTestId("where").textContent).toMatch(/^\/complete-profile/);
  });

  it("a route without allowGuest still bounces a guest to log in", () => {
    render(
      <MemoryRouter initialEntries={["/posts"]}>
        <Routes>
          <Route path="/posts" element={<ProtectedRoute><div>PROTECTED</div></ProtectedRoute>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("where").textContent).toBe("/login?redirect=%2Fposts");
  });
});

describe("the Log in screen's sign-up link (item 2)", () => {
  it("is built from the redirect in the one link form, query string kept", () => {
    const login = blankComments(readFileSync(resolve(process.cwd(), "src/pages/auth/Login.tsx"), "utf8"));
    expect(login).toContain("const signupHref = signupUrlFor(pendingRedirect);");
    expect(signupUrlFor(`/jobs/${JOB_ID}?ref=share`)).toBe(`/signup?redirect=${encodeURIComponent(`/jobs/${JOB_ID}?ref=share`)}`);
  });
});
