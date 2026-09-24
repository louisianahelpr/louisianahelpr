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
 *
 * ── WHAT 2026-09-19 ADDED, AND WHY IT IS NOT A WEAKENING ──────────────────
 * The row can now be handed a full STREET ADDRESS instead of a city (owner:
 * "the full address needs to go where the city place is"). The priority rule
 * above is untouched for every card that shows a city — which is every card it
 * was ever measured on — because a street address does not enter the contest
 * at all: it takes a line of its own (`basis-full`) and the date, time and
 * countdown flow underneath it.
 *
 * THE ARITHMETIC FOR THAT, since a stated-but-unmeasured width shipped the
 * 12px primary: the row is 212px at 320. The date chip ("Thu, Sep 17") needs
 * ~77px and the time chip ("12:00 PM") ~62px, plus two 8px gaps — 155px. That
 * leaves 57px for the location, 41px of it text after the pin, about seven
 * characters: "1103 Center St, New Iberia, LA 70560" would render "1103 C…".
 * An address clipped to seven characters is a different address, so it does
 * not share the line. On its own line it has the full 212px (196px of text),
 * ~35 characters, and wraps rather than clips beyond that.
 *
 * The third case below is what stops the new branch quietly taking the old
 * rule with it.
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

describe("a full street address takes a line of its own instead", () => {
  const ADDRESS = "1103 Center St, New Iberia, LA 70560";

  it("it is not in the contest: basis-full, unshrinkable, and it wraps rather than clips", () => {
    render(
      <JobCardMetaRow
        dateNeeded="2026-09-15"
        startTime="12:00"
        location={ADDRESS}
        expiresAt={null}
        showFullAddress
      />,
    );
    const item = rowItem(screen.getByText(ADDRESS));
    expect(
      item.classList.contains("basis-full"),
      "the address shares the line with the date and time — at 320 that leaves it ~41px, " +
        "which renders as '1103 C…'",
    ).toBe(true);
    expect(flexShrink(item), "the address is allowed to shrink").toBe(0);
    expect(
      screen.getByText(ADDRESS).classList.contains("truncate"),
      "the address ellipsizes instead of wrapping — a clipped address is a different address",
    ).toBe(false);
    // And the row it sits in must actually be allowed to wrap, or `basis-full`
    // does nothing at all.
    expect(item.parentElement!.classList.contains("flex-wrap")).toBe(true);
  });

  it("the date and time still hold their own width beneath it", () => {
    render(
      <JobCardMetaRow dateNeeded="2026-09-15" startTime="12:00" location={ADDRESS} expiresAt={null} showFullAddress />,
    );
    expect(flexShrink(rowItem(screen.getByText(/Sep 15/)))).toBe(0);
  });

  it("A CITY IS UNCHANGED even when the caller allows addresses", () => {
    // The old rule, on the same code path: a town-only location has no street
    // part, so it is still the row's shrinker and still shares the line.
    render(
      <JobCardMetaRow dateNeeded="2026-09-15" startTime="08:30" location="Lafayette, LA" expiresAt={null} showFullAddress />,
    );
    const city = rowItem(screen.getByText("Lafayette", { selector: "span" }));
    expect(city.classList.contains("basis-full"), "a city was given a line of its own").toBe(false);
    expect(flexShrink(city)).toBe(1);
  });
});

describe("JobCardMetaRow without a countdown", () => {
  it("leaves the city as the row's shrinker (unchanged behaviour)", () => {
    render(<JobCardMetaRow dateNeeded="2026-09-15" startTime="08:30" location="Lafayette, LA" expiresAt={null} />);
    const city = rowItem(screen.getByText("Lafayette", { selector: "span" }));
    expect(flexShrink(city)).toBe(1);
  });
});

// The whole rule: beside a countdown the city is shrink-0, so the countdown is
// the item that gives. As `shrink` it is the row's shrinker again and "New
// Iberia" renders "N…" at 375, which is the bug this file was written for.
// @mutate src/components/job-card/JobCardMetaRow.tsx | ? "shrink-0 max-w-[50%]" | ? "shrink max-w-[50%]"
