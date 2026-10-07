/**
 * Q1324 (owner, 2026-10-05: "ban now, admin settles"): the admin decides an
 * automatic card / bank ban's jobs, and doubt-checks name matches.
 *
 *   - every job the settlement would act on is listed before anything moves;
 *   - Confirm takes a second step, then runs admin_confirm_ban_settlement;
 *   - Lift unbans through the one ban write path (admin-user-actions
 *     set_ban_status active), which closes the review server-side;
 *   - a name match is read from admin-only ban_evasion_matches and can be
 *     marked checked; a queue that cannot be read never reads as all-clear.
 *
 * @mutate src/components/admin/AdminBanEvasionReview.tsx | unwrap(await supabase.rpc("admin_confirm_ban_settlement", { p_user_id: review.user_id })); | void 0;
 * @mutate src/components/admin/AdminBanEvasionReview.tsx | banStatus: "active", | banStatus: "final_warning",
 * @mutate src/components/admin/AdminBanEvasionReview.tsx | {r.jobs.map((j) => ( | {r.jobs.slice(1).map((j) => (
 * @mutate src/components/admin/AdminBanEvasionReview.tsx | ) : reviews.isError ? ( | ) : false ? (
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminBanEvasionReview } from "./AdminBanEvasionReview";

const rpcMock = vi.fn();
const invokeMock = vi.fn();
const updateMock = vi.fn();
let namesResult: { data: unknown; error: unknown } = { data: [], error: null };
const inCalls: Array<{ col: string; vals: string[] }> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (table: string) => {
      if (table !== "ban_evasion_matches") throw new Error(`unexpected table ${table}`);
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: (col: string, vals: string[]) => {
          inCalls.push({ col, vals });
          return chain;
        },
        order: () => chain,
        limit: async () => namesResult,
        update: (payload: unknown) => ({
          eq: (_c: string, id: string) => ({
            select: async () => {
              updateMock(payload, id);
              return { data: [{ id }], error: null };
            },
          }),
        }),
      };
      return chain;
    },
  },
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

const USER = "aaaaaaaa-0000-4000-8000-0000000000aa";
const REVIEW = {
  review_id: "r1",
  user_id: USER,
  email: "evader@example.test",
  full_name: "Pat Evader",
  ban_status: "permanently_banned",
  matched_on: "card",
  created_at: "2026-10-05T20:00:00Z",
  matches: [{ id: "m1", matched_on: "card", original_ban_status: "permanently_banned", original_reason: "Took payment and never showed up", original_recorded_at: "2026-09-01T00:00:00Z" }],
  jobs: [
    { id: "j1", title: "Gutter cleaning", status: "accepted", payment_status: "escrow", role: "poster" },
    { id: "j2", title: "Moving help", status: "in_progress", payment_status: "escrow", role: "helpr" },
  ],
};

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminBanEvasionReview />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  invokeMock.mockReset();
  updateMock.mockReset();
  toastError.mockReset();
  namesResult = { data: [], error: null };
  rpcMock.mockImplementation(async (fn: string) =>
    fn === "admin_ban_settlement_reviews" ? { data: [REVIEW], error: null } : { data: { confirmed: true }, error: null },
  );
  invokeMock.mockResolvedValue({ data: { success: true }, error: null });
});

describe("AdminBanEvasionReview (Q1324)", () => {
  it("lists every job waiting on the decision, with the banned account it matched", async () => {
    renderIt();
    expect(await screen.findByText(/Gutter cleaning/)).toBeInTheDocument();
    expect(screen.getByText(/Moving help/)).toBeInTheDocument();
    expect(screen.getByText(/Jobs waiting \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Took payment and never showed up/)).toBeInTheDocument();
  });

  it("Confirm takes a second step, then runs the settlement for that account", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm ban" }));
    expect(rpcMock).not.toHaveBeenCalledWith("admin_confirm_ban_settlement", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: /Yes, settle 2 jobs now/ }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("admin_confirm_ban_settlement", { p_user_id: USER }));
  });

  it("Lift unbans through admin-user-actions set_ban_status", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Lift ban" }));
    fireEvent.click(screen.getByRole("button", { name: /Yes, lift the ban/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("admin-user-actions", {
        body: { action: "set_ban_status", userId: USER, banStatus: "active", suspendedUntil: null },
      }),
    );
  });

  it("a name match can be marked checked", async () => {
    namesResult = {
      data: [{ id: "n1", user_id: USER, matched_on: "name", original_ban_status: "banned", original_reason: "Harassment", original_recorded_at: null, created_at: "2026-10-05T20:00:00Z" }],
      error: null,
    };
    renderIt();
    expect(await screen.findByText(/Harassment/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark checked" }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("admin_resolve_ban_evasion_match", { p_match_id: "n1" }));
  });

  // Q1416: the phone and ID near-matches are doubt-checks too, listed beside
  // the name, each named for what matched.
  // @mutate src/components/admin/AdminBanEvasionReview.tsx |   phone_near: "Same last 7 phone digits", |
  it("lists phone and ID near-matches with what matched (Q1416)", async () => {
    namesResult = {
      data: [
        { id: "p1", user_id: USER, matched_on: "phone_near", original_ban_status: "banned", original_reason: "Threats", original_recorded_at: null, created_at: "2026-10-07T20:00:00Z" },
        { id: "i1", user_id: USER, matched_on: "identity_near", original_ban_status: "banned", original_reason: "Fraud", original_recorded_at: null, created_at: "2026-10-07T20:00:00Z" },
      ],
      error: null,
    };
    renderIt();
    expect(await screen.findByText("Same last 7 phone digits")).toBeInTheDocument();
    expect(screen.getByText("Same name and date of birth on ID")).toBeInTheDocument();
    const kinds = inCalls.find((c) => c.col === "matched_on")?.vals ?? [];
    expect([...kinds].sort()).toEqual(["identity_near", "name", "phone", "phone_near"]);
  });

  // Q1413: strikes earned during an open review are kept; the admin deciding
  // sees them and what the lift will apply.
  // @mutate src/components/admin/AdminBanEvasionReview.tsx |                 {(r.strikes_during_review?.length ?? 0) > 0 && ( |                 {false && (
  // @mutate src/components/admin/AdminBanEvasionReview.tsx |                 {deferredLabel(r) && ( |                 {false && (
  it("shows the strikes recorded during the review and what a lift applies (Q1413)", async () => {
    rpcMock.mockImplementation(async (name: string) =>
      name === "admin_ban_settlement_reviews"
        ? {
            data: [{
              ...REVIEW,
              deferred_ban_status: "temp_banned",
              deferred_suspended_until: "2026-10-14T00:00:00Z",
              strikes_during_review: [{ id: "v1", violation_type: "no_show", description: "Reported no-show", job_id: "job-9", created_at: "2026-10-07T00:00:00Z" }],
            }],
            error: null,
          }
        : { data: null, error: null },
    );
    renderIt();
    expect(await screen.findByText(/Strikes recorded during this review \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/no show: Reported no-show \(job job-9\)/)).toBeInTheDocument();
    expect(screen.getByTestId("ban-review-deferred").textContent).toMatch(/a suspension until/);
  });

  it("an unreadable review queue never reads as all-clear", async () => {
    rpcMock.mockImplementation(async () => ({ data: null, error: { message: "permission denied", code: "42501" } }));
    renderIt();
    expect(await screen.findByText(/couldn't load the ban settlement reviews/i)).toBeInTheDocument();
    expect(screen.queryByText(/No accounts waiting/)).toBeNull();
  });
});
