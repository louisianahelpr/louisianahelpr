/**
 * Q1733 (seen 2026-10-12 on prod in Playwright WebKit 390x844, poster-e2e,
 * nothing submitted): on an empty Start Time, tapping only an hour committed
 * it with an assumed AM, so a poster who tapped 3 and 30 got 3:30 AM without
 * ever choosing AM, and Post a Job moved on to the pay step.
 * Owner, 2026-10-14 (pop-up): MAKE THEM PICK. A start time is not accepted
 * until AM or PM is chosen; no silent AM.
 *
 * The class: an empty time wheel never commits a value whose period the
 * person did not choose. Every TimePickerWheel call site (Post a Job,
 * Edit Job, Availability hours via TimeRangeField) goes through this one
 * control, so the guard drives the control itself.
 *
 * @mutate src/components/TimePickerWheel.tsx | if (!hasValue && field !== "period") { | if (false) {
 * @mutate src/components/TimePickerWheel.tsx | {drafting && ( | {false && (
 */
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TimePickerWheel } from "@/components/TimePickerWheel";

function Harness({ initial = "" }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <TimePickerWheel value={v} onChange={setV} variant="wheels" />
      <output data-testid="v">{v}</output>
    </>
  );
}
const value = () => screen.getByTestId("v").textContent;
const tapRow = (name: "Hour" | "Minute", label: string) =>
  fireEvent.click(within(screen.getByRole("listbox", { name })).getByRole("option", { name: label }));
const tapPeriod = (p: "AM" | "PM") =>
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "AM or PM" })).getByRole("radio", { name: p }));

describe("an empty time is not set until AM or PM is chosen (Q1733)", () => {
  beforeAll(() => { Element.prototype.scrollTo = () => {}; });

  it("tapping 3 and 30 leaves the time empty and asks for AM or PM", () => {
    render(<Harness />);
    tapRow("Hour", "3");
    tapRow("Minute", "30");
    expect(value()).toBe("");
    expect(screen.getByTestId("time-pick-period").textContent).toBe("Pick AM or PM to set the time.");
    // Neither period shows as chosen.
    for (const p of ["AM", "PM"]) {
      expect(screen.getByRole("radio", { name: p }).getAttribute("aria-checked")).toBe("false");
    }
    // The tapped rows stay marked, so the person sees what they picked.
    expect(screen.getByRole("option", { name: "3" }).getAttribute("aria-selected")).toBe("true");
  });

  it("then PM sets 3:30 PM, and AM sets 3:30 AM", () => {
    render(<Harness />);
    tapRow("Hour", "3");
    tapRow("Minute", "30");
    tapPeriod("PM");
    expect(value()).toBe("15:30");
    expect(screen.queryByTestId("time-pick-period")).toBeNull();
    tapPeriod("AM");
    expect(value()).toBe("03:30");
  });

  it("a time already set keeps its period when the hour changes", () => {
    render(<Harness initial="15:30" />);
    tapRow("Hour", "4");
    expect(value()).toBe("16:30");
    expect(screen.queryByTestId("time-pick-period")).toBeNull();
  });

  it("every call site uses this one control (inventory)", () => {
    const sites = [
      "src/components/postjob/LogisticsSection.tsx",
      "src/components/TimeRangeField.tsx",
    ].filter((f) => /<TimePickerWheel\b/.test(readFileSync(join(process.cwd(), f), "utf8")));
    expect(sites.length).toBeGreaterThan(1);
  });
});
