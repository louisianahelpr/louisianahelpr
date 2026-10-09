/**
 * A screen-band panel with its own content measure stops at that measure
 * (owner, 2026-10-09: the Notifications band spanned a ~700px window while its
 * column stayed 512px, "a lot of white space on the sides"). Measured after:
 * 700px viewport -> panel 512 wide at left 94; 375/500 unchanged full width.
 */
import { describe, expect, it } from "vitest";
import { screenPanelContentProps } from "./anchoredPanel";

const band = (width: number) => ({ left: 0, top: 64, width, maxHeight: 600, desktop: false });

describe("screenPanelContentProps contentMaxWidth", () => {
  it("caps a wide band at the content measure and gives it side borders", () => {
    const p = screenPanelContentProps(band(700), { contentMaxWidth: 512 });
    expect(p.style.width).toBe(512);
    expect(p.align).toBe("center");
    expect(p.style.border).toBeTruthy();
  });

  it("leaves a phone-width band edge to edge", () => {
    const p = screenPanelContentProps(band(375), { contentMaxWidth: 512 });
    expect(p.style.width).toBe(375);
    expect(p.style.border).toBeUndefined();
  });

  it("is unchanged for panels that do not ask (Filters)", () => {
    expect(screenPanelContentProps(band(700)).style.width).toBe(700);
  });
});
