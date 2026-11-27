/**
 * Polish audit 11-27 #3 (HIGH; owner 11-27: "location category time day" hard to tell apart, keep them ALL ON ONE LINE).
 * The Working and Posted cards' one-line meta (JobCardMetaRow oneLine) ran "2000 Johnston St  Mon, Nov 9  3:00 PM" with
 * only spaces between the parts. It now wears the Browse row's look (JobCard, PR #5026): a pin, a calendar and a clock
 * tell the parts apart; each part is one unbreakable chunk; a phone says "Mon 11/9" and "3 PM" so the street keeps its
 * width. "Flexible" is one word everywhere (the signed-in row's tag said "Flexible time").
 *
 * @mutate src/components/job-card/JobCardMetaRow.tsx |         <Calendar className="w-3 h-3 shrink-0" />\n        {oneLine ? ( |         {!oneLine && <Calendar className="w-3 h-3 shrink-0" />}\n        {oneLine ? (
 * @mutate src/components/job-card/JobCardMetaRow.tsx |           <Clock className="w-3 h-3 shrink-0" /> |           {!oneLine && <Clock className="w-3 h-3 shrink-0" />}
 * @mutate src/components/job-card/JobCardMetaRow.tsx |             <span className="sm:hidden">{jobDayLabelShort( |             <span className="sm:hidden">{jobDayLabel(
 * @mutate src/components/dashboard/JobCardMedia.tsx | text-muted-foreground">Flexible</span> | text-muted-foreground">Flexible time</span>
 * @mutate src/components/job/JobMetaLine.tsx |   const CHUNK = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap"; |   const CHUNK = "inline-flex items-center gap-1";
 * @mutate src/components/job/JobMetaLine.tsx | <Clock className={ICON} aria-hidden />{time} | {time}
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx |                   <JobMetaLine className="text-ds-13 | <span className="text-ds-13
 * @mutate src/components/profile/schedule/ScheduleCard.tsx |               <JobMetaLine className="text-ds-11 | <span className="text-ds-11
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { JobCardMetaRow } from "@/components/job-card/JobCardMetaRow";
import { JobMetaLine, shortTime } from "@/components/job/JobMetaLine";
import { blankComments } from "./helpers/blankNonCode";

function row(oneLine: boolean) {
  return render(
    <MemoryRouter>
      <JobCardMetaRow dateNeeded="2037-11-09" startTime="15:00" location="2000 Johnston St, Lafayette, LA 70503" showFullAddress oneLine={oneLine} locationPressToMap />
    </MemoryRouter>,
  ).container;
}

describe("the cards' one-line meta tells place, day and time apart (polish 11-27 #3)", () => {
  it("one line: pin, calendar and clock, each part one nowrap chunk, short day and \"3 PM\"", () => {
    const c = row(true);
    const day = c.querySelector("[data-meta-day]") as HTMLElement;
    const time = c.querySelector("[data-meta-time]") as HTMLElement;
    expect(day).not.toBeNull();
    expect(time).not.toBeNull();
    expect(day.querySelector("svg"), "no calendar before the day").not.toBeNull();
    expect(time.querySelector("svg"), "no clock before the time").not.toBeNull();
    expect(day.className).toContain("whitespace-nowrap");
    expect(time.className).toContain("whitespace-nowrap");
    // A phone's day: "Mon 11/9" (the wide one stays "Mon, Nov 9" from 640px).
    expect(day.querySelector(".sm\\:hidden")?.textContent).toBe("Mon 11/9");
    expect(time.textContent).toBe("3 PM");
    // Floor: the street is on the line, with its pin, and the row is one line.
    expect(c.textContent).toContain("2000 Johnston St");
    expect(c.querySelectorAll("svg").length).toBeGreaterThan(2);
    expect((c.querySelector(".job-meta-row") as HTMLElement).className).toContain("flex-nowrap");
  });

  it("the open card keeps its long day and \"3:00 PM\"", () => {
    const c = row(false);
    expect(c.querySelector("[data-meta-day]")?.textContent).toBe("Mon, Nov 9");
    expect(c.querySelector("[data-meta-time]")?.textContent).toBe("3:00 PM");
  });

  it('"Flexible" is one word on the signed-in row tag and on Posted cards', () => {
    expect(blankComments(readFileSync("src/components/dashboard/JobCardMedia.tsx", "utf8"))).toMatch(/>Flexible<\/span>/);
    expect(blankComments(readFileSync("src/pages/posts/postedJobCard/PostedJobMetaRow.tsx", "utf8"))).not.toMatch(/Flexible time/);
  });

  it("the shared JobMetaLine: place, day, time in order, each an unbreakable chunk with its icon; no separators", () => {
    const { container } = render(<JobMetaLine place="New Iberia" day="Sun 11/29" time={shortTime("9:00 AM")} />);
    const line = container.querySelector("[data-job-meta-line]") as HTMLElement;
    const parts = [...line.children] as HTMLElement[];
    expect(parts.map((p) => p.textContent)).toEqual(["New Iberia", "Sun 11/29", "9 AM"]);
    for (const p of parts) {
      expect(p.className).toContain("whitespace-nowrap");
      expect(p.className).toContain("shrink-0");
      expect(p.querySelector("svg"), `${p.textContent} has no icon`).not.toBeNull();
    }
    // Never ends a line on a separator: there is none; the line wraps between whole parts (time last).
    expect(line.textContent).not.toMatch(/·/);
    expect(line.className).toContain("flex-wrap");
  });

  it("Home's Jobs near you and Schedule's rows draw it", () => {
    for (const f of ["src/pages/home/homeDashboard/FirstJobHome.tsx", "src/components/profile/schedule/ScheduleCard.tsx"]) {
      expect(blankComments(readFileSync(f, "utf8")), f).toMatch(/<JobMetaLine\b/);
    }
  });
});
