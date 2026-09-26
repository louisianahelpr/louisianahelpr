import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ProfileBadge } from "./ProfileBadge";

/**
 * nightly-red #1582: on a mouse the pill opened on hover, then the click
 * that followed toggled it shut again, so press-every-control saw
 * "Neighborhood Pro — what this means" do nothing. A hover-then-click must
 * leave the explainer open; a second click still closes it, and touch
 * (no hover) still opens on the tap alone.
 *
 * @mutate src/pages/user/ProfileBadge.tsx | if (openedByHover.current && open) e.preventDefault(); | void 0;
 */
function setHover(canHover: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: canHover && /hover: hover/.test(q),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

function renderBadge() {
  render(<ProfileBadge label="Neighborhood Pro" icon={<svg />} description="Pro tier member." />);
  return screen.getByRole("button", { name: "Neighborhood Pro — what this means" });
}
const explainer = () => screen.queryByRole("dialog", { name: "Neighborhood Pro — what this means" });

afterEach(() => vi.unstubAllGlobals());

describe("ProfileBadge explainer", () => {
  it("mouse: hover then click leaves it open; a second click closes it", () => {
    setHover(true);
    const pill = renderBadge();
    fireEvent.pointerEnter(pill);
    expect(explainer()).not.toBeNull();
    fireEvent.click(pill);
    expect(explainer()).not.toBeNull();
    fireEvent.click(pill);
    expect(explainer()).toBeNull();
  });

  it("touch: the tap alone opens it", () => {
    setHover(false);
    const pill = renderBadge();
    fireEvent.pointerEnter(pill);
    expect(explainer()).toBeNull();
    fireEvent.click(pill);
    expect(explainer()).not.toBeNull();
  });
});
