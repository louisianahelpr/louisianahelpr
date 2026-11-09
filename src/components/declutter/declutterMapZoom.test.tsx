/**
 * NIGHT-BUYINGrealma-3 (buying night audit, 10-31): the desktop Declutter map had no zoom buttons
 * (showsZoomControl: false). The desktop column (flush) shows MapKit's zoom control; the phone map does not.
 *
 * @mutate src/components/declutter/DeclutterMap.tsx |        showsZoomControl: flush, |        showsZoomControl: false,
 * @mutate src/components/declutter/DeclutterMap.tsx |           <p className="text-ds-13 font-medium text-muted-foreground">Loading map…</p>\n |
 */
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const built: Record<string, unknown>[] = [];
const kit = vi.hoisted(() => ({ status: "ready" }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => kit.status }));
vi.mock("@/components/browseMap/useMapLayersSync", () => ({ useMapFollowsTheme: () => {} }));
vi.mock("@/components/browseMap/MapLayers", () => ({ laRegion: () => ({}), fitToPins: () => {} }));
vi.mock("@/components/browseMap/mapkitRuntime", () => ({
  colorSchemeFor: () => "light",
  regionFromBounds: () => ({}),
  getMapKit: () => ({
    Map: class {
      annotations = [];
      addAnnotations = () => {};
      removeAnnotations = () => {};
      addEventListener = () => {};
      removeEventListener = () => {};
      destroy = () => {};
      constructor(_el: HTMLElement, options: Record<string, unknown>) {
        built.push(options);
      }
    },
    FeatureVisibility: { Hidden: "hidden" },
  }),
}));

import DeclutterMap from "./DeclutterMap";

const mount = (flush: boolean) =>
  render(
    <MemoryRouter>
      <DeclutterMap rows={[]} pins={new Map()} pinsLoading={false} pinsError={false} onRetry={() => {}} cover={new Map()} approximate={false} flush={flush} />
    </MemoryRouter>,
  );

// F122 (UI audit 11-09): before the map is up, a soft solid panel says "Loading map…" (not a half-clear veil over
// MapKit's empty grid); once it is up the panel is gone.
describe("the Declutter map while it loads", () => {
  it("says Loading map… until the map is built", async () => {
    kit.status = "loading";
    const first = mount(true);
    expect(first.getByRole("status").textContent).toContain("Loading map…");
    first.unmount();
    kit.status = "ready";
    const ready = mount(true);
    await waitFor(() => expect(ready.queryByText("Loading map…")).toBeNull());
    ready.unmount();
    built.length = 0;
  });
});

describe("the Declutter map's zoom buttons", () => {
  it("show on the desktop column and not on the phone", async () => {
    kit.status = "ready";
    built.length = 0;
    mount(true);
    await waitFor(() => expect(built).toHaveLength(1));
    expect(built[0].showsZoomControl).toBe(true);
    mount(false);
    await waitFor(() => expect(built).toHaveLength(2));
    expect(built[1].showsZoomControl).toBe(false);
  });
});
