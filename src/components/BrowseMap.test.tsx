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

function makeJob(i: number) {
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
