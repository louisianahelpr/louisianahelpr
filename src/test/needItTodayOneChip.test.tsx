/**
 * Q2615 (Jobs audit 1102b row 29): pressing "Need it today" left BOTH "A set time" and "Need it today" filled, two
 * selected chips for what reads as one choice. Now one filled chip: while Need it today is on, neither "A set time" nor
 * "Flexible" reads selected, and tapping one of them leaves today for tomorrow (clearing the start Need it today set).
 * Renders the real LogisticsSection with the clock's start stubbed (as needItTodayStartIsForToday.test.tsx).
 *
 * @mutate src/components/postjob/LogisticsSection.tsx | <ChoicePill selected={!isToday && !isFlexibleSchedule && !weekWindow} | <ChoicePill selected={!isFlexibleSchedule && !weekWindow}
 * @mutate src/components/postjob/LogisticsSection.tsx |     setDateWindowEnd?.(null);\n    if (isToday && strip[1]) pickDay(strip[1].iso); |     setDateWindowEnd?.(null);\n    void 0;
 * @mutate src/components/postjob/GroupJobCard.tsx | onClick={() => setHelpersNeeded(String(Math.min(10, Math.max(2, crewCount + 1))))} | onClick={() => setHelpersNeeded(String(crewCount))}
 * @mutate src/components/postjob/GroupJobCard.tsx |           disabled={crewCount <= 2} |           disabled={false}
 *
 * Same row (Q2615 part 2): the Group box's Helpr count was a plain number field while the budget one step earlier uses
 * - / + steppers; it now has the same stepper around the field, inside the field's own 2..10.
 */
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const clock = vi.hoisted(() => ({ start: null as string | null }));
vi.mock("@/lib/sameDayJob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sameDayJob")>()),
  sameDayStartTime: () => clock.start,
}));
vi.mock("@/hooks/useMapKitJs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMapKitJs")>()),
  useMapKitJs: () => "missing-token" as const,
}));
vi.mock("@/components/postjob/CurrentLocationPill", () => ({ CurrentLocationPill: () => null }));
vi.mock("@/components/postjob/AppleMapPreview", () => ({ AppleMapPreview: () => null }));
vi.mock("@/components/postjob/CityAutocomplete", () => ({
  CityAutocomplete: (p: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="City" value={p.value} onChange={(e) => p.onChange(e.target.value)} />
  ),
}));

import { LogisticsSection } from "@/components/postjob/LogisticsSection";
import { todayYmd } from "@/lib/jobDate";

let seen: { dateNeeded?: string; startTime?: string } = {};
let flex = false;
let crew = "";
let groupStart = false;

function Host() {
  const [streetAddress, setStreetAddress] = useState("12 Bayou Rd");
  const [city, setCity] = useState("Delcambre");
  const [addrState, setAddrState] = useState("LA");
  const [zipCode, setZipCode] = useState("70528");
  const [dateNeeded, setDateNeeded] = useState("");
  const [startTime, setStartTime] = useState("");
  const [isFlexibleSchedule, setIsFlexibleSchedule] = useState(false);
  flex = isFlexibleSchedule;
  const [isRecurring, setIsRecurring] = useState(false);
  const [isGroupJob, setIsGroupJob] = useState(groupStart);
  const [helpersNeeded, setHelpersNeeded] = useState("2");
  crew = helpersNeeded;
  const [notes, setNotes] = useState("");
  seen = { dateNeeded, startTime };
  const noop = () => {};
  return (
    <LogisticsSection
      stepNumber={2}
      streetAddress={streetAddress} setStreetAddress={setStreetAddress}
      city={city} setCity={setCity}
      addrState={addrState} setAddrState={setAddrState}
      zipCode={zipCode} setZipCode={setZipCode}
      dateNeeded={dateNeeded} setDateNeeded={setDateNeeded}
      startTime={startTime} setStartTime={setStartTime}
      isFlexibleSchedule={isFlexibleSchedule} setIsFlexibleSchedule={setIsFlexibleSchedule}
      specialRequirements={notes} setSpecialRequirements={setNotes}
      isRecurring={isRecurring} setIsRecurring={setIsRecurring}
      recurrenceDays={[]} setRecurrenceDays={noop}
      recurrenceWeeks={4} setRecurrenceWeeks={noop}
      seriesSplitOk={false} setSeriesSplitOk={noop}
      isGroupJob={isGroupJob} setIsGroupJob={setIsGroupJob}
      helpersNeeded={helpersNeeded} setHelpersNeeded={setHelpersNeeded}
      budgetNum={60}
      logisticsComplete={false}
      category="painting"
      includeMaterials={false} setIncludeMaterials={noop}
      materialsNote="" setMaterialsNote={noop}
      savedAddress={null}
    />
  );
}

const needItToday = () => screen.getByRole("button", { name: /Need it today/ });

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
});
afterEach(() => {
  cleanup();
  clock.start = null;
  groupStart = false;
});

const whenPill = (name: string) => within(screen.getByRole("radiogroup", { name: "When" })).getByRole("radio", { name });

describe("Q2615: one filled chip for when", () => {
  it("Need it today on: only it reads selected; A set time and Flexible do not", () => {
    clock.start = "14:30";
    render(<Host />);
    expect(whenPill("A set time").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(needItToday());
    expect(needItToday().getAttribute("aria-pressed")).toBe("true");
    expect(whenPill("A set time").getAttribute("aria-checked")).toBe("false");
    expect(whenPill("Flexible").getAttribute("aria-checked")).toBe("false");
  });

  it("tapping A set time while today is on moves the job to tomorrow and clears today's start", () => {
    clock.start = "14:30";
    render(<Host />);
    fireEvent.click(needItToday());
    expect(seen).toEqual({ dateNeeded: todayYmd(), startTime: "14:30" });
    fireEvent.click(whenPill("A set time"));
    expect(seen.dateNeeded).not.toBe(todayYmd());
    expect(seen.dateNeeded! > todayYmd()).toBe(true);
    expect(seen.startTime).toBe("");
    expect(needItToday().getAttribute("aria-pressed")).toBe("false");
    expect(whenPill("A set time").getAttribute("aria-checked")).toBe("true");
  });

  it("tapping Flexible while today is on: Flexible, tomorrow", () => {
    clock.start = "14:30";
    render(<Host />);
    fireEvent.click(needItToday());
    fireEvent.click(whenPill("Flexible"));
    expect(flex).toBe(true);
    expect(seen.dateNeeded! > todayYmd()).toBe(true);
    expect(whenPill("Flexible").getAttribute("aria-checked")).toBe("true");
  });
});

describe("Q2615: the Group count uses the same stepper as the budget", () => {
  it("- / + move the count inside 2..10", () => {
    groupStart = true;
    render(<Host />);
    const fewer = screen.getByRole("button", { name: "One fewer Helpr" }) as HTMLButtonElement;
    const more = screen.getByRole("button", { name: "One more Helpr" }) as HTMLButtonElement;
    expect(fewer.disabled).toBe(true);
    fireEvent.click(more);
    fireEvent.click(more);
    expect(crew).toBe("4");
    expect(fewer.disabled).toBe(false);
    fireEvent.click(fewer);
    expect(crew).toBe("3");
    for (let i = 0; i < 12; i++) fireEvent.click(more);
    expect(crew).toBe("10");
    expect(more.disabled).toBe(true);
  });
});
