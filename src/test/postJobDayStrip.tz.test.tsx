/**
 * TZ SWEEP (board 45): Post a job's day strip starts on TODAY IN LOUISIANA and a
 * tap writes that Louisiana day to date_needed, whatever zone the device is in.
 * jobs.date_needed is a Louisiana calendar day (src/lib/jobDate.ts), so a
 * phone on UTC at 10:30 PM Central must still offer "today" as the 25th, not
 * the 26th it already is in UTC. Runs in the `tz-sweep` vitest project (forks
 * pool), where assigning process.env.TZ moves the runtime zone; checked below.
 *
 * @mutate src/components/postjob/LogisticsSection.tsx | const strip = dayStrip(todayYmd()); | const strip = dayStrip(todayLocalISO());
 * @mutate src/components/postjob/whenChoices.ts |     const at = new Date(Date.UTC(y, m - 1, d + i, 12)); |     const at = new Date(y, m - 1, d + i, 12);
 */
import { useState } from "react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/hooks/useMapKitJs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMapKitJs")>()),
  useMapKitJs: () => "missing-token" as const,
}));
vi.mock("@/components/postjob/CurrentLocationPill", () => ({ CurrentLocationPill: () => null }));
vi.mock("@/components/postjob/AppleMapPreview", () => ({ AppleMapPreview: () => null }));

import { LogisticsSection } from "@/components/postjob/LogisticsSection";

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let picked = "";
function Host() {
  const [dateNeeded, setDateNeeded] = useState("");
  picked = dateNeeded;
  const noop = () => {};
  return (
    <LogisticsSection
      stepNumber={2}
      streetAddress="" setStreetAddress={noop} city="" setCity={noop} addrState="LA" setAddrState={noop}
      zipCode="" setZipCode={noop}
      dateNeeded={dateNeeded} setDateNeeded={setDateNeeded}
      startTime="" setStartTime={noop}
      isFlexibleSchedule={false} setIsFlexibleSchedule={noop}
      specialRequirements="" setSpecialRequirements={noop}
      isRecurring={false} setIsRecurring={noop}
      recurrenceDays={[]} setRecurrenceDays={noop} recurrenceWeeks={4} setRecurrenceWeeks={noop}
      seriesSplitOk={false} setSeriesSplitOk={noop}
      isGroupJob={false} setIsGroupJob={noop} helpersNeeded="2" setHelpersNeeded={noop}
      budgetNum={60} logisticsComplete={false}
    />
  );
}

const ZONES = ["America/Chicago", "UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"];
// 2026-10-26T03:30Z is Sunday Oct 25, 10:30 PM in Louisiana (CDT): already the
// 26th in UTC and Tokyo. 2026-10-25T08:30Z is 3:30 AM on the 25th in
// Louisiana, still the 24th in Los Angeles.
// The 4th field: today is closed (past the last same-day start, 9:00 PM, F19),
// so today's card shows but cannot be picked.
const CASES: [string, string[], string, boolean][] = [
  ["2026-10-26T03:30:00Z", ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"], "Sun25", true],
  ["2026-10-25T08:30:00Z", ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"], "Sun25", false],
  // The day after DST ends in Louisiana (Nov 1 2026, 01:00 CST = 07:00Z).
  ["2026-11-01T07:00:00Z", ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"], "Sun1", false],
];

describe("Post a job's day strip is Louisiana's days in every device zone", () => {
  it("the zone switch is real", () => {
    process.env.TZ = "Asia/Tokyo";
    const tokyo = new Date("2026-10-26T00:00:00Z").getTimezoneOffset();
    process.env.TZ = "America/Chicago";
    const chicago = new Date("2026-10-26T00:00:00Z").getTimezoneOffset();
    expect(tokyo).not.toBe(chicago);
  });

  for (const tz of ZONES) {
    it(`device in ${tz}`, () => {
      process.env.TZ = tz;
      for (const [now, days, firstLabel, todayClosed] of CASES) {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(now));
        render(<Host />);
        const cards = within(screen.getByRole("radiogroup", { name: "Date needed" })).getAllByRole("radio");
        expect(cards[0].textContent, `${tz} @ ${now}`).toBe(firstLabel);
        expect((cards[0] as HTMLButtonElement).disabled, `${tz} @ ${now} today closed`).toBe(todayClosed);
        for (let i = todayClosed ? 1 : 0; i < days.length; i++) {
          fireEvent.click(cards[i]);
          expect(picked, `${tz} @ ${now} card ${i}`).toBe(days[i]);
        }
        cleanup();
        vi.useRealTimers();
      }
    });
  }
});
