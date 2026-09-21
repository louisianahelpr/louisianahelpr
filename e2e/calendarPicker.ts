/**
 * Pick a day out of the app's calendar popover, by the DAY IT IS — not by a
 * regex over the label a screen reader happens to say.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS (measured on prod's build, 2026-09-20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two suites drove the date field the same way: format the target as
 * "September 20", turn the space into `.*`, and click the first button or
 * gridcell whose accessible name matches.
 *
 *     const day = new RegExp(slot.monthDay.replace(" ", ".*"));   // /September.*20/
 *     page.getByRole("button", { name: day })
 *         .or(page.getByRole("gridcell", { name: day })).first().click();
 *
 * Every day button's accessible name ENDS IN THE YEAR — "Tuesday, September
 * 1st, 2026" — and "2026" contains "20". So `/September.*20/` matched all 30
 * days of the month, and `.first()` in DOM order resolved to September **1st**,
 * a past day. Worse, the union also matches the `<td>` gridcell, and a `<td>`
 * has no disabled state: Playwright clicked it, refused nothing, and the click
 * did nothing at all. The popover stayed open, no date was set, and
 * `Review & Pay` never armed — reported as "the submit button never became
 * Review & Pay", i.e. as if posting a job were broken. It was not; the app is
 * fine and was fine throughout.
 *
 * It is date-dependent by construction: it can only ever land on the right day
 * on the 1st of a month, and it lands on a disabled day every other day of the
 * year.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT USES INSTEAD
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * react-day-picker (v9, behind `src/components/ui/calendar.tsx`) stamps every
 * cell with its own ISO day:
 *
 *     <td role="gridcell" data-day="2026-09-20" [data-disabled] [data-outside]>
 *       <button aria-label="Today, Sunday, September 20th, 2026">20</button>
 *
 * `data-day` is the calendar's own identity for that square, exact, locale-free
 * and year-safe. We click the BUTTON inside it — the only element that has a
 * disabled state — so a day that cannot be chosen fails loudly here instead of
 * silently doing nothing three steps later.
 */
import { expect, type Page } from "@playwright/test";

/** `YYYY-MM-DD` for a Date, in a named time zone (the app stores local dates). */
export function isoDayIn(at: Date, timeZone = "America/Chicago"): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Click `isoDay` in the open calendar popover, paging months if it is not on
 * the visible sheet.
 *
 * Asserts the cell exists and its button is enabled BEFORE clicking, and
 * asserts the popover closed after — the two things the old regex silently
 * skipped.
 */
export async function pickCalendarDay(page: Page, isoDay: string): Promise<void> {
  const popover = page.getByRole("dialog", { name: "Choose a date" });
  await expect(popover, "the calendar popover did not open").toBeVisible({ timeout: 10_000 });
  // The grid is lazy (DatePickerField defers react-day-picker's chunk behind a
  // Suspense skeleton). Wait for the month sheet to exist before looking for a
  // day on it — otherwise the paging loop below runs against an empty popover
  // and walks months away from the target while the calendar is still loading.
  await expect(
    popover.locator("td[data-day]").first(),
    "the calendar grid never mounted (lazy chunk)",
  ).toBeAttached({ timeout: 15_000 });
  const cell = popover.locator(`td[role="gridcell"][data-day="${isoDay}"]`);
  // The target is at most a month out in every caller; page forward if needed.
  for (let i = 0; i < 14 && (await cell.count()) === 0; i++) {
    await popover.getByRole("button", { name: "Go to the Next Month" }).click();
    await page.waitForTimeout(150);
  }
  await expect(cell, `the calendar has no cell for ${isoDay} (paged forward 14 months)`).toHaveCount(1);
  const button = cell.getByRole("button");
  await expect(
    button,
    `${isoDay} is present but not selectable — a disabled day cannot be clicked, ` +
      "and clicking its <td> instead is what silently did nothing before",
  ).toBeEnabled({ timeout: 5_000 });
  await button.click();
  await expect(popover, `the calendar stayed open after choosing ${isoDay}`).toBeHidden({ timeout: 5_000 });
}
