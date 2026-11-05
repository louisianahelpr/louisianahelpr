import type { Page } from "@playwright/test";
import { test, expect, assertHealthy, getSession, newUserContext, sessionsAvailable } from "./fixtures";
import { clearJobPostDraft } from "./jobPostDraft";
import { fillBudget, fillJobDetails } from "./postJobForm";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journey — POST A JOB'S "REPEATS" PICKER fits and behaves, on the real backend.
 *
 * Moved here from the mocked e2e/happy-path/zz-recurring-picker.spec.ts (Q1035:
 * every mocked spec is migrated to prod or retired, one at a time). The checks
 * are the same; the account is the shared poster test account signed in for
 * real, on the real When and where screen (reached through the form's own
 * screens, not a dispatched page switch). Nothing is posted: the journey stops
 * on When and where and never presses Review.
 *
 * The form keeps a draft on the account as it is typed (OPS-3), and an unposted
 * draft earns a "Finish your job post?" reminder. So the journey throws its
 * draft away once each page is closed (clearJobPostDraft), and fails if it
 * cannot. Guard src/test/journeysClearTheirJobDraft.test.ts.
 *
 * Pinned at 375 and 1440:
 *   1. Repeats shows a seven-day picker; every day is a 44px tap target.
 *   2. The week stepper's floor is the control going disabled at "1 week",
 *      not a rejected submit.
 *   3. Choosing days never reads "0 visits": with no start date it points at
 *      the Start date field just below, with one it counts the visits.
 *   4. All chosen days wear one fill (polled: `transition-all` mid-fade).
 *   5. Fit, measured per element too (body{overflow-x:hidden} hides overflow
 *      from scrollWidth).
 */
// Shown able to fail on a contract the file states in prose: remove the bound
// and the stepper walks below one week.
// @mutate src/components/postjob/RecurringSchedulePicker.tsx | disabled={weeks <= 1} | disabled={false}

const rotation = rotationFor(9);
const title = scenarioTitle({ journey: "recurring-picker", persona: "poster-only", state: "approved", rotation, outcome: "smooth" });

async function checkPicker(page: Page, width: number) {
  const repeats = page.getByRole("radio", { name: "Repeats", exact: true });
  await repeats.waitFor({ timeout: 20_000 });
  await repeats.click();

  const dayGroup = page.getByRole("group", { name: "Days of the week" });
  await expect(dayGroup).toBeVisible();
  await expect(dayGroup.getByRole("button")).toHaveCount(7);
  for (const label of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
    const box = (await dayGroup.getByRole("button", { name: label }).boundingBox())!;
    expect(box.height, `${label} tap target @ ${width}`).toBeGreaterThanOrEqual(44);
  }

  const fewer = page.getByRole("button", { name: "One week fewer" });
  const more = page.getByRole("button", { name: "One week more" });
  await expect(more).toBeEnabled();
  for (let i = 0; i < 60 && (await fewer.isEnabled()); i++) await fewer.click();
  await expect(page.getByText(/^1 week$/)).toBeVisible();
  await expect(fewer).toBeDisabled();

  // Days already chosen (a draft picked up from the account) are cleared first, so exactly three are on.
  const pressed = dayGroup.locator('button[aria-pressed="true"]');
  for (let i = 0; i < 7 && (await pressed.count()) > 0; i++) await pressed.first().click();
  await expect(pressed).toHaveCount(0);
  for (const label of ["Mon", "Wed", "Fri"]) await dayGroup.getByRole("button", { name: label }).click();
  await expect(page.getByText("0 visits")).toHaveCount(0);
  // No start date yet: the hint names the field. A date already chosen: a real count.
  await expect(page.getByText(/Start date.*just below|^[1-9]\d* visits?$/i).first()).toBeVisible();

  let chosen: string[] = [];
  await expect
    .poll(
      async () => {
        chosen = await dayGroup.locator('button[aria-pressed="true"]').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
        return chosen.length === 3 ? new Set(chosen).size : -1;
      },
      { message: `three days chosen, one fill @ ${width}`, timeout: 10_000 },
    )
    .toBe(1);

  const fit = await page.evaluate(() => {
    const de = document.documentElement;
    const viewportW = window.innerWidth;
    const past: string[] = [];
    const clipped = (e: Element): boolean => {
      let p2 = e.parentElement;
      while (p2 && p2 !== document.body && p2 !== de) {
        const ox = getComputedStyle(p2).overflowX;
        if (ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll") return true;
        p2 = p2.parentElement;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a, input, h1, h2, h3, p, li, label, output"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none") continue;
      if (clipped(el)) continue;
      if (r.right > viewportW + 2 && r.left < viewportW) {
        past.push(`<${el.tagName.toLowerCase()}${el.className ? " ." + String(el.className).split(" ")[0] : ""}> right=${Math.round(r.right)} > ${viewportW}`);
        if (past.length >= 5) break;
      }
    }
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, past };
  });
  expect(fit.scrollWidth, `horizontal overflow @ ${width}`).toBeLessThanOrEqual(fit.clientWidth);
  expect(fit.past, `content past the right edge @ ${width}:\n  ${fit.past.join("\n  ")}`).toEqual([]);
}

test(title, async ({ browser, request, journey }) => {
  test.skip(filteredOut(title), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  const session = await getSession(request, "poster");
  // The poster's saved address is the nightly parish-less ZIP 99999 (see post-job-day-tap.spec.ts, Q2417).
  journey.allowReport(/ZIP 99999 resolved to no Louisiana parish/, "deliberate: the poster's saved address is the nightly parish-less ZIP 99999");

  for (const width of [375, 1440]) {
    await test.step(`Repeats picker fits and behaves @ ${width}`, async () => {
      const ctx = await newUserContext(browser, session, { desktop: width > 900, timezoneId: "America/Chicago" });
      try {
        const page = journey.track(`poster-${width}`, await ctx.newPage());
        await page.setViewportSize({ width, height: width > 900 ? 900 : 812 });
        await page.goto("/post-job");
        await expect(page.getByRole("heading", { name: "What do you need done?" })).toBeVisible({ timeout: 60_000 });
        await fillJobDetails(page, "Repeats picker journey (never posted)");
        await fillBudget(page);
        await expect(page.getByRole("heading", { name: "When and where?" })).toBeVisible({ timeout: 20_000 });
        await checkPicker(page, width);
        await journey.milestone(page, `recurring-picker-${width}`);
        await assertHealthy(page, `/post-job Repeats (${width})`);
      } finally {
        await ctx.close();
        await clearJobPostDraft(request, session);
      }
    });
  }
});
