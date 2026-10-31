/**
 * NIGHT-BUYINGrealma-3 (buying night audit, 10-31): the desktop Declutter map had no zoom buttons
 * (showsZoomControl: false). The desktop column (flush) shows MapKit's zoom control; the phone map does not.
 *
 * @mutate src/components/declutter/DeclutterMap.tsx |        showsZoomControl: flush, |        showsZoomControl: false,
 */
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const built: Record<string, unknown>[] = [];
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "ready" }));
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

describe("the Declutter map's zoom buttons", () => {
  it("show on the desktop column and not on the phone", async () => {
    mount(true);
    await waitFor(() => expect(built).toHaveLength(1));
    expect(built[0].showsZoomControl).toBe(true);
    mount(false);
    await waitFor(() => expect(built).toHaveLength(2));
    expect(built[1].showsZoomControl).toBe(false);
  });
});
