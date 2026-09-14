/**
 * LOCATION OUTRANKS THE EXPIRY COUNTDOWN on the activity card meta row
 * (owner, 2026-09-11 and again 2026-09-13).
 *
 * Measured on prod at 375 (/my-posts, "Pressure wash a driveway" at
 * "Under a minute left"): the row is 267px and nowrap; the city "New Iberia"
 * rendered as "N…" (20px of the 59px it needs) while the countdown kept its
 * full 125px, because the countdown was `shrink-0` and the city was the only
 * item allowed to give.
 *
 * jsdom has no layout, so this asserts the flex contract that decides who
 * gives first: the countdown shrinks and ellipsizes, and the city does not
 * shrink while a countdown is on the row. The 375 before/after screenshots
 * (2026-09-14, local preview on prod data) are the layout proof.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobCardMetaRow } from "./JobCardMetaRow";

/** CSS flex-shrink implied by an element's Tailwind classes (default 1). */
function flexShrink(el: Element): number {
  for (const c of el.classList) {
    if (c === "shrink-0") return 0;
    if (c === "shrink") return 1;
    const m = c.match(/^shrink-\[(\d+(?:\.\d+)?)\]$/);
    if (m) return Number(m[1]);
  }
  return 1;
}

/** The direct child of the row that contains `node`. */
function rowItem(node: Element): Element {
  let el: Element | null = node;
  while (el && !el.parentElement?.classList.contains("job-meta-row")) el = el.parentElement;
  if (!el) throw new Error("not inside .job-meta-row");
  return el;
}

describe.each([false, true])("JobCardMetaRow location priority (locationPressToMap=%s)", (press) => {
  it("the expiry countdown gives way before the city does", () => {
    render(
      <JobCardMetaRow
        dateNeeded="2026-09-15"
        startTime={null}
        location="215 E Main St, New Iberia, LA 70560"
        expiresAt={new Date(Date.now() + 30_000).toISOString()}
        locationPressToMap={press}
      />,
    );
    const cityText = screen.getByText("New Iberia", { selector: "span" });
    const countdownText = screen.getByText(/Under a minute left/);

    const city = rowItem(cityText);
    const countdown = rowItem(countdownText);

    // The countdown may shrink at all, and down to nothing but its icon.
    expect(flexShrink(countdown), "countdown is shrink-0: it keeps its width and the city pays").toBeGreaterThan(0);
    expect(countdown.classList.contains("min-w-0"), "countdown has no min-w-0, so it cannot shrink below its text").toBe(true);
    expect(countdownText.closest(".truncate"), "countdown text does not ellipsize").not.toBeNull();

    // And the city does not give at all while a countdown is there. A weight
    // ratio alone (city 1 : countdown 100) still cost the city ~4px on prod at
    // 375 and rendered "New Iber…"; any loss on a short place name is an
    // ellipsis. Capped so a very long place name cannot push the date out.
    expect(flexShrink(city), "city still shrinks beside a countdown").toBe(0);
    expect(city.classList.contains("max-w-[50%]"), "unshrinkable city has no width cap").toBe(true);
  });
});

describe("JobCardMetaRow without a countdown", () => {
  it("leaves the city as the row's shrinker (unchanged behaviour)", () => {
    render(<JobCardMetaRow dateNeeded="2026-09-15" startTime="08:30" location="Lafayette, LA" expiresAt={null} />);
    const city = rowItem(screen.getByText("Lafayette", { selector: "span" }));
    expect(flexShrink(city)).toBe(1);
  });
});
