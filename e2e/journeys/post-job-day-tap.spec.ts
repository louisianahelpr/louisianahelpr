import { devices, type Locator, type Page } from "@playwright/test";
import { test, expect, assertHealthy, getSession, sessionsAvailable, AUTH_STORAGE_KEY } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle, type Rotation } from "./scenarios";
import { fillBudget, fillJobDetails } from "./postJobForm";

/**
 * Journey — on a phone, a TAP on Post a job's date and time controls takes.
 *
 * Original (owner, 2026-10-27, iPhone): tapping a day on Post a job's calendar
 * did nothing; the date did not change. Board 45 replaced that calendar with a
 * day strip, time chips and a "When" choice, and keeps the calendar behind
 * "More dates".
 *
 * The CLASS, over the screen's OWN inventory: on the real, scrolling FormStep,
 * signed in as the poster test account (prod), at iPhone 13 size with a touch
 * screen (real WebKit in the journeys-webkit project), every day card, every
 * time chip, both "When" chips, both "Where" cards (when the account has a
 * saved address) and one day of the "More dates" calendar get a real
 * `touchscreen.tap()` at their centre, and for each one:
 *   1. the topmost element under the finger IS that control (nothing, such as
 *      the floating "Review, then pay" bar, sits over it), and
 *   2. the tap changes the choice (aria-checked / aria-selected).
 * Nothing is posted: the journey stops on screen 6 and never presses Review.
 *
 * @mutate src/components/postjob/LogisticsSection.tsx | onClick={() => setDateNeeded(d.iso)} | onClick={() => {}}
 * @mutate src/components/postjob/LogisticsSection.tsx | className={`flex min-h-[60px] min-w-0 flex-col | className={`pointer-events-none flex min-h-[60px] min-w-0 flex-col
 */

const rotation: Rotation = { ...rotationFor(7), device: "iphone-webkit", network: "fast" };
const title = scenarioTitle({ journey: "post-job-day-tap", persona: "poster-only", state: "approved", rotation, outcome: "smooth" });

/** Bring a control to the middle of the scroller, prove nothing covers its centre, then tap it with a finger. */
async function fingerTap(page: Page, control: Locator, name: string): Promise<void> {
  await control.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const box = await control.boundingBox();
  expect(box, `${name}: no box on screen`).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const hit = await control.evaluate((el, [px, py]) => {
    const top = document.elementFromPoint(px, py);
    if (!top) return "nothing";
    if (el === top || el.contains(top)) return null;
    return `${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ""} "${(top.textContent ?? "").trim().slice(0, 40)}"`;
  }, [x, y] as const);
  expect(hit, `${name}: the finger lands on ${hit}, not the control`).toBeNull();
  await page.touchscreen.tap(x, y);
}

const isOn = async (control: Locator) => (await control.getAttribute("aria-checked")) === "true";

test(title, async ({ browser, request, journey }) => {
  test.skip(filteredOut(title), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  const session = await getSession(request, "poster");
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 375, height: 812 },
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
  const page = journey.track("poster", await ctx.newPage());
  let tapped = 0;

  await test.step("open Post a job and walk to When and where", async () => {
    await page.goto("/post-job");
    await page.getByRole("button", { name: /Start from scratch/ }).click({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "What do you need done?" })).toBeVisible({ timeout: 30_000 });
    await fillJobDetails(page, "Day tap journey (never posted)");
    await fillBudget(page);
    await expect(page.getByRole("heading", { name: "When and where?" })).toBeVisible({ timeout: 20_000 });
  });

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

  await test.step("the Where cards take a finger tap (when there is a saved address)", async () => {
    const where = page.getByRole("radiogroup", { name: "Where" });
    if (!(await where.isVisible().catch(() => false))) {
      test.info().annotations.push({ type: "uncovered", description: "the poster account has no saved address; the Where cards were not tapped" });
      return;
    }
    const cards = where.getByRole("radio");
    for (const i of [1, 0]) {
      const card = cards.nth(i);
      await fingerTap(page, card, `Where card ${i}`);
      await expect.poll(() => isOn(card), { message: `Where card ${i}: the tap did not choose it`, timeout: 5_000 }).toBe(true);
      tapped++;
    }
  });

  await test.step("More dates opens the calendar and a day in it takes a finger tap", async () => {
    await fingerTap(page, page.getByRole("button", { name: "More dates" }), "More dates");
    const calendar = page.getByRole("group", { name: /Date needed/ });
    await expect(calendar.locator("td[data-day]").first(), "the More dates calendar never mounted").toBeAttached({ timeout: 30_000 });
    // A day past the strip: the strip shows today and the next four.
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

  // 5 days + 2 When chips + 5 time chips + the calendar day (+ 2 Where cards) on 2026-10-27.
  expect(tapped, "fewer controls were tapped than the screen has").toBeGreaterThan(12);
  await assertHealthy(page, "/post-job When and where");
  await ctx.close();
});
