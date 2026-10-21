import { expect, type Page } from "@playwright/test";
import { isoDayIn, pickCalendarDay } from "../calendarPicker";

/**
 * Driving the Post a job form, shared by the marketplace journey (J2,
 * 02-marketplace.spec.ts) and the slow-network suite (e2e/slow-network, Q68),
 * so the rural-network run posts through exactly the form J2 proves, never a
 * hand-rolled copy of it.
 */

export const ZONE = "America/Chicago";
/** A start slot `minutesAhead` from now in Louisiana time, rounded up to the form's 5-minute grid. */
export function slotAhead(minutesAhead: number) {
  const t = new Date(Math.ceil((Date.now() + minutesAhead * 60_000) / 300_000) * 300_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
      .formatToParts(t)
      .map((p) => [p.type, p.value]),
  );
  // hh24 is for the NATIVE <input type="time"> (see pickStartTime): hour12:false
  // renders midnight as "24", which no native time field accepts, so ask for
  // hourCycle h23 explicitly rather than deriving it from the 12-hour parts.
  const hh24 = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
  // `isoDay` is what the calendar itself is keyed by (td[data-day]); the
  // month/day strings are for human-readable annotations only. See
  // e2e/calendarPicker.ts for why a regex over the day label cannot be used.
  return { at: t, isoDay: isoDayIn(t, ZONE), monthDay: `${parts.month} ${parts.day}`, hour: parts.hour, minute: parts.minute, ampm: parts.dayPeriod as "AM" | "PM", hh24 };
}

export type Slot = ReturnType<typeof slotAhead>;

/**
 * Set the post-job start time on whichever control this viewport renders.
 *
 * The form has TWO real start-time controls, and which one exists is a
 * viewport decision, not a preference:
 *
 *   web desktop (>=900px, not native) → a native <input type="time" step=300>
 *   everything else                   → the Hour / Minute wheels + AM-PM radios
 *
 * TimePickerWheel.tsx:192 (`if (isWebDesktop && variant === "auto")`), gated by
 * useIsWebDesktop (`!isNativePlatform && matchMedia("(min-width: 900px)")`);
 * LogisticsSection.tsx:408 passes the default variant, so the post-job form is
 * on that fork. Landed 2026-09-07 and narrowed to `variant === "auto"` on
 * 2026-09-11 — this spec still drove only the wheels.
 *
 * That is why e2e-journeys (#1595) was red in BOTH engines from 2026-09-14:
 * rotationFor() deals the scenario row by weekday, not by project, and on a
 * `desktop-1440` day this step waited 20s for a `listbox` named "Hour" that
 * the desktop form does not render — taking the apply / hire / do-the-job
 * specs down with it (they chain off the job this one posts).
 *
 * Drive the control that is on screen. Never force `variant="wheels"` in the
 * app to suit the test.
 */
export async function pickStartTime(page: Page, slot: ReturnType<typeof slotAhead>) {
  const native = page.locator('input[type="time"][aria-label="Start time"]');
  if (await native.count()) {
    await native.fill(slot.hh24);
    await expect(native, "the native time field did not take the value").toHaveValue(slot.hh24);
    return;
  }
  await page.getByRole("listbox", { name: "Hour" }).getByRole("option", { name: slot.hour, exact: true }).click();
  await page.getByRole("listbox", { name: "Minute" }).getByRole("option", { name: slot.minute, exact: true }).click();
  await page.getByRole("radiogroup", { name: "AM or PM" }).getByRole("radio", { name: slot.ampm }).click();
}

/**
 * Screens 1 and 2 of 5 (boards 23, 44): the category (the Home group, then Cleaning), then title, description and (optionally) one photo. Ends on
 * screen 3, the price.
 */
export async function fillJobDetails(page: Page, title: string, photoPath?: string) {
  // Screen 1 shows the 8 groups; Home opens its categories (1b), and a category tap goes on (owner 2026-10-21).
  await page.getByRole("button", { name: /^Home/ }).click();
  await page.getByRole("button", { name: "Cleaning", exact: true }).click();
  await page.getByRole("textbox", { name: "Job Title *" }).fill(title);
  await page.getByRole("textbox", { name: "Description *" }).fill(
    "Automated journey test. Not a real job; created and removed by the test suite. Please ignore.",
  );
  if (photoPath) {
    await page.locator("input[type=file][accept='image/*']").first().setInputFiles(photoPath);
    await expect(page.getByRole("button", { name: "Remove photo" }).first(), "the chosen photo never appeared in the form").toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

/**
 * Screen 4 of 5 (board 45): address, a parish-less ZIP and the date/time.
 * Returns the Review, then pay button once it is enabled. ZIP is required, and a
 * Louisiana ZIP derives a parish, which fires the helper fan-out. 99999
 * resolves to no parish (get_parish_for_zip -> null), so the job is posted
 * with parish null, the same guard prod-lifecycle uses.
 */
export async function fillLogistics(page: Page, slot: Slot, allowReport: (message: RegExp, why: string) => void) {
  await expect(page.getByRole("heading", { name: "When and where?" })).toBeVisible({ timeout: 20_000 });
  // Friction 4 (2026-10-21): one address search box; "Enter it yourself" opens the four fields, the
  // path this journey needs for the parish-less ZIP 99999. Absent when MapKit is not ready (fields show).
  const manual = page.getByRole("button", { name: "Enter it yourself" });
  if (await manual.isVisible().catch(() => false)) await manual.click();
  await page.getByRole("combobox", { name: "Street Address" }).or(page.getByRole("textbox", { name: "Street Address" })).fill("100 Audit Way");
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "City" }).fill("Baton Rouge");
  await page.keyboard.press("Escape");
  allowReport(/ZIP 99999 resolved to no Louisiana parish/, "deliberate: keeps parish null so no real helper is notified");
  await page.getByRole("textbox", { name: "ZIP code" }).fill("99999");
  await pickCalendarDay(page, slot.isoDay, { inline: /Date needed/i });
  await pickStartTime(page, slot);
  const review = page.getByRole("button", { name: /Review, then pay/ });
  await expect(review, "the submit button never became Review, then pay").toBeEnabled({ timeout: 20_000 });
  return review;
}

/** Screen 3 of 5 (board 3): the budget, then on to When and where. */
export async function fillBudget(page: Page, dollars = "25") {
  await expect(page.getByRole("heading", { name: "What will you pay?" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("textbox", { name: "Job budget in dollars" }).fill(dollars);
  const next = page.getByRole("button", { name: "Continue", exact: true });
  await expect(next, "the price screen's Continue never enabled").toBeEnabled({ timeout: 20_000 });
  await next.click();
}
