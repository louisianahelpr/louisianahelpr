/**
 * Audit 2026-10-28 part 4, F19: on Post a job step 6, after the last same-day
 * start (sameDayStartTime() is null), "Need it today" was disabled but drawn
 * like an enabled pill (and drawn PRESSED, olive, once today was picked),
 * today was still offered in the day strip, and the only error naming the
 * problem was the submit button's "That start time has passed".
 *
 * Now, once today is closed: the button reads disabled and is never pressed,
 * today's strip card cannot be picked, a date that still holds today gets an
 * error on the date itself, and the submit label asks for a later start
 * instead of claiming the time has passed.
 *
 * @mutate src/components/postjob/LogisticsSection.tsx |                 disabled={closed} |                 disabled={false}
 * @mutate src/components/postjob/LogisticsSection.tsx |   const isToday = !isRecurring && dateNeeded === today && !todayClosed; |   const isToday = !isRecurring && dateNeeded === today;
 * @mutate src/components/postjob/LogisticsSection.tsx |                     ? "cursor-not-allowed border border-dashed border-border bg-transparent text-muted-foreground" |                     ? "border border-border bg-card text-foreground"
 * @mutate src/components/postjob/LogisticsSection.tsx |           {holdsClosedToday ? TODAY_CLOSED_COPY : undefined} |           {undefined}
 * @mutate src/pages/post-job/FormStep.tsx |     else submitLabel = t("postJob.pickLater"); |     else submitLabel = "That start time has passed";
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";

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
import { dayStrip, DAY_STRIP_LENGTH } from "@/components/postjob/whenChoices";
import { todayYmd } from "@/lib/jobDate";
import { SCHEDULE_TOO_SOON_COPY, TODAY_CLOSED_COPY } from "@/lib/jobScheduleCopy";

let seen: { dateNeeded?: string; startTime?: string } = {};

function Host(props: { date?: string; time?: string; scheduleInPast?: boolean }) {
  const [streetAddress, setStreetAddress] = useState("12 Bayou Rd");
  const [city, setCity] = useState("Delcambre");
  const [addrState, setAddrState] = useState("LA");
  const [zipCode, setZipCode] = useState("70528");
  const [dateNeeded, setDateNeeded] = useState(props.date ?? "");
  const [startTime, setStartTime] = useState(props.time ?? "");
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
      scheduleInPast={props.scheduleInPast}
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

const needItToday = () => screen.getByRole("button", { name: /Need it today/ }) as HTMLButtonElement;
const stripCards = () =>
  within(screen.getByRole("radiogroup", { name: /Date needed/ })).getAllByRole("radio") as HTMLButtonElement[];

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
});
afterEach(() => {
  cleanup();
  clock.start = null;
});

describe("F19: once today is closed, step 6 says so everywhere", () => {
  it("'Need it today' reads disabled (dashed, unfilled) and is never drawn pressed", () => {
    clock.start = null;
    render(<Host date={todayYmd()} time="20:00" />);
    const btn = needItToday();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.className).not.toContain("btn-grad-primary");
    expect(btn.className).toContain("bg-transparent");
    expect(btn.className).toContain("border-dashed");
  });

  it("today's strip card cannot be picked; tomorrow and later still can", () => {
    clock.start = null;
    render(<Host />);
    const cards = stripCards();
    expect(cards.length).toBe(DAY_STRIP_LENGTH);
    expect(cards.length).toBeGreaterThan(1);
    expect(cards[0].disabled).toBe(true);
    fireEvent.click(cards[0]);
    expect(seen.dateNeeded).toBe("");
    for (const c of cards.slice(1)) expect(c.disabled).toBe(false);
    fireEvent.click(cards[1]);
    expect(seen.dateNeeded).toBe(dayStrip(todayYmd())[1].iso);
  });

  it("a form still holding today gets the error on the date, not a start-time error", () => {
    clock.start = null;
    render(<Host date={todayYmd()} time="08:00" scheduleInPast />);
    const errs = screen.getAllByRole("alert").map((e) => e.textContent);
    expect(errs).toContain(TODAY_CLOSED_COPY);
    expect(errs).not.toContain(SCHEDULE_TOO_SOON_COPY);
    expect(screen.getByRole("radiogroup", { name: /Date needed/ }).getAttribute("aria-describedby")).toBe("date-closed-error");
  });

  it("while today is open nothing changes: the button works and today can be picked", () => {
    clock.start = "15:00";
    render(<Host />);
    const btn = needItToday();
    expect(btn.disabled).toBe(false);
    expect(stripCards()[0].disabled).toBe(false);
    fireEvent.click(btn);
    expect(seen.dateNeeded).toBe(todayYmd());
    expect(seen.startTime).toBe("15:00");
    expect(needItToday().getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(TODAY_CLOSED_COPY)).toBeNull();
  });

  it("the submit label asks for a later start; it no longer claims the time has passed", () => {
    const src = blankComments(readFileSync(join(__dirname, "../pages/post-job/FormStep.tsx"), "utf8"));
    expect(src).toContain('else submitLabel = "Pick a later start to continue";');
    expect(src).not.toContain("That start time has passed");
  });
});
