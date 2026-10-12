/**
 * Q1521 mount: /str-settings itself draws the "Ready to Post" list.
 *
 * ReadyTurnovers.test.tsx renders the list alone, so a page that stopped
 * mounting it (or mounted it behind the wrong condition) stayed green; main's
 * Vacuity (run 38317156550, 2026-10-12) flagged it as a mount-wiring gap.
 * This renders the real StrSettings page with one active calendar and one
 * pending checkout, and asserts the checkout's Post a Job link appears; with
 * no calendar connected the list is not drawn.
 *
 * @mutate src/pages/profile/StrSettings.tsx |                 {connections.length > 0 && <ReadyTurnovers />}\n | \n
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StrSettings from "../StrSettings";

const state = vi.hoisted(() => ({ connections: [] as unknown[], events: [] as unknown[] }));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "host-1" }, profile: null, loading: false }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: () => unknown[]) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      gte: () => b,
      order: () => b,
      limit: () => b,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
    };
    return b;
  };
  return {
    supabase: {
      from: (t: string) =>
        t === "str_calendar_connections"
          ? builder(() => state.connections)
          : t === "str_processed_events"
            ? builder(() => state.events)
            : builder(() => []),
      auth: { getSession: async () => ({ data: { session: null } }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
  };
});

const connection = {
  id: "conn-1",
  user_id: "host-1",
  platform: "airbnb",
  ical_url: "https://example.com/cal.ics",
  property_name: "Bayou Cottage",
  property_address: null,
  auto_create_cleaning: false,
  cleaning_budget: 80,
  cleaning_notes: null,
  is_active: true,
  last_synced_at: null,
  last_sync_error: null,
  created_at: "2026-10-01T00:00:00Z",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <StrSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("/str-settings mounts Ready to Post (Q1521)", () => {
  beforeEach(() => {
    state.connections = [];
    state.events = [];
  });

  it("a host with a calendar and a pending checkout sees it listed on the page", async () => {
    state.connections = [connection];
    state.events = [
      { id: "ev-1", checkout_date: "2030-05-02", job_id: null, jobs: null, str_calendar_connections: { property_name: "Bayou Cottage", is_active: true } },
    ];
    renderPage();
    const links = await screen.findAllByTestId("ready-turnover");
    expect(links.length).toBeGreaterThan(0);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/post-job?turnover=ev-1"]);
  });

  it("with no calendar connected the list is not drawn", async () => {
    state.events = [
      { id: "ev-1", checkout_date: "2030-05-02", job_id: null, jobs: null, str_calendar_connections: { property_name: "Bayou Cottage", is_active: true } },
    ];
    renderPage();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryAllByTestId("ready-turnover")).toEqual([]);
  });
});
