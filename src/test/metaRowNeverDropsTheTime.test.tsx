/**
 * Owner, 2026-10-08: "Location should never be hidden ... 1 day left should only
 * show if there is space for it, but location, date and time never hidden".
 * Live at 375 the posted card dropped "9:00 AM" to make room for "1 day left".
 *
 * The class: the time chip carries no hide rule at any width; when a phone
 * row is short of room it is the countdown that drops.
 *
 * @mutate src/components/job-card/JobCardMetaRow.tsx |       {timeLabel && (\n        <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap"> |       {timeLabel && (\n        <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap [@media(max-width:399px)]:hidden">
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobCardMetaRow } from "@/components/job-card/JobCardMetaRow";

describe("the meta row never hides the start time", () => {
  it("with a countdown on a city row, the time has no hide class and the countdown does", () => {
    render(<JobCardMetaRow dateNeeded="2032-10-14" startTime="09:00" location="Baton Rouge, LA" expiresAt="2099-01-01T00:00:00Z" />);
    const time = screen.getByText("9:00 AM").closest("span")!;
    expect(time.className).not.toMatch(/\]:hidden/);
    const left = screen.getByText(/left$/).closest("span[class*='shrink-']")!;
    expect(left.className).toMatch(/max-width:399px\)\]:hidden/);
  });
  it("with a full address (its own line), both the time and the countdown stay", () => {
    render(<JobCardMetaRow dateNeeded="2032-10-14" startTime="09:00" location="2200 Government St, Baton Rouge, LA 70806" expiresAt="2099-01-01T00:00:00Z" showFullAddress />);
    expect(screen.getByText("9:00 AM").closest("span")!.className).not.toMatch(/\]:hidden/);
    expect(screen.getByText(/left$/).closest("span[class*='shrink-']")!.className).not.toMatch(/\]:hidden/);
  });
});
