/**
 * A shared job link shows the job to a guest (10-30 jobs audit, items 1 and 2).
 * The owner shares jobs on Facebook; since 2026-09-02 the person tapping met a
 * login wall with no job, price or town, and the wall's "Create an account" link
 * was a bare /signup whenever the link carried ?ref=share.
 *
 * F268a (owner 11-12): the guest sees the job's own read-only page (GuestJobPage), not the sheet over a blur: the
 * title as the page heading, the facts, and the description as the public view hands it to anon (phone numbers and
 * street addresses masked on the server, mask_guest_contact, proven in guestsReadMaskedJobDescription.pglite.mjs).
 *
 * Holds: the guest sees the job from the masked public view with nothing private
 * asked for; every way on goes to sign-up carrying the job; a signed-in visitor
 * still meets ProtectedRoute's gates, because allowGuest widens it for guests only.
 *
 * @mutate src/App.tsx | <ProtectedRoute allowGuest><PageTransition><JobDetail /> | <ProtectedRoute><PageTransition><JobDetail />
 * @mutate src/components/ProtectedRoute.tsx |   if (!user && allowGuest) return <>{children}</>;\n | \n
 * @mutate src/components/ProtectedRoute.tsx |   if (!user && allowGuest) return <>{children}</>; |   if (allowGuest) return <>{children}</>;
 * @mutate src/pages/jobs/JobDetail.tsx | category, budget, location, urgent_fee, | category, budget, location, customer_id, urgent_fee,
 * @mutate src/pages/jobs/JobDetail.tsx | "id, title, description, category, budget, location, urgent_fee, | "id, title, category, budget, location, urgent_fee,
 * @mutate src/pages/jobs/JobDetail.tsx | navigate(signupUrlFor(id ? `/jobs/${id}` : null)) | navigate("/signup")
 * @mutate src/pages/jobs/JobDetail.tsx | onBrowse={() => navigate("/browse")} | onBrowse={() => navigate("/home")}
 * @mutate src/pages/jobs/JobDetail.tsx |             <GuestJobPage job={job} | <GuestJobPreview onClose={() => navigate("/browse")} job={job}
 * @mutate src/components/dashboard/GuestJobPage.tsx |       {details && ( |       {false && (
 * @mutate src/pages/jobs/JobDetail.tsx | parish: row.parish, description: row.description, | parish: row.parish,
 * @mutate src/pages/jobs/JobDetail.tsx | if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? "")) return null; | if (id === "") return null;
 * @mutate src/pages/jobs/JobDetail.tsx | ) : !job && id && UUID_RE.test(id) ? ( | ) : !job && id && !UUID_RE.test(id) ? (
 * @mutate src/pages/jobs/JobDetail.tsx | navigate(`/login?redirect=${encodeURIComponent(`/jobs/${id}`)}`) | navigate("/login")
 * @mutate src/pages/auth/loginNotice.ts | if (/^\/jobs\/[0-9a-f-]{36}$/i.test(path)) return JOB_LINK_NOTICE; | 
 * @mutate src/pages/auth/loginNotice.ts | notice !== JOB_LINK_NOTICE && notice.endsWith(BACK_TO_IT) | notice.endsWith(BACK_TO_IT)
 * @mutate src/pages/jobs/JobDetail.tsx | onSignUp={requireSignup} onLogIn={(id) => navigate(guestLogInUrl(id))} /> | onSignUp={requireSignup} />
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
import { JOB_LINK_NOTICE, loginNotice } from "@/pages/auth/loginNotice";

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
// The real guest page (GuestJobPage, F268a): title, facts, description, "Sign up to apply".
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

/** What open_jobs_browse hands anon for "Gate code 1234, 12 Oak St, call 337-555-0100" (mask_guest_contact). */
const GUEST_COPY = "Gate code 1234, [address hidden], call [phone hidden]";
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
  state.row = { id: JOB_ID, title: "Move a sofa", category: "moving", budget: 120, location: "Lafayette, LA", description: GUEST_COPY, expires_at: null, boost_expires_at: null };
});

describe("the route", () => {
  // F071 (owner 11-09): guests may VIEW /explore, /search and /helprs too; only their actions are gated.
  it("only /jobs/:id and the three F071 views let a guest through", () => {
    const app = blankComments(readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8"));
    const routes = [...app.matchAll(/<Route path="([^"]+)" element=\{(.*)\} \/>/g)];
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.filter((m) => m[2].includes("allowGuest")).map((m) => m[1])).toEqual(["/explore", "/search", "/helprs", "/jobs/:id"]);
  });
});

describe("a guest opening a shared link", () => {
  it("sees the job, not the login wall, with ?ref=share on the link", async () => {
    openLink();
    expect(await screen.findByText("Sign up to apply")).toBeTruthy();
    expect(screen.getAllByText("Move a sofa").length).toBeGreaterThan(0);
    expect(screen.getByText("Lafayette Parish")).toBeTruthy();
    // The take-home the guest Browse card shows for the same row (lead 10-31), never the $120 budget.
    const net = guestTakeHome({ id: JOB_ID, title: "Move a sofa", category: "moving", budget: 120, location: "Lafayette, LA" });
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(120);
    expect(screen.getByText(`$${Math.floor(net!)}`)).toBeTruthy();
    expect(screen.getByText("You'd earn after fees")).toBeTruthy();
    expect(screen.queryByText("$120")).toBeNull();
    expect(screen.queryByText(/Oak St/)).toBeNull();
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("F268a: a full page, not a sheet: the title is the visible heading and the description shows as the view gives it", async () => {
    openLink();
    await screen.findByText("Sign up to apply");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-guest-job-page]")).toBeTruthy();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Move a sofa");
    expect(h1.className).not.toMatch(/\bsr-only\b/);
    expect(document.querySelectorAll("h1").length).toBe(1);
    expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy();
    expect(document.querySelector("[data-guest-job-description]")?.textContent).toBe(GUEST_COPY);
    // No poster and no Message button on a guest's page.
    expect(screen.queryByText(/Posted by/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Message/ })).toBeNull();
  });

  it("F268a: no description, no Details block (nothing guessed)", async () => {
    state.row = { ...state.row!, description: null };
    openLink();
    await screen.findByText("Sign up to apply");
    expect(screen.queryByRole("heading", { name: "Details" })).toBeNull();
  });

  it("F268a: a state that is not the job (not available) keeps the heading for readers only", async () => {
    state.row = null;
    openLink();
    await screen.findAllByText(/isn't available|Log in/);
    expect(screen.getByRole("heading", { level: 1 }).className).toMatch(/\bsr-only\b/);
  });

  it("asks the public view for nothing private", async () => {
    openLink();
    await screen.findByText("Sign up to apply");
    // JOBS-29 (lead 2026-10-31): the facts (the take-home's inputs among them) plus id, status and expiry; F268a
    // (owner 11-12): plus the description, which the view masks for anon on the server.
    expect(state.columns).toEqual([
      "id", "title", "description", "category", "budget", "location",
      "urgent_fee", "is_group_job", "helpers_needed", "helper_fee_flat_cents", "helper_fee_percent",
      "date_needed", "date_window_end", "start_time", "is_flexible_schedule",
      "status", "expires_at",
      // F269a (owner 11-11): the share line names the parish from the view's own column, as api/share.ts does.
      "parish",
    ]);
    for (const column of ["customer_id", "latitude", "longitude", "photos", "offered_to_helper_id", "direct_offer_status", "applicant_count", "special_requirements"]) {
      expect(state.columns, column).not.toContain(column);
    }
  });

  it("goes to sign-up carrying the job, and the job survives it", async () => {
    openLink();
    fireEvent.click(await screen.findByText("Sign up to apply"));
    const where = screen.getByTestId("where").textContent!;
    expect(where).toBe(`/signup?redirect=${encodeURIComponent(`/jobs/${JOB_ID}`)}`);
    rememberSignupRedirect(new URLSearchParams(where.split("?")[1]).get("redirect"));
    expect(postAuthDestination()).toBe(`/jobs/${JOB_ID}`);
  });

  it("its way out goes to the public Browse list, never a page that bounces them to log in", async () => {
    openLink();
    await screen.findByText("Sign up to apply");
    fireEvent.click(screen.getByRole("button", { name: "See other open jobs" }));
    expect(screen.getByTestId("where").textContent).toBe("/browse");
  });

  // F268a (audit 11-10): a member opening a shared link had to find Log in behind the blur.
  it("a member can log in from the preview and comes back to the job", async () => {
    openLink();
    await screen.findByText("Sign up to apply");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByTestId("where").textContent).toBe(`/login?redirect=${encodeURIComponent(`/jobs/${JOB_ID}`)}`);
  });

  // F286a (audit 11-10, High): an email or push link to a hired, done or cancelled job, opened signed out,
  // said "This job isn't available" (read as "my job was cancelled") with no way to log in.
  it("a job that is not public leads with Log in carrying the job, and still offers Browse", async () => {
    state.row = null;
    openLink();
    expect(await screen.findByText("Log in to see this job.")).toBeTruthy();
    expect(screen.getByText(/only visible to the person who posted it and the person doing it/)).toBeTruthy();
    expect(screen.queryByText("This job isn't available.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByTestId("where").textContent).toBe(`/login?redirect=${encodeURIComponent(`/jobs/${JOB_ID}`)}`);
  });

  it("the Browse way out stays on the not-public state", async () => {
    state.row = null;
    openLink();
    await screen.findByText("Log in to see this job.");
    fireEvent.click(screen.getByRole("button", { name: /browse open jobs/i }));
    expect(screen.getByTestId("where").textContent).toBe("/browse");
  });

  it("an id that is not a job id at all keeps 'isn't available' (nothing to log in for)", async () => {
    state.row = null;
    openLink("/jobs/abc");
    expect(await screen.findByText("This job isn't available.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
  });

  it("the Log in screen that link opens leads with Log in, not Create an account", () => {
    const { notice, leadWithSignup } = loginNotice({ oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false, bouncedFromGatedRoute: true, redirect: `/jobs/${JOB_ID}` });
    expect(notice).toBe(JOB_LINK_NOTICE);
    expect(notice).toMatch(/only visible to the person who posted it and the person doing it/);
    expect(leadWithSignup).toBe(false);
    // The Jobs tabs themselves keep the generic account line.
    expect(loginNotice({ oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false, bouncedFromGatedRoute: true, redirect: "/jobs?tab=posted" }).leadWithSignup).toBe(true);
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

// F254 (audit 11-10): /jobs/abc was a refused read that said "our end is having a hiccup" with a Try again that could
// never work. A malformed id now reads as "This job isn't available." and is never sent to the server.
describe("F254: a malformed job id", () => {
  it("says the job isn't available, with no Try again, and asks the server nothing", async () => {
    state.row = null;
    openLink("/jobs/abc");
    expect(await screen.findByText("This job isn't available.")).toBeTruthy();
    expect(screen.queryByText(/having a hiccup/)).toBeNull();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(state.columns).toEqual([]);
  });
});
