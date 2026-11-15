/**
 * Owner request 11-14 (7 of 37 new members were sent to /complete-profile right after sign-up; 12 never came back).
 * A Google/Apple sign-up now sees ONE short step (the Terms box and the 18+ box, then Continue) and lands on Home.
 * Every other profile detail is asked only on a commitment route (src/lib/profileGateRoutes.ts). A member who has
 * not accepted the Terms and attested 18+ still cannot reach Home.
 *
 * RED on the old code: the name-less Google member on /home was sent to the full form, and the consent step did not
 * exist (the full form with city, ZIP and bio showed).
 *
 * @mutate src/components/ProtectedRoute.tsx | const gateNeeded = !isConsentComplete(profile, user) \|\| (fullProfile && !isProfileComplete(profile, user)); | const gateNeeded = !isProfileComplete(profile, user);
 * @mutate src/App.tsx | <Route path="/messages" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute fullProfile | <Route path="/messages" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute
 * @mutate src/components/ProtectedRoute.tsx | const gateNeeded = !isConsentComplete(profile, user) \|\| | const gateNeeded =
 * @mutate src/pages/auth/CompleteProfile.tsx |   if (profile && user && !consentDone) { |   if (false) {
 * @mutate src/lib/profileGateRoutes.ts | (?:new\|[^/]+\/edit)\|messages)(?:\/\|$) | (?:new\|[^/]+\/edit))(?:\/\|$)
 * @mutate src/pages/auth/CompleteProfile.tsx |     const consentAgeBox = ageBoxShown \|\| (!profile.accepted_terms_at && !profile.age_attested_at && !profile.date_of_birth); |     const consentAgeBox = ageBoxShown;
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const current: { user: Record<string, unknown>; profile: Record<string, unknown> | null } = { user: {}, profile: null };
const updates: Record<string, unknown>[] = [];

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: current.user, profile: current.profile, isLoading: false, isError: false, refresh: async () => {} }),
}));
vi.mock("@/hooks/useSignOutAction", () => ({ useSignOutAction: () => ({ signingOut: false, signOut: () => {} }) }));
vi.mock("@/hooks/useDeleteAccount", () => ({ useDeleteAccount: () => ({ isOpen: false, requestDelete: () => {}, dialogProps: {} }) }));
vi.mock("@/hooks/useParishForZip", () => ({ useParishForZip: () => ({ parish: null, unknownZip: false }), UNKNOWN_ZIP_MESSAGE: "" }));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: { ForcedLogoutBounce: "forced_logout_bounce" } }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  let row: Record<string, unknown> | null = null;
  for (const k of ["select", "eq", "order", "limit", "maybeSingle", "single", "in"]) q[k] = () => q;
  q.update = (patch: Record<string, unknown>) => {
    updates.push(patch);
    row = { ...(current.profile ?? {}), ...patch };
    current.profile = row;
    return q;
  };
  q.insert = async () => ({ data: null, error: null });
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: row ? [row] : null, error: null });
  return {
    supabase: {
      rpc: async () => ({ data: null, error: null }),
      from: () => q,
      auth: { getSession: async () => ({ data: { session: null } }) },
      storage: { from: () => ({}) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
  };
});

import ProtectedRoute from "@/components/ProtectedRoute";
import CompleteProfile from "@/pages/auth/CompleteProfile";
import { isCommitmentPath } from "@/lib/profileGateRoutes";

const google = { id: "u-g", email: "g@example.com", email_confirmed_at: "2026-11-14T00:00:00Z", app_metadata: { provider: "google" }, user_metadata: {} };
const agreed = { accepted_terms_at: "2026-11-14T00:00:00Z", terms_accepted_at: "2026-11-14T00:00:00Z", age_attested_at: "2026-11-14T00:00:00Z" };
const base = { user_id: "u-g", full_name: "", location: null, zip_code: null, bio: null, avatar_url: null, date_of_birth: null, is_legacy_user: false, ban_status: "active" };

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path.split("?")[0]} element={<ProtectedRoute fullProfile={isCommitmentPath(path)}><p>PROTECTED</p></ProtectedRoute>} />
          <Route path="/complete-profile" element={<CompleteProfile />} />
          <Route path="/home" element={<p>HOME</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  updates.length = 0;
  current.user = google;
});

describe("deferred complete-profile (owner 11-14)", () => {
  it("a Google member who agreed but gave no name lands on Home, not the form", () => {
    current.profile = { ...base, ...agreed };
    renderAt("/home");
    expect(screen.getByText("PROTECTED")).toBeInTheDocument();
  });

  it("the name is asked on a commitment route (posting, messaging)", () => {
    for (const path of ["/post-job", "/messages"]) {
      current.profile = { ...base, ...agreed };
      renderAt(path);
      expect(screen.queryByText("PROTECTED"), path).toBeNull();
      expect(screen.getByTestId("complete-profile-names"), path).toBeInTheDocument();
      cleanup();
    }
  });

  it("a member who has not accepted the Terms and attested 18+ cannot reach Home", () => {
    current.profile = { ...base, full_name: "Gia Guidry" };
    renderAt("/home");
    expect(screen.queryByText("PROTECTED")).toBeNull();
    expect(screen.getByTestId("complete-profile-consent-step")).toBeInTheDocument();
  });

  it("the OAuth sign-up step shows only the Terms and 18+ boxes, then lands on Home", async () => {
    current.profile = { ...base };
    renderAt("/home");
    const step = screen.getByTestId("complete-profile-consent-step");
    expect(step.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
    expect(step.querySelectorAll('input:not([type="checkbox"]):not([aria-hidden="true"]), textarea')).toHaveLength(0);
    expect(screen.queryByLabelText(/city/i)).toBeNull();
    const cont = screen.getByRole("button", { name: /continue/i });
    expect(cont).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /agree/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /confirm I am 18/ }));
    fireEvent.click(cont);
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(Object.keys(updates[0]).sort()).toEqual(["accepted_terms_at", "age_attested_at", "terms_accepted_at", "terms_version_accepted"]);
    expect(await screen.findByText("PROTECTED")).toBeInTheDocument();
  });

  it("an email sign-up whose sign-up never finished (no Terms, no 18+ on record) must tick the 18+ box too", async () => {
    current.user = { ...google, id: "u-e", app_metadata: { provider: "email" } };
    current.profile = { ...base, user_id: "u-e", full_name: "Eli Email" };
    renderAt("/home");
    const step = screen.getByTestId("complete-profile-consent-step");
    expect(step.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: /agree/i }));
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /confirm I am 18/ }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toHaveProperty("age_attested_at");
  });

  it("App.tsx asks the full profile (fullProfile) on exactly the protected routes isCommitmentPath names", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const routes = [...app.matchAll(/<Route path="([^"]+)" element=\{[^\n]*?<ProtectedRoute( fullProfile)?[ >]/g)];
    expect(routes.length).toBeGreaterThan(30); // 35 protected routes in App.tsx, 2026-11-14
    const sample = (p: string) => p.replace(/:[A-Za-z]+/g, "x").replace(/\*$/, "x");
    const asked = routes.filter((m) => !!m[2]).map((m) => m[1]).sort();
    const named = routes.filter((m) => isCommitmentPath(sample(m[1]))).map((m) => m[1]).sort();
    expect(asked.length).toBeGreaterThan(5);
    expect(asked).toEqual(named);
  });

  it("isCommitmentPath names the commitment routes and nothing else", () => {
    const commitments = ["/post-job", "/post-job/", "/declutter/sell", "/declutter/sell/bunch", "/declutter/move", "/declutter/wanted/new", "/shops/mine", "/shops/dashboard", "/rentals/listings/new", "/messages", "/messages/abc", "/messages?c=1", "/book/u1", "/quotes/send/q1", "/rentals/listings/l1/edit"];
    expect(commitments.length).toBeGreaterThan(10);
    for (const p of commitments) {
      expect(isCommitmentPath(p), p).toBe(true);
    }
    for (const p of ["/home", "/jobs", "/jobs/123", "/declutter", "/declutter/item/9", "/declutter/selling", "/profile", "/post-jobs", "/rentals/listings/l1", "/book", "/quotes/send", "/messagesx", "/shops"]) {
      expect(isCommitmentPath(p), p).toBe(false);
    }
  });
});
