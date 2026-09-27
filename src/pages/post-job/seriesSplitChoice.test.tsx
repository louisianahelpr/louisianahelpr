/**
 * Q407 (4): the poster chooses at posting between "one Helpr for every visit"
 * and "OK to split the days", and a Helpr sees which one applies before
 * applying.
 *
 * @mutate src/pages/post-job/jobSubmitHelpers.ts |           ...(seriesSplitOk ? { series_split_ok: true } : {}), |           series_split_ok: seriesSplitOk,
 * @mutate src/components/postjob/RecurringSchedulePicker.tsx |           onChange={(next) => setSplitOk(next === "split")} |           onChange={() => setSplitOk(false)}
 * @mutate src/components/postjob/LogisticsSection.tsx |             splitOk={seriesSplitOk} |             splitOk={false}
 * @mutate src/components/series/SeriesTermsLine.tsx |       {split ? "Days can be split between Helprs" : "One Helpr for every visit"} |       {"One Helpr for every visit"}
 * @mutate src/components/dashboard/JobDetailDialog.tsx |                 <SeriesTermsLine | <span data-x
 * @mutate src/components/series/EndSeriesControl.tsx |         {mode === "leave" ? "Leave series" : "End series"} |         {"End series"}
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({}), rpc: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { buildJobInsertPayload, type BuildJobInsertPayloadInput } from "./jobSubmitHelpers";
import { RecurringSchedulePicker } from "@/components/postjob/RecurringSchedulePicker";
import { SeriesTermsLine } from "@/components/series/SeriesTermsLine";
import { EndSeriesControl } from "@/components/series/EndSeriesControl";

const base: BuildJobInsertPayloadInput = {
  userId: "u1", businessId: null, title: "Walk the dog", description: "Twice a week",
  category: "pet_care", streetAddress: "1 Main", city: "Houma", addrState: "LA",
  zipCode: "70360", parish: "Terrebonne",
  dateNeeded: "2026-09-07", startTime: "09:00", isFlexibleSchedule: false,
  estimatedHours: "1", budget: "30", specialRequirements: "",
  isRecurring: true, recurrenceInterval: "weekly", recurrenceEndDate: "",
  recurrenceDays: [1, 3], recurrenceWeeks: 4,
  isGroupJob: false, helpersNeeded: "2", isUrgent: false, urgentFee: "5",
  platformFee: 15, salesTaxRate: 0, offerToHelperId: null,
};

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("the split choice at posting", () => {
  it("writes series_split_ok = true when the poster splits", () => {
    const p = buildJobInsertPayload({ ...base, seriesSplitOk: true }) as Record<string, unknown>;
    expect(p.series_split_ok).toBe(true);
  });

  it("omits the key for one person (the column's default), so a post before db-deploy cannot fail on it", () => {
    const p = buildJobInsertPayload({ ...base, seriesSplitOk: false }) as Record<string, unknown>;
    expect("series_split_ok" in p).toBe(false);
    const once = buildJobInsertPayload({ ...base, isRecurring: false, seriesSplitOk: true }) as Record<string, unknown>;
    expect("series_split_ok" in once).toBe(false);
  });

  it("the picker offers both choices and reports the one picked", () => {
    const setSplitOk = vi.fn();
    render(
      <RecurringSchedulePicker
        days={[1]} setDays={vi.fn()} weeks={4} setWeeks={vi.fn()}
        startDate="2026-09-07" budget={30} splitOk={false} setSplitOk={setSplitOk}
      />,
    );
    expect(screen.getByText("One Helpr for every visit")).toBeTruthy();
    fireEvent.click(screen.getByText("OK to split the days"));
    expect(setSplitOk).toHaveBeenCalledWith(true);
  });

  it("the posting form passes the choice down to the picker and into the submit", () => {
    const logistics = readFileSync("src/components/postjob/LogisticsSection.tsx", "utf8");
    expect(logistics).toContain("splitOk={seriesSplitOk}");
    const form = readFileSync("src/pages/post-job/FormStep.tsx", "utf8");
    expect(form).toContain("seriesSplitOk={form.seriesSplitOk}");
    const submit = readFileSync("src/pages/post-job/useJobSubmit.ts", "utf8");
    expect(submit.match(/seriesSplitOk,/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("a Helpr sees the terms before applying", () => {
  it("names each choice", () => {
    wrap(<SeriesTermsLine jobId="j1" known />);
    expect(screen.getByText("Days can be split between Helprs")).toBeTruthy();
  });
  it("one person", () => {
    wrap(<SeriesTermsLine jobId="j1" known={false} />);
    expect(screen.getByText("One Helpr for every visit")).toBeTruthy();
  });
  it("the job detail shows it on a recurring listing", () => {
    const src = readFileSync("src/components/dashboard/JobDetailDialog.tsx", "utf8");
    expect(src).toMatch(/<SeriesTermsLine\s+jobId=\{job\.id\}/);
  });
});

describe("a Helpr's control LEAVES the series (owner decision 6)", () => {
  it("says Leave series, and the poster's says End series", () => {
    wrap(<EndSeriesControl jobId="j1" jobTitle="Walks" userId="u1" mode="leave" />);
    expect(screen.getByRole("button", { name: "Leave series" })).toBeTruthy();
    wrap(<EndSeriesControl jobId="j2" jobTitle="Walks" userId="u1" />);
    expect(screen.getByRole("button", { name: "End series" })).toBeTruthy();
  });
});
