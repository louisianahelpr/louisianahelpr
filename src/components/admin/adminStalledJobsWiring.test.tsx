/**
 * THE WIRING, not the component.
 *
 * `AdminStalledJobs` rendering correctly on its own proves nothing about an
 * admin ever reaching it: the console routes by a `?view=` id that has to
 * exist in THREE places — `adminNavGroups` (the rail and the command palette),
 * `VIEW_LABELS` (the h1 and the "is this a real view?" coercion) and the
 * `renderContent` switch in `src/pages/Admin.tsx`. Miss the third and
 * `isRealView` silently coerces the deep link to the dashboard: the rail row
 * exists, tapping it looks like nothing happened, and no unit test notices.
 *
 * So this file does both halves:
 *   1. mounts the real /admin page at `?view=stalled` and asserts the queue is
 *      on screen — the whole chain, executed;
 *   2. a registry guard for the CLASS: every rail id must be a real view with
 *      a label and a case, derived from the source rather than from a list
 *      that would need maintaining beside it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpcMock = vi.hoisted(() => vi.fn());

/** Chainable `from()` stub: every admin dashboard read resolves to empty. */
vi.mock("@/integrations/supabase/client", () => {
  const build = () => {
    const b: Record<string, unknown> = {};
    for (const m of [
      "select", "eq", "neq", "in", "is", "or", "not", "gte", "lte", "gt", "lt",
      "order", "limit", "range", "filter", "contains", "overlaps",
    ]) {
      b[m] = () => b;
    }
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: null, error: null });
    b.then = (res: (v: unknown) => void) => res({ data: [], error: null, count: 0 });
    return b;
  };
  return {
    supabase: {
      from: () => build(),
      rpc: (...args: unknown[]) => rpcMock(...args),
      auth: {
        getUser: async () => ({ data: { user: { id: "admin-1" } } }),
        getSession: async () => ({ data: { session: { user: { id: "admin-1" } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn(async () => {}) }));
vi.mock("@/lib/authSignOut", () => ({ signOutWithPushCleanup: vi.fn(async () => {}) }));
vi.mock("@/lib/realtimeRecovery", () => ({ subscribeWithRecovery: () => ({ close: () => {} }) }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "admin-1" }, profile: { user_id: "admin-1", full_name: "Admin" } }),
}));

import Admin from "@/pages/Admin";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const ROOT = resolve(__dirname, "../../..");

/** Budget for a React.lazy import + its transform on a cold module cache. */
const LAZY_MS = 15_000;

const QUEUE_ROW = {
  job_id: "6f1c3d12-0a4c-4f2f-9f2d-5c1f0b8a7e21",
  title: "Haul off storm debris",
  customer_id: "poster-1",
  helper_id: "helper-1",
  budget: 240,
  date_needed: jobLocalDateISO(-5),
  start_time: "09:00:00",
  estimated_hours: 3,
  status: "in_progress",
  payment_status: "escrow",
  /* Relative, and anchored to the SAME day as `date_needed` above. These were
     absolute ("2026-09-16/17/18") and coherent with a hardcoded date_needed of
     2026-09-15 — one, two and three days after the job. The moment date_needed
     became relative, the cluster drifted apart, because half of it still named
     a fixed calendar and half of it moved with today. The whole ladder has to
     travel together or the row stops being an escalated one. */
  first_sent_at: `${jobLocalDateISO(-4)}T14:00:00Z`,
  second_sent_at: `${jobLocalDateISO(-3)}T14:00:00Z`,
  escalated_at: `${jobLocalDateISO(-2)}T14:00:00Z`,
  resolved_at: null,
};

describe("/admin?view=stalled actually renders the stuck-job queue", () => {
  it("mounts the queue, with its escalated row, from the URL alone", async () => {
    rpcMock.mockImplementation(async (fn: string) =>
      fn === "admin_stalled_job_queue" ? { data: [QUEUE_ROW], error: null } : { data: null, error: null },
    );

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/admin?view=stalled"]}>
          <Admin />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // The section header the page derives from VIEW_LABELS…
    expect(await screen.findByRole("heading", { level: 1, name: "Stuck Jobs" })).toBeInTheDocument();
    /*
     * …and the lazy component the switch mounts under it, with real data.
     *
     * LAZY_MS, not findBy's 1s default. `AdminStalledJobs` is reached through
     * React.lazy, so this assertion waits on a dynamic import that vitest must
     * still transform. Inside the full suite the module cache is warm and 1s is
     * plenty; standing alone it is a coin flip, and this file FAILED on its own
     * while passing in CI (measured 2026-09-21).
     *
     * That is worse than a slow test: the vacuity gate runs a guard ALONE when
     * it applies a mutation, so a guard that is red on its own is scored
     * `killed` for a reason that has nothing to do with the mutation — a proof
     * it never performed. Both registrations below were in that state.
     *
     * The timeout does not weaken anything. If the queue never mounts, this
     * still fails; it just stops failing for being cold.
     */
    expect(await screen.findByText("Haul off storm debris", {}, { timeout: LAZY_MS })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Mark Reviewed" }, { timeout: LAZY_MS }),
    ).toBeInTheDocument();
    // The one sentence this screen must keep true, rendered in situ.
    expect(screen.getByText(/Nothing here moves money/)).toBeInTheDocument();
  });
});

describe("admin rail registry — every id is a view that renders", () => {
  const adminSource = readFileSync(resolve(ROOT, "src/pages/Admin.tsx"), "utf8");
  const ids = adminNavGroups.flatMap((g) => g.items.map((i) => i.id));

  it("has a VIEW_LABELS entry for every rail row", () => {
    const block = adminSource.slice(
      adminSource.indexOf("const VIEW_LABELS"),
      adminSource.indexOf("const Admin = ()"),
    );
    const missing = ids.filter((id) => !new RegExp(`\\b${id}:\\s*"`).test(block));
    expect(missing, "rail rows with no VIEW_LABELS entry — their deep link coerces to home").toEqual([]);
  });

  it("has a renderContent case for every rail row", () => {
    const block = adminSource.slice(adminSource.indexOf("const renderContent"));
    // "home" is the switch's `default:` — every other id needs its own case.
    const missing = ids.filter((id) => id !== "home" && !block.includes(`case "${id}":`));
    expect(missing, "rail rows that render nothing — tapping them looks like a dead button").toEqual([]);
  });
});

// Rename the switch case and the rail row still exists, the h1 still renders
// from VIEW_LABELS, and /admin?view=stalled quietly shows the dashboard —
// exactly the dead-button shape both halves of this file police.
// @mutate src/pages/Admin.tsx | case "stalled": return <AdminStalledJobs />; | case "stalled_gone": return <AdminStalledJobs />;
