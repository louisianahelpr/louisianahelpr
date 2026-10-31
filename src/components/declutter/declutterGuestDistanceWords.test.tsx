/**
 * AUD31-75 (Guests on Declutter, Low): a guest's Filters said "Use your location, or add your ZIP code in your
 * profile, to see how far each item is." A guest has no profile. Their location is the one way to miles.
 *
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | zip, guest: !member }; | zip };
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx |   if (o.guest) return o.asked | if (false) return o.asked
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { declutterFilterSections } from "./DeclutterFilterPanel";
import type { OriginAsk } from "./DeclutterBrowseBar";
import { NO_FILTERS } from "@/lib/declutter/browseFilters";

const none = (over: Partial<OriginAsk> = {}): OriginAsk => ({
  origin: { status: "none", zipOnFile: false }, asked: false, asking: false, canAskAgain: false, deviceNote: null, askDevice: () => {}, ...over,
});
function distanceText(ask: OriginAsk): string {
  const sections = declutterFilterSections({
    filters: NO_FILTERS,
    onChange: () => {}, maxMiles: null, onMaxMiles: () => {}, ask, showDrops: false,
  });
  const distance = sections.find((s) => s.key === "distance");
  expect(distance).toBeDefined();
  const { container, unmount } = render(<>{distance!.content}</>);
  const text = container.textContent ?? "";
  unmount();
  return text;
}

describe("AUD31-75: a guest is never told to add a ZIP code to a profile", () => {
  it("a member without a position still gets the profile line; a guest gets the location line only", () => {
    expect(distanceText(none())).toMatch(/ZIP code in your profile/);
    for (const asked of [false, true]) {
      const t = distanceText(none({ guest: true, asked, canAskAgain: asked }));
      expect(t).not.toMatch(/profile|ZIP/i);
      expect(t).toMatch(/location/);
    }
  });

  it("Browse marks a signed-out visitor as a guest", () => {
    const src = readFileSync(resolve(__dirname, "DeclutterBrowseView.tsx"), "utf8");
    expect(src).toMatch(/const member = userId !== null;/);
    expect(src).toMatch(/const ask = \{[^}]*guest: !member \};/);
  });
});
