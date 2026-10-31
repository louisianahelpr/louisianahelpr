/**
 * Board 45 (Post a job, screen 6 of 7, "When and where?"): the old calendar,
 * address search and time wheel became the board's controls, on the SAME
 * form fields and the same jobs columns.
 *
 *   WHEN   "A set time" / "Flexible" chips  -> isFlexibleSchedule (jobs.is_flexible_schedule)
 *          a day strip of the next days      -> dateNeeded (jobs.date_needed), Louisiana days
 *          "More dates"                      -> the existing inline calendar, same field
 *          time chips + "Other time"         -> startTime (jobs.start_time); Other opens the existing wheel
 *   WHERE  saved address / "Somewhere else"  -> streetAddress, city, addrState, zipCode
 *
 * The board's third chip, "Any time this week", is NOT built: jobs.date_needed
 * is one NOT NULL day and nothing else on the row can say "any day this week",
 * so storing it would print one specific day on every card (LogisticsSection's
 * WHEN comment has the evidence). Owner rule for that case: leave it out.
 *
 * The Louisiana-day half of the strip is proven in every device zone by
 * postJobDayStrip.tz.test.tsx.
 *
 * @mutate src/components/postjob/LogisticsSection.tsx | onClick={() => setIsFlexibleSchedule(true)} | onClick={() => setIsFlexibleSchedule(false)}
 * @mutate src/components/postjob/LogisticsSection.tsx | onClick={() => pickTime(t.value)} | onClick={() => pickTime("")}
 * @mutate src/components/postjob/LogisticsSection.tsx | onClick={() => pickDay(d.iso)} | onClick={() => pickDay(strip[0].iso)}
 * @mutate src/components/postjob/LogisticsSection.tsx |     if (!streetAddress.trim() && !zipCode.trim()) {\n      applySaved(savedAddress); |     if (!streetAddress.trim() && !zipCode.trim()) {\n      void 0;
 * @mutate src/components/postjob/LogisticsSection.tsx |     if (!streetAddress.trim() && !zipCode.trim()) { |     if (true) {
 * @mutate src/components/postjob/LogisticsSection.tsx |       setStreetAddress("");\n      setZipCode(""); |       void 0;
 * @mutate src/pages/post-job/useSavedJobAddress.ts |     if (!f.streetAddress.trim() \|\| !f.city?.trim() \|\| !f.zipCode?.trim()) continue; |     if (!f.city?.trim()) continue;
 * @mutate src/pages/post-job/useSavedJobAddress.ts |     if ((f.addrState ?? "").toUpperCase() !== "LA") continue; |
 * @mutate src/pages/post-job/FormStep.tsx |             savedAddress={form.savedAddress} |             savedAddress={null}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";

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
import { dayStrip, DAY_STRIP_LENGTH, TIME_CHIPS } from "@/components/postjob/whenChoices";
import { savedAddressFrom, type SavedAddress } from "@/pages/post-job/useSavedJobAddress";
import { todayYmd } from "@/lib/jobDate";
import { SCHEDULE_TOO_SOON_COPY } from "@/lib/jobScheduleCopy";

const REPO = join(__dirname, "../..");
const read = (p: string) => blankComments(readFileSync(join(REPO, p), "utf8"));

const HOME: SavedAddress = { streetAddress: "12 Bayou Rd", city: "Delcambre", addrState: "LA", zipCode: "70528" };

let seen: Record<string, unknown> = {};

function Host(props: {
  saved?: SavedAddress | null;
  start?: Partial<{ street: string; city: string; zip: string; date: string; time: string; flexible: boolean; recurring: boolean }>;
  scheduleInPast?: boolean;
}) {
  const s = props.start ?? {};
  const [streetAddress, setStreetAddress] = useState(s.street ?? "");
  const [city, setCity] = useState(s.city ?? "");
  const [addrState, setAddrState] = useState("LA");
  const [zipCode, setZipCode] = useState(s.zip ?? "");
  const [dateNeeded, setDateNeeded] = useState(s.date ?? "");
  const [startTime, setStartTime] = useState(s.time ?? "");
  const [isFlexibleSchedule, setIsFlexibleSchedule] = useState(s.flexible ?? false);
  const [isRecurring, setIsRecurring] = useState(s.recurring ?? false);
  const [isGroupJob, setIsGroupJob] = useState(false);
  const [notes, setNotes] = useState("");
  seen = { streetAddress, city, addrState, zipCode, dateNeeded, startTime, isFlexibleSchedule, isRecurring };
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
      savedAddress={props.saved}
    />
  );
}

const radio = (group: string, name: string | RegExp) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name });
const checked = (el: HTMLElement) => el.getAttribute("aria-checked") === "true";

beforeAll(() => {
  // TimePickerWheel scrolls its columns on mount; jsdom has no scrolling.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
});
afterEach(cleanup);

describe("board 45 WHEN: the chips write the existing schedule fields", () => {
  it("'A set time' and 'Flexible' write isFlexibleSchedule; there is no chip the columns cannot store", () => {
    render(<Host />);
    const group = screen.getByRole("radiogroup", { name: "When" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["A set time", "Flexible"]);
    expect(checked(radio("When", "A set time"))).toBe(true);
    fireEvent.click(radio("When", "Flexible"));
    expect(seen.isFlexibleSchedule).toBe(true);
    expect(checked(radio("When", "Flexible"))).toBe(true);
    fireEvent.click(radio("When", "A set time"));
    expect(seen.isFlexibleSchedule).toBe(false);
  });

  it("a time chip writes its 24-hour start_time; 'Other time' opens the existing wheel without picking", () => {
    render(<Host />);
    expect(TIME_CHIPS.length).toBeGreaterThanOrEqual(4);
    for (const t of TIME_CHIPS) {
      fireEvent.click(radio("Start time", t.label));
      expect(seen.startTime).toBe(t.value);
      expect(checked(radio("Start time", t.label))).toBe(true);
    }
    expect(TIME_CHIPS.map((t) => t.value)).toEqual(["08:00", "09:00", "10:00", "13:00"]);
    expect(screen.queryByRole("listbox", { name: "Hour" })).toBeNull();
    fireEvent.click(radio("Start time", "Other time"));
    expect(screen.getByRole("listbox", { name: "Hour" })).toBeTruthy();
    expect(seen.startTime).toBe("13:00");
  });

  it("a stored time no chip names shows as 'Other time' with the wheel open", () => {
    render(<Host start={{ time: "15:30" }} />);
    expect(checked(radio("Start time", "Other time"))).toBe(true);
    expect(screen.getByRole("listbox", { name: "Hour" })).toBeTruthy();
  });

  it("Flexible keeps the start time optional: 'No set time' clears it, a chip still sets one", () => {
    render(<Host start={{ time: "09:00" }} />);
    expect(screen.queryByRole("radio", { name: "No set time" })).toBeNull();
    fireEvent.click(radio("When", "Flexible"));
    expect(seen.startTime).toBe("09:00");
    fireEvent.click(radio("Start time", "No set time"));
    expect(seen.startTime).toBe("");
    expect(checked(radio("Start time", "No set time"))).toBe(true);
    fireEvent.click(radio("Start time", "10:00 AM"));
    expect(seen.startTime).toBe("10:00");
  });

  it("the day strip offers the next Louisiana days and a tap writes that day", () => {
    render(<Host />);
    const strip = dayStrip(todayYmd());
    expect(strip).toHaveLength(DAY_STRIP_LENGTH);
    const cards = within(screen.getByRole("radiogroup", { name: "Date needed" })).getAllByRole("radio");
    expect(cards).toHaveLength(DAY_STRIP_LENGTH);
    fireEvent.click(cards[2]);
    expect(seen.dateNeeded).toBe(strip[2].iso);
    expect(checked(cards[2])).toBe(true);
    expect(cards[2].textContent).toBe(`${strip[2].weekday}${strip[2].day}`);
  });

  it("'More dates' opens the existing inline calendar on the same field; a later date keeps it open", () => {
    render(<Host />);
    expect(screen.queryByRole("group", { name: "Date needed" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More dates" }));
    expect(screen.getByRole("group", { name: "Date needed" })).toBeTruthy();
    cleanup();
    const later = dayStrip(todayYmd(), 20)[19].iso;
    render(<Host start={{ date: later }} />);
    expect(screen.getByRole("group", { name: "Date needed" })).toBeTruthy();
    const cards = within(screen.getByRole("radiogroup", { name: "Date needed" })).getAllByRole("radio");
    expect(cards.filter(checked)).toHaveLength(0);
  });

  it("dayStrip counts real calendar days across a month end and a DST change", () => {
    expect(dayStrip("2026-10-30", 5).map((d) => d.iso)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(dayStrip("2026-10-30", 3).map((d) => d.weekday)).toEqual(["Fri", "Sat", "Sun"]);
    expect(dayStrip("2026-12-31", 2).map((d) => [d.iso, d.day])).toEqual([["2026-12-31", 31], ["2027-01-01", 1]]);
  });
});

describe("board 45 WHERE: the saved address radio fills the address fields", () => {
  it("with a saved address and an empty form, it is chosen and fills all four fields", () => {
    render(<Host saved={HOME} />);
    expect(seen).toMatchObject({ streetAddress: "12 Bayou Rd", city: "Delcambre", addrState: "LA", zipCode: "70528" });
    expect(checked(radio("Where", /12 Bayou Rd/))).toBe(true);
    expect(screen.queryByLabelText("Street address")).toBeNull();
  });

  it("'Somewhere else' clears the saved address and opens the address entry; the saved radio refills it", () => {
    render(<Host saved={HOME} />);
    fireEvent.click(radio("Where", /Somewhere else/));
    expect(seen).toMatchObject({ streetAddress: "", zipCode: "" });
    expect(checked(radio("Where", /Somewhere else/))).toBe(true);
    expect(screen.getByLabelText("Street address")).toBeTruthy();
    fireEvent.click(radio("Where", /12 Bayou Rd/));
    expect(seen).toMatchObject({ streetAddress: "12 Bayou Rd", city: "Delcambre", zipCode: "70528" });
  });

  it("never overwrites an address the form already holds (draft, rebook)", () => {
    render(<Host saved={HOME} start={{ street: "9 Oak St", city: "Houma", zip: "70360" }} />);
    expect(seen).toMatchObject({ streetAddress: "9 Oak St", city: "Houma", zipCode: "70360" });
    expect(checked(radio("Where", /Somewhere else/))).toBe(true);
  });

  it("with no saved address there is no radio, only the address entry", () => {
    render(<Host saved={null} />);
    expect(screen.queryByRole("radiogroup", { name: "Where" })).toBeNull();
    expect(screen.getByLabelText("Street address")).toBeTruthy();
  });

  it("the privacy line names the town only, never the street", () => {
    render(<Host saved={HOME} />);
    const line = screen.getByText(/and the distance\./).closest("p");
    expect(line?.textContent).toBe("Helprs see Delcambre and the distance. The street address is sent only to the Helpr you offer the job to.");
    expect(line?.textContent).not.toContain("Bayou");
  });

  it("savedAddressFrom takes the newest full Louisiana address and skips the rest", () => {
    expect(savedAddressFrom([null, "Delcambre, LA", "1 Elm St, Austin, TX 78701", "12 Bayou Rd, Delcambre, LA 70528", "5 Old Rd, Houma, LA 70360"]))
      .toEqual(HOME);
    expect(savedAddressFrom(["Baton Rouge, LA 70801", "", null])).toBeNull();
    expect(savedAddressFrom([])).toBeNull();
  });
});

describe("board 45 keeps everything the screen already did", () => {
  it("job type (One-time / Repeats / Group), Repeats' picker, the past-time error, notes and materials still render", () => {
    render(<Host start={{ recurring: true }} scheduleInPast />);
    const jobType = screen.getByRole("radiogroup", { name: "Job type" });
    expect(within(jobType).getByRole("radio", { name: "One-time" })).toBeTruthy();
    expect(within(jobType).getByRole("radio", { name: "Repeats" })).toBeTruthy();
    expect(screen.getByText("One Helpr for every visit")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Start date" })).toBeTruthy();
    expect(screen.getByText(SCHEDULE_TOO_SOON_COPY)).toBeTruthy();
    expect(screen.getByLabelText("Access & parking notes")).toBeTruthy();
    expect(screen.getByText("I'll provide materials")).toBeTruthy();
  });

  it("FormStep hands LogisticsSection every prop it declares, from the form (inventory from source)", () => {
    const logistics = read("src/components/postjob/LogisticsSection.tsx");
    const iface = logistics.slice(logistics.indexOf("interface LogisticsSectionProps"), logistics.indexOf("\n}", logistics.indexOf("interface LogisticsSectionProps")));
    const props = [...iface.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(props.length).toBeGreaterThan(39); // 41 on 2026-10-27
    const form = read("src/pages/post-job/FormStep.tsx");
    const call = form.slice(form.indexOf("<LogisticsSection"), form.indexOf("/>", form.indexOf("<LogisticsSection")));
    // A prop counts only when it comes FROM the form (`x={form.y}`): `savedAddress={null}`
    // passes a prop and still turns the WHERE radio off for everyone.
    const fromForm = new Set([...call.matchAll(/\b(\w+)=\{form\.\w+\}/g)].map((m) => m[1]));
    // stepNumber is the one literal: the section's own number on this screen.
    expect(props.filter((p) => p !== "stepNumber" && !fromForm.has(p))).toEqual([]);
    expect(call).toMatch(/\bstepNumber=\{\d+\}/);
  });
});
