// BrowseMap — layer-toggle persistence test. The interesting behavior
// here is the Pins/Heat toggle: tapping it must persist the choice in
// localStorage under `helpr_browse_map_layer` so a helper who prefers
// Heat across sessions keeps it, and a stored preference must
// suppress the auto-Heat-at-50-jobs heuristic so we never overwrite
// an explicit user choice.
//
// We mock leaflet, react-leaflet, react-leaflet-cluster, the leaflet
// CSS import, and the Supabase client so the test stays in jsdom and
// doesn't need a real map runtime.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

// --- Mocks ------------------------------------------------------------

// Capture the RPC resolver so individual tests can choose how many
// rows the map sees (matters for the auto-Heat-at-50 heuristic).
const rpcResolver = { value: [] as Array<Record<string, unknown>> };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(() => Promise.resolve({ data: rpcResolver.value, error: null })),
    // BrowseMap also reads the total open-jobs count via
    // `supabase.from("open_jobs_browse").select(...).neq(...).then(...)`
    // to populate the "N of M" denominator. The chain returns a thenable
    // that resolves with `{ count, error }` so .then() callers don't crash.
    from: vi.fn(() => {
      const result = { count: rpcResolver.value.length, error: null };
      const chain: {
        select: () => typeof chain;
        neq: () => typeof chain;
        then: (resolve: (v: typeof result) => unknown) => Promise<unknown>;
      } = {
        select: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        then: (resolve) => Promise.resolve(resolve(result)),
      };
      return chain;
    }),
  },
}));

vi.mock("@/lib/errorLogger", () => ({
  report: vi.fn(),
}));

// Leaflet CSS — vitest can't parse the .css import.
vi.mock("leaflet/dist/leaflet.css", () => ({}));

// react-leaflet — render children inline so the toggle still mounts
// and the buttons are interactive in jsdom.
vi.mock("react-leaflet", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    MapContainer: Pass,
    TileLayer: () => null,
    Marker: Pass,
    Popup: Pass,
    CircleMarker: Pass,
    useMap: () => ({
      flyTo: vi.fn(),
      setView: vi.fn(),
      fitBounds: vi.fn(),
      getZoom: () => 7,
    }),
  };
});

vi.mock("react-leaflet-cluster", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("leaflet", () => ({
  divIcon: () => ({}),
  point: (x: number, y: number) => [x, y],
}));

// --- Helpers ----------------------------------------------------------

function makeJob(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `job-${i}`,
    title: `Job ${i}`,
    category: "cleaning",
    budget: 50,
    is_urgent: false,
    latitude: 30.0 + i * 0.001,
    longitude: -91.0 + i * 0.001,
    parish: "Orleans",
    created_at: new Date().toISOString(),
    // Card-parity columns, added to get_open_jobs_for_map by migration
    // 20260823120000. `location` arrives pre-masked to "City, State".
    location: "New Orleans, LA",
    date_needed: "2099-09-19",
    start_time: "08:30:00",
    urgent_fee: 0,
    is_group_job: false,
    helpers_needed: 1,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  rpcResolver.value = [makeJob(1), makeJob(2)];
  vi.clearAllMocks();
});

// --- Tests ------------------------------------------------------------

describe("BrowseMap layer toggle", () => {
  it("defaults to Pins when no stored preference exists", async () => {
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const pins = await screen.findByTestId("browse-map-layer-pins");
    const heat = screen.getByTestId("browse-map-layer-heat");
    expect(pins).toHaveAttribute("aria-pressed", "true");
    expect(heat).toHaveAttribute("aria-pressed", "false");
  });

  it("persists the user's choice to localStorage under helpr_browse_map_layer", async () => {
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const heat = await screen.findByTestId("browse-map-layer-heat");
    fireEvent.click(heat);

    expect(window.localStorage.getItem("helpr_browse_map_layer")).toBe("heat");
    expect(heat).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("browse-map-layer-pins")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByTestId("browse-map-layer-pins"));
    expect(window.localStorage.getItem("helpr_browse_map_layer")).toBe("pins");
  });

  it("initializes from the stored preference on mount", async () => {
    window.localStorage.setItem("helpr_browse_map_layer", "heat");
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const heat = await screen.findByTestId("browse-map-layer-heat");
    expect(heat).toHaveAttribute("aria-pressed", "true");
  });

  it("respects a stored Pins preference even when there are 50+ open jobs (auto-Heat is suppressed)", async () => {
    window.localStorage.setItem("helpr_browse_map_layer", "pins");
    rpcResolver.value = Array.from({ length: 60 }, (_, i) => makeJob(i));
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    // Wait for the RPC promise to flush.
    await waitFor(() => {
      expect(screen.getByTestId("browse-map-job-count")).toHaveTextContent("60 jobs");
    });
    // Even with 60 jobs, the stored Pins preference must win.
    expect(screen.getByTestId("browse-map-layer-pins")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.localStorage.getItem("helpr_browse_map_layer")).toBe("pins");
  });

  it("renders a job-count badge that reflects the loaded RPC rows", async () => {
    rpcResolver.value = [makeJob(1), makeJob(2), makeJob(3)];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    await waitFor(() => {
      expect(screen.getByTestId("browse-map-job-count")).toHaveTextContent("3 jobs");
    });
  });

  it("survives localStorage throwing (private-browsing / sandboxed contexts)", async () => {
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    // Force setItem to throw — the toggle should still flip in-session.
    window.localStorage.setItem = vi.fn(() => {
      throw new Error("QuotaExceededError");
    }) as unknown as typeof window.localStorage.setItem;

    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const heat = await screen.findByTestId("browse-map-layer-heat");
    act(() => {
      fireEvent.click(heat);
    });
    expect(heat).toHaveAttribute("aria-pressed", "true");

    window.localStorage.setItem = originalSetItem;
  });
});

// The pin popup and the browse JobCard describe the same job, so they must say
// the same things. `Popup` is mocked as a pass-through above, which means the
// popup body renders inline in jsdom and is directly assertable.
describe("BrowseMap pin popup — parity with the browse job card", () => {
  it("shows the category, city, date and start time the card shows", async () => {
    rpcResolver.value = [
      makeJob(1, {
        title: "Haul two loads to the dump",
        category: "moving",
        location: "Lake Charles, LA",
        date_needed: "2099-09-19",
        start_time: "08:30:00",
      }),
    ];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap ctaLabel="Apply" onJobAction={vi.fn()} />);

    const popup = await screen.findByTestId("map-job-popup");
    expect(popup).toHaveTextContent("Haul two loads to the dump");
    // Coloured category CHIP, not the old plain-grey "Moving · Orleans" line.
    expect(screen.getByTestId("map-popup-category")).toHaveTextContent("Moving");
    const meta = screen.getByTestId("map-popup-meta");
    // City from the masked location — not the parish it used to print.
    expect(meta).toHaveTextContent("Lake Charles");
    expect(meta).toHaveTextContent("Sep 19");
    expect(meta).toHaveTextContent("8:30 AM");
    // The CTA and its behaviour survive the rewrite.
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
  });

  it("prints the helper's NET take-home when a fee is supplied, like the card", async () => {
    rpcResolver.value = [makeJob(1, { budget: 110 })];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap effectiveFee={12} />);

    // $110 gross − 12% = $96.80, floored to $96 — exactly what JobPrice renders
    // on the card beside it. The popup used to print the gross $110.
    const popup = await screen.findByTestId("map-job-popup");
    expect(popup).toHaveTextContent("$96");
    expect(popup).not.toHaveTextContent("$110");
  });

  it("falls back to the gross budget when no fee is supplied", async () => {
    rpcResolver.value = [makeJob(1, { budget: 110 })];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const popup = await screen.findByTestId("map-job-popup");
    expect(popup).toHaveTextContent("$110");
  });

  it("degrades to parish and hides the schedule when the RPC predates the card-fields migration", async () => {
    // The old nine-column row: the new keys are ABSENT, not null.
    rpcResolver.value = [
      {
        id: "job-legacy",
        title: "Job legacy",
        category: "cleaning",
        budget: 50,
        is_urgent: false,
        latitude: 30.0,
        longitude: -91.0,
        parish: "Calcasieu",
        created_at: new Date().toISOString(),
      },
    ];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const meta = await screen.findByTestId("map-popup-meta");
    expect(meta).toHaveTextContent("Calcasieu");
    // No date/time row, and crucially no "Flexible" — that would claim the job
    // has no schedule when we simply weren't told what it is.
    expect(meta).not.toHaveTextContent("Flexible");
  });

  it('renders the card\'s "Flexible" fallback only when the row really has no schedule', async () => {
    rpcResolver.value = [makeJob(1, { date_needed: null, start_time: null })];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const meta = await screen.findByTestId("map-popup-meta");
    expect(meta).toHaveTextContent("Flexible");
  });

  it("shows the urgent bonus the card shows", async () => {
    rpcResolver.value = [makeJob(1, { is_urgent: true, urgent_fee: 12 })];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const popup = await screen.findByTestId("map-job-popup");
    expect(popup).toHaveTextContent("+$12 Urgent");
  });
});
