/**
 * Owner 2026-10-28: "update the day and time picker". The pickup times are chosen as day chips, then one
 * range for every chosen day or a range (or several) per day, from half-hour steps; the windows handed back
 * are the {weekday, starts, ends} rows declutter_set_pickup_windows takes (1-21, each ending after it starts).
 *
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx |   const setShared = (r: { starts: string; ends: string }) => setWindows((ws) => ws.map((w) => ({ ...w, starts: r.starts, ends: r.ends }))); |   const setShared = (r: { starts: string; ends: string }) => setWindows((ws) => ws.map((w, i) => (i === 0 ? { ...w, starts: r.starts, ends: r.ends } : w)));
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx |       if (ws.some((w) => w.weekday === d)) return ws.filter((w) => w.weekday !== d); |       if (ws.some((w) => w.weekday === d)) return ws;
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx |   if (windows.some((w) => w.ends <= w.starts)) return "Each pickup time must end after it starts."; |
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx |   const [perDay, setPerDay] = useState(() => !sameHoursEveryDay(windows)); |   const [perDay, setPerDay] = useState(() => false);
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { PickupWindow } from "@/lib/declutter/api";
import { PickupTimesEditor, TIME_STEPS, pickupWindowsProblem, sameHoursEveryDay, timeLabel } from "./DeclutterPickupTimes";

let latest: PickupWindow[] = [];
function Harness({ start }: { start: PickupWindow[] }) {
  const [ws, setWs] = useState(start);
  latest = ws;
  return <PickupTimesEditor windows={ws} setWindows={setWs} />;
}
const day = (name: string) => screen.getByRole("button", { name });

describe("the pickup times picker (owner 2026-10-28)", () => {
  it("half-hour steps 6 AM to 10 PM, labelled like a clock", () => {
    expect(TIME_STEPS[0]).toBe("06:00");
    expect(TIME_STEPS[TIME_STEPS.length - 1]).toBe("22:00");
    expect(TIME_STEPS).toHaveLength(33);
    expect(timeLabel("09:00")).toBe("9:00 AM");
    expect(timeLabel("12:30")).toBe("12:30 PM");
    expect(timeLabel("17:00")).toBe("5:00 PM");
  });

  it("days are chips; one range applies to every chosen day", () => {
    render(<Harness start={[{ weekday: 6, starts: "09:00", ends: "12:00" }]} />);
    expect(day("Saturday")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: "Same hours every day" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(day("Sunday"));
    fireEvent.click(day("Wednesday"));
    expect(latest.map((w) => w.weekday)).toEqual([0, 3, 6]);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "14:30" } });
    expect(latest).toEqual([0, 3, 6].map((weekday) => ({ weekday, starts: "10:00", ends: "14:30" })));
    // Tapping a chosen day takes it off.
    fireEvent.click(day("Wednesday"));
    expect(latest.map((w) => w.weekday)).toEqual([0, 6]);
    expect(pickupWindowsProblem(latest)).toBeNull();
  });

  it("different hours each day, with more than one time a day, and a time removed", () => {
    render(<Harness start={[{ weekday: 1, starts: "09:00", ends: "12:00" }, { weekday: 3, starts: "09:00", ends: "12:00" }]} />);
    fireEvent.click(screen.getByRole("radio", { name: "Different each day" }));
    const wed = screen.getByText("Wednesday").closest("li")!;
    fireEvent.click(within(wed).getByRole("button", { name: /Add another time on Wednesday/ }));
    expect(latest).toEqual([
      { weekday: 1, starts: "09:00", ends: "12:00" },
      { weekday: 3, starts: "09:00", ends: "12:00" },
      { weekday: 3, starts: "17:00", ends: "19:00" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Monday 9:00 AM to 12:00 PM" }));
    expect(latest.map((w) => w.weekday)).toEqual([3, 3]);
    // Back to one range: one window per day, the first one's hours.
    fireEvent.click(screen.getByRole("radio", { name: "Same hours every day" }));
    expect(latest).toEqual([{ weekday: 3, starts: "09:00", ends: "12:00" }]);
  });

  it("saved windows that differ open in 'Different each day', and an end before a start is said", () => {
    render(<Harness start={[{ weekday: 2, starts: "09:00", ends: "12:00" }, { weekday: 4, starts: "18:00", ends: "17:00" }]} />);
    expect(screen.getByRole("radio", { name: "Different each day" })).toHaveAttribute("aria-checked", "true");
    expect(document.querySelectorAll("[data-window-problem]")).toHaveLength(1);
    expect(pickupWindowsProblem(latest)).toMatch(/end after it starts/);
    expect(sameHoursEveryDay(latest)).toBe(false);
  });

  it("no day chosen says so, and the server's 1-21 rule is mirrored", () => {
    render(<Harness start={[{ weekday: 5, starts: "09:00", ends: "12:00" }]} />);
    fireEvent.click(day("Friday"));
    expect(latest).toEqual([]);
    expect(document.querySelector("[data-no-days]")).not.toBeNull();
    expect(pickupWindowsProblem([])).toMatch(/at least one day/);
    const many = Array.from({ length: 22 }, (_, i) => ({ weekday: i % 7, starts: "09:00", ends: "10:00" }));
    expect(pickupWindowsProblem(many)).toMatch(/at most 21/);
  });
});
