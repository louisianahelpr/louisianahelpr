import { devices, type Browser, type Locator, type Page } from "@playwright/test";
import { test, expect, assertHealthy, getSession, sessionsAvailable, AUTH_STORAGE_KEY, type Session } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle, type Rotation } from "./scenarios";
import { fillBudget, fillJobDetails } from "./postJobForm";

/**
 * Journey — on a phone, a TAP on Post a job's date and time controls takes,
 * and the floating "Review, then pay" bar never hides one.
 *
 * Original (owner, 2026-10-27, iPhone): tapping a day on Post a job's calendar
 * did nothing; the date did not change. Board 45 replaced that calendar with a
 * day strip, time chips and a "When" choice, and keeps the calendar behind
 * "More dates". Lead's suspect (2026-10-27): on Oct 26-27 every pickable day
 * (27-31) sat in the calendar's BOTTOM row, and once the form is complete the
 * bar floats 16px (+ the safe area) above the screen's bottom edge, so that row
 * could show in the strip UNDER the bar, right above Safari's toolbar.
 *
 * The CLASS, over the screen's OWN inventory: on the real, scrolling FormStep,
 * signed in as the poster test account (prod), at iPhone 13 size with a touch
 * screen (real WebKit in the journeys-webkit project):
 *   - every day card, every time chip, both "When" chips and both "Where"
 *     cards (when the account has a saved address) get a real
 *     `touchscreen.tap()` at their centre; the topmost element under the finger
 *     IS that control, and the tap changes the choice;
 *   - with the bar floating, every pickable day in the "More dates" calendar's
 *     bottom row is scrolled to the bottom edge of the screen: what the finger
 *     meets there is the day fully ABOVE the bar, or the bar itself, never the
 *     day peeking out under it; then the page scrolls it clear of the bar and
 *     a tap picks it.
 * The bottom-row check runs again at 1440 with a mouse.
 * Nothing is posted: the journey stops on screen 6 and never presses Review.
 *
 * @mutate src/components/postjob/LogisticsSection.tsx | onClick={() => pickDay(d.iso)} | onClick={() => {}}
 * @mutate src/components/postjob/LogisticsSection.tsx | className={`flex min-h-[60px] min-w-0 flex-col | className={`pointer-events-none flex min-h-[60px] min-w-0 flex-col
 * @mutate src/pages/post-job/FormStep.tsx | {barFloats && <div aria-hidden data-testid="post-job-bar-band" | {false && <div aria-hidden data-testid="post-job-bar-band"
 * @mutate src/pages/post-job/FormStep.tsx | top-full h-[calc(theme(spacing.safe-nav)*2)] bg-premium-page | top-full h-safe-nav bg-premium-page
 */

const rotation: Rotation = { ...rotationFor(7), device: "iphone-webkit", network: "fast" };
const title = scenarioTitle({ journey: "post-job-day-tap", persona: "poster-only", state: "approved", rotation, outcome: "smooth" });

async function openWhenAndWhere(browser: Browser, session: Session, desktop: boolean): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    ...(desktop ? { viewport: { width: 1440, height: 900 } } : { ...devices["iPhone 13"], viewport: { width: 375, height: 812 } }),
    baseURL: test.info().project.use.baseURL,
    serviceWorkers: "block",
    timezoneId: "America/Chicago",
  });
  await ctx.addInitScript(
    ({ key, val }) => {
      try {
        window.localStorage.setItem(key, val);
        window.localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
      } catch {
        /* storage blocked: the journey fails visibly at its first signed-in assertion */
      }
    },
    { key: AUTH_STORAGE_KEY, val: JSON.stringify(session) },
  );
  const page = await ctx.newPage();
  await page.goto("/post-job");
  // JA-41: the group grid is the first screen (no "Start from scratch" tap).
  await expect(page.getByRole("heading", { name: "What do you need done?" })).toBeVisible({ timeout: 60_000 });
  await fillJobDetails(page, "Day tap journey (never posted)");
  await fillBudget(page);
  await expect(page.getByRole("heading", { name: "When and where?" })).toBeVisible({ timeout: 20_000 });
  return { page, close: () => ctx.close() };
}

/** The scroller under `el`, scrolled by `dy`. */
const scrollOwnerBy = (el: Element, dy: number) => {
  let s: Element | null = el.parentElement;
  while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
  (s ?? document.scrollingElement)?.scrollBy(0, dy);
};

/** What sits under the control's centre, and where it is against the floating bar. */
const underFinger = (el: Element) => {
  const bar = document.querySelector('[data-testid="post-job-action-bar"]');
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const barTop = bar ? bar.getBoundingClientRect().top : Infinity;
  // Any sliver of the control showing below the bar's top edge (under it, or in
  // the strip between it and the screen's bottom edge) is a target that looks
  // tappable where a tap is not reliable. Sampled every 2px down the centre line.
  let peeksUnderBar = false;
  for (let y = Math.max(r.top, barTop) + 1; y < Math.min(r.bottom, window.innerHeight); y += 2) {
    const at = document.elementFromPoint(r.left + r.width / 2, y);
    if (at && (at === el || el.contains(at))) peeksUnderBar = true;
  }
  return {
    onControl: !!hit && (hit === el || el.contains(hit)),
    onBar: !!hit && !!bar && bar.contains(hit),
    peeksUnderBar,
    controlBottom: r.bottom,
    barTop,
    hit: hit ? `${hit.tagName.toLowerCase()}${hit.getAttribute("data-testid") ? `[${hit.getAttribute("data-testid")}]` : ""} "${(hit.textContent ?? "").trim().slice(0, 40)}"` : "nothing",
  };
};

/** Press at the control's centre: a finger on a touch screen, else the mouse. */
async function press(page: Page, control: Locator, touch: boolean): Promise<void> {
  const box = await control.boundingBox();
  expect(box, "the control has no box on screen").not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Bring a control to the middle of the scroller, prove nothing covers its centre, then tap it with a finger. */
async function fingerTap(page: Page, control: Locator, name: string): Promise<void> {
  await control.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const at = await control.evaluate(underFinger);
  expect(at.onControl, `${name}: the finger lands on ${at.hit}, not the control`).toBe(true);
  await press(page, control, true);
}

const isOn = async (control: Locator) => (await control.getAttribute("aria-checked")) === "true";

/**
 * The floating bar never hides a calendar day: for each pickable day in the
 * month's bottom row, scrolled to the bottom edge of the screen, the finger
 * meets the day fully above the bar or the bar itself (never the day peeking
 * out under the bar), and the page can scroll it clear, where a press picks it.
 * Returns how many days were checked.
 */
async function bottomRowNeverUnderTheBar(page: Page, where: string, touch: boolean): Promise<number> {
  const bar = page.getByTestId("post-job-action-bar");
  // The case under test: the form is complete, so the bar floats.
  await expect(bar, `${where}: the action bar is not floating, so this check would prove nothing`).toHaveCSS("position", "sticky");
  const calendar = page.getByRole("group", { name: /Date needed/ });
  await expect(calendar.locator("td[data-day]").first(), `${where}: the More dates calendar never mounted`).toBeAttached({ timeout: 30_000 });
  const days = calendar.locator("tbody tr").last().locator("td[data-day]:not([data-outside]) button:not([disabled])");
  const n = await days.count();
  expect(n, `${where}: the calendar's bottom row has no pickable day`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const day = days.nth(i);
    const iso = await day.evaluate((b) => b.closest("td")?.getAttribute("data-day") ?? "?");
    const name = `${where} bottom-row day ${iso}`;
    await day.evaluate((el) => el.scrollIntoView({ block: "end" }));
    await page.waitForTimeout(150);
    const atEdge = await day.evaluate(underFinger);
    expect(atEdge.onControl || atEdge.onBar, `${name}: at the screen's bottom edge the finger lands on ${atEdge.hit}`).toBe(true);
    expect(atEdge.peeksUnderBar, `${name}: part of the day shows UNDER the floating bar (day bottom ${Math.round(atEdge.controlBottom)}px, bar top ${Math.round(atEdge.barTop)}px)`).toBe(false);
    // The page can always scroll it clear of the bar.
    await day.evaluate(scrollOwnerBy, Math.max(0, atEdge.controlBottom - atEdge.barTop + 8));
    await page.waitForTimeout(150);
    const clear = await day.evaluate(underFinger);
    expect(clear.onControl && clear.controlBottom <= clear.barTop + 0.5, `${name}: the page cannot scroll it clear of the bar (finger lands on ${clear.hit})`).toBe(true);
    await press(page, day, touch);
    await expect
      .poll(() => calendar.locator('td[aria-selected="true"]').evaluateAll((tds) => tds.map((td) => td.getAttribute("data-day"))), {
        message: `${name}: the press did not choose it`,
        timeout: 5_000,
      })
      .toEqual([iso]);
  }
  return n;
}

test(title, async ({ browser, request, journey }) => {
  test.skip(filteredOut(title), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  const session = await getSession(request, "poster");
  const phone = await openWhenAndWhere(browser, session, false);
  const page = journey.track("poster", phone.page);
  let tapped = 0;

  await test.step("every day card takes a finger tap", async () => {
    const days = page.getByRole("radiogroup", { name: /Date needed/ }).getByRole("radio");
    const n = await days.count();
    expect(n, "the day strip has no days").toBeGreaterThan(3);
    for (let i = n - 1; i >= 0; i--) {
      const day = days.nth(i);
      const name = `day card ${(await day.getAttribute("aria-label")) ?? i}`;
      await fingerTap(page, day, name);
      await expect.poll(() => isOn(day), { message: `${name}: the tap did not choose it`, timeout: 5_000 }).toBe(true);
      tapped++;
    }
    // Leave the strip's LAST day chosen: today at 9:00 AM may already have passed,
    // and a past start keeps the form incomplete, so the bar would not float below.
    await fingerTap(page, days.nth(n - 1), "the last day card");
    await expect.poll(() => isOn(days.nth(n - 1)), { timeout: 5_000 }).toBe(true);
  });

  await test.step("the When chips and every time chip take a finger tap", async () => {
    for (const label of ["Flexible", "A set time"]) {
      const chip = page.getByRole("radio", { name: label, exact: true });
      await fingerTap(page, chip, `When "${label}"`);
      await expect.poll(() => isOn(chip), { message: `When "${label}": the tap did not choose it`, timeout: 5_000 }).toBe(true);
      tapped++;
    }
    const times = page.getByRole("radiogroup", { name: /Start time/ }).getByRole("radio");
    const n = await times.count();
    expect(n, "the time chips are missing").toBeGreaterThan(3);
    for (let i = 0; i < n; i++) {
      const chip = times.nth(i);
      const name = `time chip "${(await chip.textContent())?.trim()}"`;
      await fingerTap(page, chip, name);
      await expect.poll(() => isOn(chip), { message: `${name}: the tap did not choose it`, timeout: 5_000 }).toBe(true);
      tapped++;
    }
    // Leave a common time chosen (Other time opened the wheel).
    const nine = page.getByRole("radiogroup", { name: /Start time/ }).getByRole("radio", { name: "9:00 AM" });
    await fingerTap(page, nine, "time chip 9:00 AM");
    await expect.poll(() => isOn(nine), { timeout: 5_000 }).toBe(true);
  });

  await test.step("the Where cards take a finger tap", async () => {
    const where = page.getByRole("radiogroup", { name: "Where" });
    // The poster account posts at a saved Louisiana address every night; without
    // one the bar cannot float and the bottom-row step below would prove nothing.
    await expect(where, "the poster test account has no saved address (its last job's location), so the Where radio is missing").toBeVisible({ timeout: 20_000 });
    const cards = where.getByRole("radio");
    for (const i of [1, 0]) {
      const card = cards.nth(i);
      await fingerTap(page, card, `Where card ${i}`);
      await expect.poll(() => isOn(card), { message: `Where card ${i}: the tap did not choose it`, timeout: 5_000 }).toBe(true);
      tapped++;
    }
  });

  await test.step("375: More dates, and the floating bar never hides a bottom-row day", async () => {
    await fingerTap(page, page.getByRole("button", { name: "More dates" }), "More dates");
    tapped += await bottomRowNeverUnderTheBar(page, "375", true);
    // A day past the strip, next month, by finger.
    const calendar = page.getByRole("group", { name: /Date needed/ });
    await fingerTap(page, calendar.getByRole("button", { name: /Go to the Next Month/i }), "next month");
    const day = calendar.locator("td[data-day]:not([data-outside]) button:not([disabled])").nth(9);
    const iso = await day.evaluate((b) => b.closest("td")?.getAttribute("data-day") ?? "");
    expect(iso, "no pickable day next month").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await fingerTap(page, day, `calendar day ${iso}`);
    await expect
      .poll(() => calendar.locator('td[aria-selected="true"]').evaluateAll((tds) => tds.map((td) => td.getAttribute("data-day"))), {
        message: `calendar day ${iso}: the tap did not choose it`,
        timeout: 5_000,
      })
      .toEqual([iso]);
    tapped++;
    await journey.milestone(page, "post-job-day-tapped");
  });

  // 5 days + 2 When chips + 5 time chips + 2 Where cards + the bottom row (1+) + the next-month day on 2026-10-27.
  expect(tapped, "fewer controls were tapped than the screen has").toBeGreaterThan(15);
  await assertHealthy(page, "/post-job When and where (375)");
  await phone.close();

  await test.step("1440: the floating bar never hides a bottom-row day", async () => {
    const wide = await openWhenAndWhere(browser, session, true);
    const desk = journey.track("poster-1440", wide.page);
    await expect(desk.getByRole("radiogroup", { name: "Where" }), "no saved address at 1440").toBeVisible({ timeout: 20_000 });
    await desk.getByRole("radiogroup", { name: /Date needed/ }).getByRole("radio").last().click();
    await desk.getByRole("radiogroup", { name: /Start time/ }).getByRole("radio", { name: "1:00 PM" }).click();
    await desk.getByRole("button", { name: "More dates" }).click();
    expect(await bottomRowNeverUnderTheBar(desk, "1440", false)).toBeGreaterThan(0);
    await journey.milestone(desk, "post-job-bottom-row-1440");
    await assertHealthy(desk, "/post-job When and where (1440)");
    await wide.close();
  });
});
