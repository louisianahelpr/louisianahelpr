/**
 * F272a (audit 11-10): the tipper's /tips/<id> page read "You left a tip $3.00 <job title>" and nothing else, with no
 * way back to the job. It now says who got it and when ("To Hallie H. · Tue, Nov 10, 1:11 AM · Hallie H. got all of
 * it") and offers "See the job". The Helpr's own view is unchanged (Say thanks, its pay card).
 *
 * @mutate src/pages/tips/TipMoment.tsx | `To ${helprName} · ${tipWhen(tip.created_at)} · ${helprName} got all of it` | `To ${helprName}`
 * @mutate src/pages/tips/TipMoment.tsx |           onClick={() => navigate(`/jobs/${tip.job_id}`)} |           onClick={() => navigate("/home")}
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const TIPPER = "00000000-0000-4000-8000-000000000002";
const HELPR = "00000000-0000-4000-8000-000000000003";
const TIP = "6c1e5b2a-1d2e-4f00-8a00-0123456789ab";
const JOB = "7d1e5b2a-1d2e-4f00-8a00-0123456789ab";
let me = TIPPER;

const rows: Record<string, unknown> = {
  tips: { id: TIP, amount: 3, job_id: JOB, tipper_id: TIPPER, helper_id: HELPR, payment_status: "paid", created_at: "2026-11-10T07:11:00Z" },
  jobs: { title: "Hang three shelves", budget: 40, urgent_fee: 0, helpers_needed: 1, is_group_job: false, status: "completed", payment_status: "released", disputed_at: null, helper_fee_flat_cents: null, helper_fee_percent: 10 },
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return chain;
    },
    rpc: async () => ({ data: [{ user_id: TIPPER, full_name: "Lexi Lane" }, { user_id: HELPR, full_name: "Hallie Hart" }], error: null }),
  },
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: me }, profile: null, isLoading: false }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => null }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

const { default: TipMoment } = await import("@/pages/tips/TipMoment");

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderTip() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/tips/${TIP}`]}>
        <Routes>
          <Route path="/tips/:tipId" element={<TipMoment />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("F272a: the tipper sees who got the tip and when", () => {
  it("names the Helpr, the time (Louisiana), that they got all of it, and offers See the job", async () => {
    me = TIPPER;
    renderTip();
    const line = await screen.findByTestId("tip-to-when");
    expect(line.textContent).toBe("To Hallie H. · Tue, Nov 10, 1:11 AM · Hallie H. got all of it");
    fireEvent.click(screen.getByRole("button", { name: "See the job" }));
    expect(screen.getByTestId("where").textContent).toBe(`/jobs/${JOB}`);
  });

  it("the Helpr's own view keeps Say thanks and gets no tipper line", async () => {
    me = HELPR;
    renderTip();
    expect(await screen.findByRole("button", { name: "Say thanks" })).toBeTruthy();
    expect(screen.queryByTestId("tip-to-when")).toBeNull();
    expect(screen.queryByRole("button", { name: "See the job" })).toBeNull();
  });
});
