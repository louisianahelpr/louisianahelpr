// BrowseMap — pins-only now (owner, 2026-08-30: "remove heat, pins are
// fine"). The Pins/Heat toggle and its heuristics are gone.
//
// The map now runs on Apple MapKit JS, so instead of mocking react-leaflet we
// mock `useMapKitJs` (always "ready") and install a minimal `window.mapkit`
// stub — enough for the component's imperative lifecycle (construct a map, add
// annotations/overlays, animate the region) to run in jsdom.
//
// The pin popup is no longer a React child of the map: MapKit's callout
// delegate takes DOM, so the callout body (now the SAME `<JobCard>` the feed
// renders, via `mapJobToEnrichedJob`) is rendered into a detached node by its
// own root and is asserted directly in the popup-parity block below — same
// coverage, minus the map plumbing it never depended on.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { EMPTY_VIEWER_FEED_EXCLUSIONS, type ViewerFeedExclusions } from "@/pages/dashboard/viewerFeedExclusions";

import JobCard from "./dashboard/JobCard";
import { mapJobToEnrichedJob } from "./browseMap/mapJobToEnrichedJob";
import type { MapJob } from "./browseMap/config";

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

// The my-location button (VN-11) reads the app's one location funnel. The hook
// itself is tested in useUserLocation.test.tsx; here we drive its OUTCOMES —
// a fix, and a refusal — and assert what the map does with each.
const geoState = {
  value: { status: "idle" } as
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; lat: number; lng: number; source: string; approximate: boolean }
    | { status: "error"; message: string },
};
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => geoState.value,
  getCachedUserLocation: () => null,
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

// MapKit always authorizes in these tests — the degraded paths are the
// hook's own concern (see useMapKitJs.test.ts).
vi.mock("@/hooks/useMapKitJs", () => ({
  useMapKitJs: () => "ready",
  useMapKitTokenSource: () => "server",
}));

/** Every MapStub the component constructs, newest last — lets a test assert
 *  what the camera was actually told to do. */
const mapInstances: Array<{
  setRegionAnimated: ReturnType<typeof vi.fn>;
  addAnnotations: ReturnType<typeof vi.fn>;
}> = [];

/** The smallest `window.mapkit` the component's lifecycle can run against. */
function installMapKitStub() {
  class Coordinate {
    constructor(public latitude: number, public longitude: number) {}
  }
  class CoordinateSpan {
    constructor(public latitudeDelta: number, public longitudeDelta: number) {}
  }
  class CoordinateRegion {
    constructor(public center: Coordinate, public span: CoordinateSpan) {}
  }
  class MapStub {
    element: HTMLElement;
    region = new CoordinateRegion(new Coordinate(31, -92), new CoordinateSpan(4, 5));
    colorScheme = "light";
    annotations: unknown[] = [];
    overlays: unknown[] = [];
    annotationForCluster?: (c: unknown) => unknown;
    constructor(el: HTMLElement) {
      this.element = el;
      mapInstances.push(this as unknown as (typeof mapInstances)[number]);
    }
    addAnnotations = vi.fn();
    removeAnnotations = vi.fn();
    addOverlays = vi.fn();
    removeOverlays = vi.fn();
    setRegionAnimated = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    destroy = vi.fn();
  }
  class Annotation {
    constructor(
      public coordinate: Coordinate,
      public factory: unknown,
      public options?: Record<string, unknown>,
    ) {}
  }
  class CircleOverlay {
    addEventListener = vi.fn();
    constructor(
      public coordinate: Coordinate,
      public radius: number,
      public options?: Record<string, unknown>,
    ) {}
  }
  (window as unknown as { mapkit: unknown }).mapkit = {
    Map: MapStub,
    Coordinate,
    CoordinateSpan,
    CoordinateRegion,
    Annotation,
    CircleOverlay,
    Style: class {
      constructor(public options: Record<string, unknown>) {}
    },
    CameraZoomRange: class {
      constructor(public min: number, public max: number) {}
    },
    FeatureVisibility: { Hidden: "hidden" },
  };
}

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
  mapInstances.length = 0;
  geoState.value = { status: "idle" };
  toastError.mockClear();
  installMapKitStub();
});

// --- Tests ------------------------------------------------------------

describe("BrowseMap pins", () => {
  // Owner, 2026-08-30: "remove heat, pins are fine" — the Pins/Heat toggle,
  // its localStorage persistence, and the auto-switch-at-50-jobs heuristic
  // are gone. The map always renders pins now. The floating "N Jobs" count
  // badge was later removed too (redundant with the list-view toolbar's "N
  // jobs" label) — this test now just verifies loaded RPC rows render as
  // map markers instead of an empty-state.
  //
  // THIS TEST USED TO WAIT FOR NOTHING. It was
  // `await waitFor(() => expect(screen.queryByText("Empty map for now."))
  // .not.toBeInTheDocument())` — and the map's FIRST paint, before the RPC has
  // resolved, has no empty-state card either (`loading` renders the surface,
  // not the card). So the callback passed on poll #1 and the assertion proved
  // only that React mounted; it was on the GRANDFATHERED list in
  // `src/test/waitForEmptyIsVacuous.test.ts` for exactly that reason.
  //
  // Wait for the DATA instead: the rows reach MapKit as annotations, and only
  // once `addAnnotations` has been handed three of them is the absence of the
  // empty state a statement about this component's behaviour.
  it("renders pins for the loaded RPC rows instead of the empty state", async () => {
    rpcResolver.value = [makeJob(1), makeJob(2), makeJob(3)];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    await screen.findByTestId("browse-map-surface");
    await waitFor(() => expect(mapInstances.length).toBeGreaterThan(0));
    const map = mapInstances[mapInstances.length - 1];
    await waitFor(() => expect(map.addAnnotations).toHaveBeenCalled());
    const calls = map.addAnnotations.mock.calls;
    const pinned = calls[calls.length - 1]?.[0] as unknown[];
    expect(pinned).toHaveLength(3);
    expect(screen.queryByText("Empty map for now.")).not.toBeInTheDocument();
  });
});

// B1/B3 (owner live-QA 2026-09-15): the list feed hides jobs the viewer has
// applied to, but the map kept their pins — so an applied job pinned the map
// and its detail dialog still offered "Apply Now." The map now drops applied
// pins to match the feed and the header count.
describe("BrowseMap — viewer-local exclusions (B1/B3, and 2026-09-19)", () => {
  const exclude = (over: Partial<ViewerFeedExclusions>): ViewerFeedExclusions => ({
    ...EMPTY_VIEWER_FEED_EXCLUSIONS,
    ...over,
  });

  it("drops the pin for a job the viewer has applied to", async () => {
    // Both loaded jobs are applied → the map has nothing left to show and
    // falls to its empty state, exactly as the list feed does.
    rpcResolver.value = [makeJob(1), makeJob(2)];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap exclusions={exclude({ appliedJobIds: new Set(["job-1", "job-2"]) })} />);

    await waitFor(() => {
      expect(screen.getByText("Empty map for now.")).toBeInTheDocument();
    });
  });

  it("keeps pins for jobs the viewer has NOT applied to", async () => {
    rpcResolver.value = [makeJob(1), makeJob(2)];
    const { BrowseMap } = await import("./BrowseMap");
    // Only job-1 applied → job-2's pin remains, so no empty state.
    render(<BrowseMap exclusions={exclude({ appliedJobIds: new Set(["job-1"]) })} />);

    await waitFor(() => {
      expect(screen.getByTestId("browse-map-surface")).toBeInTheDocument();
    });
    expect(screen.queryByText("Empty map for now.")).not.toBeInTheDocument();
  });

  // Owner, 2026-09-19: "map shows 7 jobs. list shows 4." The three missing
  // cards were dismissed ("Not interested") — a cull the feed applied and the
  // map knew nothing about, so its pins over-reported the board.
  it("drops the pin for a job the viewer DISMISSED", async () => {
    rpcResolver.value = [makeJob(1), makeJob(2)];
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap exclusions={exclude({ dismissedJobIds: new Set(["job-1", "job-2"]) })} />);

    await waitFor(() => {
      expect(screen.getByText("Empty map for now.")).toBeInTheDocument();
    });
  });

  it("pins ONLY saved jobs while the 'Only saved' lens is on", async () => {
    rpcResolver.value = [makeJob(1), makeJob(2)];
    const { BrowseMap } = await import("./BrowseMap");
    // Lens on, nothing saved → an empty set means zero pins, NOT "no filter".
    render(<BrowseMap exclusions={exclude({ savedOnlyJobIds: new Set() })} />);

    await waitFor(() => {
      expect(screen.getByText("Empty map for now.")).toBeInTheDocument();
    });
  });
});

// The map surface itself: MapKit is loaded on demand and can fail to
// authorize. That must read as a stated outage with a way forward, never as a
// blank grey box.
describe("BrowseMap MapKit availability", () => {
  it("mounts a map surface and a my-location control when MapKit is ready", async () => {
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    expect(await screen.findByTestId("browse-map-surface")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("browse-map-my-location")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("browse-map-unavailable")).not.toBeInTheDocument();
  });

  it("says so plainly when MapKit cannot authorize", async () => {
    vi.resetModules();
    vi.doMock("@/hooks/useMapKitJs", () => ({
      useMapKitJs: () => "missing-token",
      useMapKitTokenSource: () => "none",
    }));
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const panel = await screen.findByTestId("browse-map-unavailable");
    expect(panel).toHaveTextContent("The map isn't available right now.");
    expect(panel).toHaveTextContent("switch to the list view");
    vi.doUnmock("@/hooks/useMapKitJs");
    vi.resetModules();
  });
});

// VN-11 (owner decision, 2026-09-14): the crosshair button used to fly back to
// the statewide Louisiana frame while wearing the universal "where am I" glyph.
// It now centres on the user — and when it can't, it says so instead of moving
// the camera somewhere the user didn't ask for without explanation.
describe("BrowseMap my-location button", () => {
  // The availability block above ends with `vi.doUnmock("@/hooks/useMapKitJs")`,
  // which drops the file-level `vi.mock` for that path too — so without this,
  // every test after it gets the REAL hook, no token, and a map that never
  // becomes ready. Re-assert the stub rather than depending on describe order.
  beforeEach(() => {
    vi.doMock("@/hooks/useMapKitJs", () => ({
      useMapKitJs: () => "ready",
      useMapKitTokenSource: () => "server",
    }));
    vi.resetModules();
  });

  it("is labelled for what it does", async () => {
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const btn = await screen.findByTestId("browse-map-my-location");
    expect(btn).toHaveAccessibleName("Show my location");
  });

  it("centres the camera on the user's position when one is available", async () => {
    geoState.value = { status: "ready", lat: 30.45, lng: -91.15, source: "device", approximate: false };
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const btn = await screen.findByTestId("browse-map-my-location");
    const map = mapInstances[mapInstances.length - 1];
    map.setRegionAnimated.mockClear();
    fireEvent.click(btn);

    await waitFor(() => expect(map.setRegionAnimated).toHaveBeenCalled());
    const calls = map.setRegionAnimated.mock.calls;
    const region = calls[calls.length - 1]?.[0];
    expect(region.center.latitude).toBeCloseTo(30.45, 5);
    expect(region.center.longitude).toBeCloseTo(-91.15, 5);
    // A device fix is framed tight; only a centroid gets the parish-wide span.
    expect(region.span.latitudeDelta).toBeLessThan(0.2);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("frames an APPROXIMATE position wider than a device fix", async () => {
    geoState.value = { status: "ready", lat: 30.45, lng: -91.15, source: "zip", approximate: true };
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const btn = await screen.findByTestId("browse-map-my-location");
    const map = mapInstances[mapInstances.length - 1];
    map.setRegionAnimated.mockClear();
    fireEvent.click(btn);

    await waitFor(() => expect(map.setRegionAnimated).toHaveBeenCalled());
    const calls = map.setRegionAnimated.mock.calls;
    const region = calls[calls.length - 1]?.[0];
    expect(region.span.latitudeDelta).toBeGreaterThan(0.2);
  });

  it("falls back to the Louisiana view and says why when location is refused", async () => {
    geoState.value = { status: "error", message: "Location permission denied" };
    const { BrowseMap } = await import("./BrowseMap");
    render(<BrowseMap />);

    const btn = await screen.findByTestId("browse-map-my-location");
    const map = mapInstances[mapInstances.length - 1];
    map.setRegionAnimated.mockClear();
    fireEvent.click(btn);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Location permission denied"));
    const calls = map.setRegionAnimated.mock.calls;
    const region = calls[calls.length - 1]?.[0];
    // The statewide frame — a span of degrees, not the tenth-of-a-degree box a
    // real fix gets.
    expect(region.span.latitudeDelta).toBeGreaterThan(1);
  });
});

// The pin popup and the browse JobCard describe the same job — literally so
// now: the map's callout renders the SAME `<JobCard>` component the feed
// does, fed through `mapJobToEnrichedJob` (owner: "its not a shared
// component its the same page the both use it"). These tests exercise that
// adapter + JobCard exactly as BrowseMap wires them, standing in for the
// detached-root render MapKit's callout delegate performs.
describe("BrowseMap pin popup — reuses JobCard via mapJobToEnrichedJob", () => {
  const renderPopup = (job: Record<string, unknown>, props: { effectiveFee?: number } = {}) =>
    render(
      <JobCard
        job={mapJobToEnrichedJob(job as unknown as MapJob)}
        effectiveFee={props.effectiveFee ?? 0}
        guestPricing={props.effectiveFee === undefined}
        onApply={vi.fn()}
        onReport={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

  /** JobPrice splits the "$" and the amount across sibling nodes, so a plain
   *  text match never finds either half — assert against the rendered
   *  container's full text content instead. */
  const hasText = (container: HTMLElement, text: string) =>
    container.textContent?.includes(text) ?? false;

  it("shows the category, city, date and start time the card shows", async () => {
    renderPopup(
      makeJob(1, {
        title: "Haul two loads to the dump",
        category: "moving",
        location: "Lake Charles, LA",
        date_needed: "2099-09-19",
        start_time: "08:30:00",
      }),
    );

    expect(await screen.findByText("Haul two loads to the dump")).toBeInTheDocument();
    expect(screen.getByText("Moving")).toBeInTheDocument();
    expect(screen.getByText("Lake Charles")).toBeInTheDocument();
    expect(screen.getByText(/Sep 19/)).toBeInTheDocument();
    expect(screen.getByText("8:30 AM")).toBeInTheDocument();
    // Tapping the reused card opens the job — no separate Apply button.
    expect(screen.getByRole("button", { name: /Haul two loads to the dump/ })).toBeInTheDocument();
  });

  it("prints the helper's NET take-home when a fee is supplied, like the card", async () => {
    const { container } = renderPopup(makeJob(1, { budget: 110 }), { effectiveFee: 12 });

    // $110 gross − 12% = $96.80, floored to $96 — exactly what JobPrice renders
    // in the feed for the same job.
    await waitFor(() => expect(hasText(container, "96")).toBe(true));
    expect(hasText(container, "110")).toBe(false);
  });

  it("falls back to the gross budget when no fee is supplied", async () => {
    const { container } = renderPopup(makeJob(1, { budget: 110 }));

    await waitFor(() => expect(hasText(container, "110")).toBe(true));
  });

  it("degrades to the parish when the RPC predates the card-fields migration", async () => {
    // The old nine-column row: the new keys are ABSENT, not null.
    renderPopup({
      id: "job-legacy",
      title: "Job legacy",
      category: "cleaning",
      budget: 50,
      is_urgent: false,
      latitude: 30.0,
      longitude: -91.0,
      parish: "Calcasieu",
      created_at: new Date().toISOString(),
    });

    expect(await screen.findByText(/Calcasieu/)).toBeInTheDocument();
  });

  it('renders "Flexible" when the job has no date or start time', async () => {
    renderPopup(makeJob(1, { date_needed: null, start_time: null }));

    expect(await screen.findByText("Flexible")).toBeInTheDocument();
  });

  it("shows the urgent bonus the card shows", async () => {
    renderPopup(makeJob(1, { is_urgent: true, urgent_fee: 12 }));

    expect(await screen.findByText("Urgent")).toBeInTheDocument();
  });
});

// B1/B3 + 2026-09-19: the map's viewer-local cull. Drop it and applied,
// dismissed and not-saved jobs pin the board again while the list hides them —
// "map shows 7 jobs. list shows 4."
// @mutate src/components/BrowseMap.tsx | return filtered.filter((j) => !isJobExcludedForViewer(j, exclusions)); | return filtered;
