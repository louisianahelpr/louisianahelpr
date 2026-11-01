/**
 * A2-C27 (app audit 2026-10-28, ~/.lh-shots/app-audit-1028/2-jobs/REPORT.md):
 * "Need it today" at 00:33 picked "Today, starting 3:00 AM", and picking
 * another day kept 3:00 AM silently (Review: "Sat, Oct 31 · 3:00 AM").
 *   - the start it fills is never before 8:00 AM (src/test/sameDayJobs.test.ts);
 *   - here: moving the job to another day clears a start that is still the one
 *     "Need it today" set, so the form asks for a start for that day; a start
 *     the poster picked themselves is kept (useSameDayPick.ts).
 * Renders the real LogisticsSection with the clock's start stubbed.
 *
 * @mutate src/components/postjob/useSameDayPick.ts |       if (setByToday.current !== null && startTime === setByToday.current) setStartTime(""); |       void startTime;
 * @mutate src/components/postjob/LogisticsSection.tsx | onClick={() => pickDay(d.iso)} | onClick={() => setDateNeeded(d.iso)}
 * @mutate src/components/postjob/useSameDayPick.ts |       if (iso === today) return; |       if (false) return;
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

function Host() {
  const [streetAddress, setStreetAddress] = useState("12 Bayou Rd");
  const [city, setCity] = useState("Delcambre");
  const [addrState, setAddrState] = useState("LA");
  const [zipCode, setZipCode] = useState("70528");
  const [dateNeeded, setDateNeeded] = useState("");
  const [startTime, setStartTime] = useState("");
  const [isFlexibleSchedule, setIsFlexibleSchedule] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [isGroupJob, setIsGroupJob] = useState(false);
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
      helpersNeeded="2" setHelpersNeeded={noop}
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
const stripCards = () => within(screen.getByRole("radiogroup", { name: /Date needed/ })).getAllByRole("radio");

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
});
afterEach(() => {
  cleanup();
  clock.start = null;
});

describe("A2-C27: Need it today's start is for today only", () => {
  it("another day clears the start Need it today set; going back to today keeps nothing stale", () => {
    clock.start = "14:30";
    render(<Host />);
    expect(stripCards().length).toBeGreaterThan(2);
    fireEvent.click(needItToday());
    expect(seen).toEqual({ dateNeeded: todayYmd(), startTime: "14:30" });
    fireEvent.click(stripCards()[2]);
    expect(seen.dateNeeded).not.toBe(todayYmd());
    expect(seen.startTime).toBe("");
  });

  it("a start the poster picked themselves is kept when the day changes", () => {
    // JA-44: today offers only starts from the earliest on, so the earliest is early enough to leave 9:00 AM.
    clock.start = "08:00";
    render(<Host />);
    fireEvent.click(needItToday());
    fireEvent.click(screen.getByRole("radio", { name: "9:00 AM" }));
    expect(seen.startTime).toBe("09:00");
    fireEvent.click(stripCards()[2]);
    expect(seen.startTime).toBe("09:00");
  });

  it("picking today itself keeps Need it today's start", () => {
    clock.start = "14:30";
    render(<Host />);
    fireEvent.click(needItToday());
    fireEvent.click(stripCards()[0]);
    expect(seen).toEqual({ dateNeeded: todayYmd(), startTime: "14:30" });
  });
});
