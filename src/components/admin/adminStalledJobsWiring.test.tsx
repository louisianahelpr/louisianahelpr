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

const ROOT = resolve(__dirname, "../../..");

const QUEUE_ROW = {
  job_id: "6f1c3d12-0a4c-4f2f-9f2d-5c1f0b8a7e21",
  title: "Haul off storm debris",
  customer_id: "poster-1",
  helper_id: "helper-1",
  budget: 240,
  date_needed: "2026-09-15",
  start_time: "09:00:00",
  estimated_hours: 3,
  status: "in_progress",
  payment_status: "escrow",
  first_sent_at: "2026-09-16T14:00:00Z",
  second_sent_at: "2026-09-17T14:00:00Z",
  escalated_at: "2026-09-18T14:00:00Z",
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
    // …and the lazy component the switch mounts under it, with real data.
    expect(await screen.findByText("Haul off storm debris")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Mark Reviewed" })).toBeInTheDocument();
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
