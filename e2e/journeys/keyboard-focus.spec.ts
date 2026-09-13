import type { Page } from "@playwright/test";
import { test, expect, assertHealthy, getSession, newUserContext, sessionsAvailable } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journey — a keyboard user keeps their place (owner, 2026-09-12: "prevent,
 * don't chase"; audit of the same day found all four of the originals).
 *
 * The CLASS this guards: keyboard focus that is (a) invisible, (b) lost to
 * <body> when a screen swaps, (c) lost to <body> when a write re-renders the
 * control, (d) on a control with no name. Each leg runs over the app's OWN
 * inventory of that control kind on the real screen, against prod, so a new
 * offender of the same shape goes red without anyone writing a new test:
 *
 *   a. EVERY focusable inside the DOB picker paints a focus indicator
 *      (original: the Month/Day/Year listboxes, `focus-visible:outline-none`).
 *   b. Opening a thread from the inbox leaves focus INSIDE the thread
 *      (original: Messages swaps the list for the chat; focus fell to body).
 *   c. EVERY switch on Notification preferences keeps focus through a toggle
 *      and its save (original: the push master, remounted by a component
 *      declared inside the render body). Each is toggled back afterwards.
 *   d. EVERY switch, checkbox and button on the post-job form has an
 *      accessible name (reported: #require-photo-proof; it is named by its
 *      <label htmlFor>, and this leg proves that for every sibling too).
 *   e. EVERY file picker on the post-job form paints focus when its input
 *      is focused (original: PhotoUpload's ring hidden by an inline shadow).
 */

const rotation = rotationFor(3);

const focusDescription = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "body";
    return `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""}[role=${a.getAttribute("role") ?? ""} label=${a.getAttribute("aria-label") ?? ""}]`;
  });

const guestTitle = scenarioTitle({ journey: "keyboard", persona: "new", state: "approved", rotation, outcome: "smooth" });
test(guestTitle, async ({ browser, journey }) => {
  test.skip(filteredOut(guestTitle), "SCENARIO pins another scenario");
  const ctx = await newUserContext(browser, null, { rotation });
  const page = journey.track("guest", await ctx.newPage());

  await test.step("a. every focusable in the DOB wheel shows focus", async () => {
    await page.goto("/signup");
    await page.locator("#email").fill(`keyboard-journey-${Date.now()}@example.com`);
    await page.locator("#password").fill("Kb!journey12345");
    for (const id of ["#policies", "#age-confirm"]) await page.locator(id).click();
    await page.getByRole("button", { name: /continue/i }).first().click();
    await expect(page.locator("#dob")).toBeVisible({ timeout: 30_000 });
    await page.locator("#dob").click();
    const dialog = page.getByRole("dialog", { name: "Choose a date" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // Inventory from the screen, not from a list: everything tabbable in the picker.
    const focusables = dialog.locator('[tabindex="0"], button:not([disabled]), input:not([disabled]), select:not([disabled])');
    // The wheel is a lazy chunk; wait for it to land before taking inventory.
    await expect(focusables.first()).toBeVisible({ timeout: 30_000 });
    const n = await focusables.count();
    expect(n, "the DOB picker has no keyboard stops at all").toBeGreaterThan(0);
    const invisible: string[] = [];
    for (let i = 0; i < n; i++) {
      const el = focusables.nth(i);
      await el.focus();
      // Keyboard movement is what turns :focus-visible on; Tab away and back.
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      const paint = await el.evaluate((e) => {
        if (document.activeElement !== e) return { skipped: true };
        const cs = getComputedStyle(e);
        const transparent = (c: string) => /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(c);
        const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && !transparent(cs.outlineColor);
        const shadow = cs.boxShadow !== "none";
        return { skipped: false, outline, shadow, desc: `${e.tagName.toLowerCase()}[${e.getAttribute("aria-label") ?? e.textContent?.trim().slice(0, 20)}] outline=${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} shadow=${cs.boxShadow}` };
      });
      if (!paint.skipped && !paint.outline && !paint.shadow) invisible.push(paint.desc!);
    }
    await journey.milestone(page, "dob-wheel-focus");
    expect(invisible, "focused with nothing painted").toEqual([]);
    await assertHealthy(page, "signup DOB picker");
  });

  await test.step("a2. Tab through the DOB wheel never changes the value", async () => {
    // Original (2026-09-12): options were tabbable buttons; Tab scroll-snapped
    // the column onto them and two presses moved the year 2008 -> 1906.
    const dialog = page.getByRole("dialog", { name: "Choose a date" });
    const selected = () =>
      dialog.evaluate((d) =>
        Array.from(d.querySelectorAll('[role="listbox"]')).map(
          (lb) => `${lb.getAttribute("aria-label")}=${lb.querySelector('[aria-selected="true"]')?.textContent ?? ""}`,
        ),
      );
    const month = dialog.getByRole("listbox", { name: "Month" });
    await month.focus();
    const before = await selected();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      // Let any focus-driven scroll settle past the wheel's 90ms debounce.
      await page.waitForTimeout(250);
    }
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Shift+Tab");
      await page.waitForTimeout(250);
    }
    expect(await selected(), "Tab moved the DOB wheel's value").toEqual(before);
    // Every option is out of the tab order; the listbox is the only stop.
    expect(await dialog.locator('[role="option"]:not([tabindex="-1"])').count()).toBe(0);
  });
  await ctx.close();
});

const authedTitle = scenarioTitle({ journey: "keyboard", persona: "helper-only", state: "approved", rotation, outcome: "smooth" });
test(authedTitle, async ({ browser, request, journey }) => {
  test.skip(filteredOut(authedTitle), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  // Leg c round-trips prod once per switch, twice (toggle + restore); on the
  // slow rotation that alone is several minutes.
  test.setTimeout(rotation.network === "slow" ? 20 * 60_000 : 10 * 60_000);
  const helper = await getSession(request, "helper");
  const ctx = await newUserContext(browser, helper, { rotation });
  const page = journey.track("helper", await ctx.newPage());

  await test.step("b. opening a thread keeps focus inside the thread", async () => {
    await page.goto("/messages");
    const rows = page.locator("button.flex-1.min-w-0.text-left");
    await expect(rows.first(), "the helper inbox has no threads to open").toBeVisible({ timeout: 60_000 });
    await rows.first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Back to conversations" })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => focusDescription(page), { timeout: 5_000 }).not.toBe("body");
    const inside = await page.evaluate(() => !!document.activeElement?.closest("main, [role=main], #root"));
    expect(inside, "focus left the app root").toBe(true);
    await journey.milestone(page, "thread-open-focus");
    await assertHealthy(page, "/messages thread");
  });

  await test.step("c. every notification switch keeps focus through a toggle", async () => {
    await page.goto("/profile?tab=notifications");
    const switches = page.getByRole("switch");
    await expect(switches.first()).toBeVisible({ timeout: 60_000 });
    // Wait for the real controls (the skeleton pills carry no role).
    await expect(page.getByRole("switch", { name: "Push notifications master toggle" })).toBeEnabled({ timeout: 30_000 });
    const saving = page.getByLabel("Saving");
    // One toggle = one prod round-trip; wait for its spinner, not a fixed sleep
    // (on the "slow" rotation every call is 3-8s, and there are ~24 switches).
    const settle = async () => {
      await saving.first().waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
      await expect(saving).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(150);
    };
    const n = await switches.count();
    const lost: string[] = [];
    for (let i = 0; i < n; i++) {
      const sw = switches.nth(i);
      if (!(await sw.isEnabled())) continue;
      const name = (await sw.getAttribute("aria-label")) ?? `switch #${i}`;
      const was = (await sw.getAttribute("aria-checked")) === "true";
      await sw.focus();
      await page.keyboard.press("Space");
      // Focus must survive BOTH renders (optimistic value, then the spinner).
      await settle();
      if ((await focusDescription(page)) === "body") lost.push(name);
      // Put it back exactly as found (a dropped write already reverted it).
      for (let tries = 0; tries < 3 && ((await sw.getAttribute("aria-checked")) === "true") !== was; tries++) {
        await sw.focus();
        await page.keyboard.press("Space");
        await settle();
      }
      expect((await sw.getAttribute("aria-checked")) === "true", `could not restore "${name}"`).toBe(was);
    }
    await journey.milestone(page, "notification-switch-focus");
    expect(lost, "focus dropped to body after toggling").toEqual([]);
    await assertHealthy(page, "/profile?tab=notifications");
  });

  await test.step("d. every control on the post-job form is named", async () => {
    await page.goto("/post-job");
    await page.getByRole("button", { name: /start fresh/i }).first().click({ timeout: 60_000 });
    await expect(page.locator("#require-photo-proof")).toBeVisible({ timeout: 30_000 });
    const controls = page.getByRole("switch").or(page.getByRole("checkbox")).or(page.getByRole("button"));
    const n = await controls.count();
    const unnamed: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = controls.nth(i);
      if (!(await c.isVisible())) continue;
      const snap = await c.ariaSnapshot();
      // "- switch" with no quoted name, vs `- switch "Require before & after photos"`.
      if (!/^- \w+ "/.test(snap.trim())) unnamed.push(`${(await c.getAttribute("id")) ?? "?"}: ${snap.trim().slice(0, 60)}`);
    }
    await journey.milestone(page, "post-job-names");
    expect(unnamed, "controls with no accessible name").toEqual([]);
    await assertHealthy(page, "/post-job form");
  });

  await test.step("e. every file picker on the post-job form paints focus", async () => {
    // Same class as (a), second shape: PhotoUpload's "+" chip declared
    // `focus-within:ring-2` and ALSO an inline boxShadow — the ring is a
    // box-shadow, so the inline style won and nothing showed (dbed7befd).
    const pickers = page.locator("label:has(> input[type=file]), label:has(input[type=file])");
    const n = await pickers.count();
    expect(n, "the post-job form has file pickers; none were found").toBeGreaterThan(0);
    const unpainted: string[] = [];
    for (let i = 0; i < n; i++) {
      const label = pickers.nth(i);
      if (!(await label.isVisible())) continue;
      const input = label.locator("input[type=file]").first();
      await input.focus();
      // `transition-all` on the chip: let the outline settle before reading it.
      await page.waitForTimeout(400);
      const paint = await label.evaluate((el) => {
        const cs = getComputedStyle(el);
        const transparent = (c: string) => /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(c);
        const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && !transparent(cs.outlineColor);
        // A ring is a box-shadow that changes on focus; compare against the resting value.
        const focusedShadow = cs.boxShadow;
        (document.activeElement as HTMLElement | null)?.blur();
        const restingShadow = getComputedStyle(el).boxShadow;
        return { outline, shadowChanged: focusedShadow !== restingShadow, desc: `${el.textContent?.trim().slice(0, 30) || "+"} outline=${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` };
      });
      if (!paint.outline && !paint.shadowChanged) unpainted.push(paint.desc);
    }
    // Leave focus on the first picker for the milestone shot.
    await pickers.first().locator("input[type=file]").focus();
    await pickers.first().scrollIntoViewIfNeeded();
    await journey.milestone(page, "post-job-file-picker-focus");
    expect(unpainted, "file picker focused with nothing painted").toEqual([]);
  });
  await ctx.close();
});
