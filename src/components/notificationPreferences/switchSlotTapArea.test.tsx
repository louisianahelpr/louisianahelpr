/**
 * Audit 11-10 F476: every on/off switch on Settings > Notifications is 51x31px, under the 44px tap guide, and
 * ~50 of them sit in tight rows, so a thumb can hit the wrong one. The pill stays 31px; its TAP area is the
 * switch plus a 7px band above and below (a pseudo-element on the button, so a press there toggles it), and the
 * slot is 44px tall so rows cannot pack switches closer than that.
 *
 * @mutate src/components/notificationPreferences/SwitchSlot.tsx | <Switch className={SWITCH_TAP_AREA_CLASS} checked={checked} | <Switch checked={checked}
 * @mutate src/components/notificationPreferences/SwitchSlot.tsx | <div className="w-[51px] min-h-11 flex items-center justify-center relative" title={title}> | <div className="w-[51px] flex justify-center relative" title={title}>
 * @mutate src/components/notificationPreferences/SwitchSlot.tsx | before:-inset-y-[7px] | before:-inset-y-[2px]
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SwitchSlot, SWITCH_TAP_AREA_CLASS } from "./SwitchSlot";

describe("each notification switch has a 44px tap area (F476)", () => {
  it("the switch carries a tap band of at least 6.5px above and below its 31px pill", () => {
    const band = /before:-inset-y-\[(\d+(?:\.\d+)?)px\]/.exec(SWITCH_TAP_AREA_CLASS);
    expect(band).not.toBeNull();
    expect(31 + 2 * Number(band![1])).toBeGreaterThanOrEqual(44);
    expect(SWITCH_TAP_AREA_CLASS).toMatch(/\brelative\b/);
    expect(SWITCH_TAP_AREA_CLASS).toMatch(/before:absolute/);
    expect(SWITCH_TAP_AREA_CLASS).toMatch(/before:inset-x-0/);
    expect(SWITCH_TAP_AREA_CLASS).toMatch(/before:content-\[''\]/);
  });

  it("a rendered switch wears the band and sits in a 44px-tall slot", () => {
    render(
      <SwitchSlot loaded savingKey={null} checked onCheckedChange={() => {}} disabled={false} ariaLabel="Messages app alerts" savingId="messages" />,
    );
    const sw = screen.getByRole("switch", { name: "Messages app alerts" });
    for (const cls of SWITCH_TAP_AREA_CLASS.split(" ")) expect(sw.className.split(" ")).toContain(cls);
    expect(sw.parentElement?.className).toMatch(/\bmin-h-11\b/);
    expect(sw.parentElement?.className).toMatch(/\bitems-center\b/);
  });
});
