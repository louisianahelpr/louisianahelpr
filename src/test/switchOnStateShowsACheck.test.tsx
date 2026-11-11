/**
 * F484 (whole-app audit 11-10, W5, dark mode): on/off switches differed only by knob side and the track tint, so the
 * state was hard to read at a glance on the dark notification rows. The shared Switch now draws a check mark inside
 * the thumb that is visible only while the switch is on (group-data-[state=checked]), so on and off differ by a glyph
 * as well as by colour and knob side. Every toggle in the app comes from this one primitive
 * (goOnlineUsesSharedSwitch, accessibilityBiggerTextSharedSwitch), so one check covers them all.
 *
 * @mutate src/components/ui/switch.tsx | group-data-[state=checked]:opacity-100 | group-data-[state=unchecked]:opacity-100
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Switch } from "@/components/ui/switch";

function thumbOf(sw: HTMLElement): HTMLElement {
  const thumb = sw.querySelector<HTMLElement>("[data-state]");
  if (!thumb) throw new Error("Switch renders no thumb");
  return thumb;
}

describe("the shared switch shows a check mark while it is on (F484)", () => {
  it("draws a check glyph inside the thumb that only the on state reveals", () => {
    render(<Switch checked onCheckedChange={() => {}} aria-label="Job offers" />);
    const sw = screen.getByRole("switch");
    expect(sw.className.split(/\s+/)).toContain("group");
    const glyph = thumbOf(sw).querySelector("svg");
    expect(glyph).not.toBeNull();
    const classes = (glyph as SVGElement).getAttribute("class") ?? "";
    expect(classes).toContain("opacity-0");
    expect(classes).toContain("group-data-[state=checked]:opacity-100");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the glyph decorative: the switch's name and state come from the control itself", () => {
    render(<Switch checked={false} onCheckedChange={() => {}} aria-label="Job offers" />);
    const sw = screen.getByRole("switch", { name: "Job offers" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.textContent).toBe("");
  });
});
