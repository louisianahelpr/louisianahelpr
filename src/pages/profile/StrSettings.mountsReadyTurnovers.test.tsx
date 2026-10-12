/**
 * MOUNT WIRING: /str-settings really renders "Ready to post".
 *
 * ReadyTurnovers is tested ALONE (strSettings/ReadyTurnovers.test.tsx renders
 * it directly and only greps StrSettings for the tag). Nothing rendered the
 * page that mounts it, so a mount moved behind the wrong branch (say, the
 * loading or empty one) stayed green (vacuity class (b), mount-wiring). This
 * renders the real StrSettings: a host with a connected calendar sees the
 * checkout waiting to be posted, linking to Post a Job pre-filled; a host with
 * no calendar sees the connect card and no list.
 *
 * @mutate src/pages/profile/StrSettings.tsx | {connections.length > 0 && <ReadyTurnovers />} | {null}
 * @mutate src/pages/profile/StrSettings.tsx | {connections.length > 0 && <ReadyTurnovers />} | {connections.length > 1 && <ReadyTurnovers />}
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StrSettings from "./StrSettings";

const state = vi.hoisted(() => ({ connections: [] as unknown[], events: [] as unknown[] }));

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "host-mount-1" } }) }));
vi.mock("./strSettings/ConnectionCard", () => ({
  ConnectionCard: ({ conn }: { conn: { property_name: string } }) => <div data-testid="connection-card">{conn.property_name}</div>,
}));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (rows: () => unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "order", "limit"]) b[m] = () => b;
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null });
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
    },
  };
});

const CONNECTION = {
  id: "conn-mount-1",
  user_id: "host-mount-1",
  property_name: "Bayou Cottage",
  ical_url: "https://example.test/cal.ics",
  is_active: true,
  created_at: "2030-01-01T00:00:00Z",
};
const EVENT = {
  id: "ev-mount-1",
  checkout_date: "2030-05-02",
  job_id: null,
  jobs: null,
  str_calendar_connections: { property_name: "Bayou Cottage", is_active: true },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/str-settings"]}>
        <StrSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StrSettings mounts ReadyTurnovers", () => {
  beforeEach(() => {
    state.connections = [];
    state.events = [];
  });

  it("a host with a connected calendar sees the checkout waiting to be posted", async () => {
    state.connections = [CONNECTION];
    state.events = [EVENT];
    renderPage();
    const links = await screen.findAllByTestId("ready-turnover");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/post-job?turnover=ev-mount-1"]);
    expect(screen.getByTestId("connection-card")).toHaveTextContent("Bayou Cottage");
  });

  it("a host with no calendar sees the connect card and no list", async () => {
    state.events = [EVENT];
    renderPage();
    expect(await screen.findByText("Never scramble for a cleaner again")).toBeInTheDocument();
    expect(screen.queryByTestId("ready-turnover")).toBeNull();
  });
});
