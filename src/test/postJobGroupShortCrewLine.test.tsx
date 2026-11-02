/**
 * A3-60 (Auditor 3, 11-01): posting a group job never said what happens when not every spot fills, and "~" sat in front
 * of an exact minimum share. The server's rule: every Helpr on the roster is paid their share
 * (process-scheduled-payouts), and the unfilled shares go back to the poster at payout (refundUnfilledCrewShares,
 * crew_completes_when_hired_done). The Group job block now says so, and the share reads "at least $X per Helpr"
 * (crewSmallestShare is the smallest share, so no Helpr gets less).
 *
 * @mutate src/components/postjob/LogisticsSection.tsx | will be split: at least ${formatPriceExact( | will be split: ~${formatPriceExact(
 * @mutate src/components/postjob/LogisticsSection.tsx |               If fewer Helprs sign up, the ones hired still do the job, and you get the unfilled shares back when they're paid. |               More Helprs, more help.
 */
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/hooks/useMapKitJs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMapKitJs")>()),
  useMapKitJs: () => "missing-token" as const,
}));
vi.mock("@/components/postjob/CurrentLocationPill", () => ({ CurrentLocationPill: () => null }));
vi.mock("@/components/postjob/AppleMapPreview", () => ({ AppleMapPreview: () => null }));
vi.mock("@/components/postjob/CityAutocomplete", () => ({ CityAutocomplete: () => null }));

import { LogisticsSection } from "@/components/postjob/LogisticsSection";
import { GROUP_JOBS_ENABLED } from "@/lib/groupJobs";

function Host() {
  const [isGroupJob, setIsGroupJob] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const noop = () => {};
  return (
    <LogisticsSection
      stepNumber={2}
      streetAddress="" setStreetAddress={noop} city="" setCity={noop} addrState="LA" setAddrState={noop}
      zipCode="" setZipCode={noop} dateNeeded="" setDateNeeded={noop} startTime="" setStartTime={noop}
      isFlexibleSchedule={false} setIsFlexibleSchedule={noop} specialRequirements="" setSpecialRequirements={noop}
      isRecurring={isRecurring} setIsRecurring={setIsRecurring} recurrenceDays={[]} setRecurrenceDays={noop}
      recurrenceWeeks={4} setRecurrenceWeeks={noop} seriesSplitOk={false} setSeriesSplitOk={noop}
      isGroupJob={isGroupJob} setIsGroupJob={setIsGroupJob} helpersNeeded="3" setHelpersNeeded={noop}
      budgetNum={100} logisticsComplete={false} category="moving"
      includeMaterials={false} setIncludeMaterials={noop} materialsNote="" setMaterialsNote={noop}
    />
  );
}

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
});
afterEach(cleanup);

describe("Post a job, Group job: the split and what a short crew means (A3-60)", () => {
  it("names the smallest share without '~' and says the hired Helprs still come and the unfilled shares come back", () => {
    expect(GROUP_JOBS_ENABLED).toBe(true);
    render(<Host />);
    expect(document.querySelector("[data-crew-short]")).toBeNull();
    const group = screen.getAllByRole("radio").find((r) => r.textContent === "Group");
    expect(group).toBeTruthy();
    fireEvent.click(group!);
    // $100 over 3: shares 33.34 / 33.33 / 33.33, so the smallest is $33.33.
    const split = [...document.querySelectorAll("p")].find((el) => /will be split/.test(el.textContent ?? ""));
    expect(split?.textContent?.replace(/\s+/g, " ").trim()).toBe("Budget of $100 will be split: at least $33.33 per Helpr.");
    expect(document.body.textContent).not.toMatch(/~\$/);
    const short = document.querySelector("[data-crew-short]");
    expect(short?.textContent).toBe("If fewer Helprs sign up, the ones hired still do the job, and you get the unfilled shares back when they're paid.");
    expect(within(short!.parentElement as HTMLElement).getByText("Group job")).toBeTruthy();
  });
});
