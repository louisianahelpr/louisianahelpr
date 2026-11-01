/**
 * B42 (10-31, vacuity mount-wiring finding on main): WantedReportPanel was tested only on its own, and nothing that
 * renders its production parent (AdminReports) was, so a broken mount (wrong props, never rendered) stayed green.
 * This renders the real Reports queue with a reported Wanted post (rows mocked at the Supabase client) and finds the
 * real panel with the post's words in it.
 *
 * @mutate src/components/admin/AdminReports.tsx | {report.reported_wanted && <WantedReportPanel | {false && <WantedReportPanel
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, rpc: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const CHAIN = ["select", "eq", "neq", "in", "is", "not", "or", "order", "gte", "lte", "gt", "lt", "ilike", "match", "filter", "contains", "range", "limit"];
  const builder = (rows: unknown[]) => {
    let seedOnly: boolean | null = null;
    const b: Record<string, unknown> = {};
    for (const m of CHAIN) b[m] = () => b;
    b.eq = (k: string, v: unknown) => { if (k === "is_seed") seedOnly = v as boolean; return b; };
    const out = () => (seedOnly === null ? rows : rows.filter((r) => ((r as { is_seed?: boolean }).is_seed ?? false) === seedOnly));
    b.maybeSingle = async () => ({ data: out()[0] ?? null, error: null });
    b.single = async () => ({ data: out()[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: out(), error: null, count: out().length }).then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(db.tables[t] ?? []),
      rpc: async (name: string) => ({ data: db.rpc[name] ?? [], error: null }),
      functions: { invoke: async () => ({ data: {}, error: null }) },
      auth: {
        getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
      },
      channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
      removeChannel: () => undefined,
    },
  };
});
vi.mock("@/components/UserAvatar", () => ({ default: () => null, UserAvatar: () => null }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import AdminReports from "@/components/admin/AdminReports";

const PAST = "2026-10-30T12:00:00Z";

beforeEach(() => {
  db.tables = {
    reports: [{
      id: "r-1", reporter_id: "u-2", reported_id: "w-1", reported_type: "declutter_wanted", reason: "spam",
      description: "Asks people to pay off the app.", status: "pending", created_at: PAST, updated_at: PAST,
      assigned_to: null, resolution_notes: null,
    }],
    profiles: [
      { user_id: "u-1", full_name: "Clementine Arceneaux", email: "clem@example.com" },
      { user_id: "u-2", full_name: "Hank Broussard", email: "hank@example.com" },
    ],
  };
  db.rpc = {
    declutter_admin_reported_wanted: [{
      wanted_id: "w-1", what: "Looking for a crib in Lafayette", poster_id: "u-1", status: "open",
      removed: false, is_seed: false, photo_paths: [], photos_held: [],
    }],
  };
});

describe("AdminReports mounts WantedReportPanel for a reported Wanted post", () => {
  it("the queue shows the real panel with the post's words", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AdminReports />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const words = await screen.findByText("Looking for a crib in Lafayette");
    const panel = words.closest("[data-wanted-report]") as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByText("Wanted post:")).toBeInTheDocument();
  });
});
