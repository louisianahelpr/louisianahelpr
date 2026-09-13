import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import sharp from "sharp";
import {
  test,
  expect,
  assertHealthy,
  getSession,
  newUserContext,
  rest,
  sessionsAvailable,
  forgetSession,
  SUPABASE_URL,
  AUTH_STORAGE_KEY,
} from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journeys 7 and 8 — the account itself.
 *
 * J7 profile: edit a field, change the photo through the crop dialog,
 *    availability, a notification toggle, save a Helpr, save a search.
 * J8 settings and security views open; sign out; sign back in.
 *
 * Everything changed is put back, by the same UI where the UI can, and by the
 * account's own REST session where it cannot (the previous avatar URL). What is
 * NEVER pressed on these shared accounts, deliberately: "Sign Out Everywhere"
 * (would sign every other lane out), "Change email", "Reset" password (sends
 * mail and is a credential change), "Turn On" two-step, "Delete Account".
 */

const rotation = rotationFor(2);
const RUN = Date.now().toString(36).slice(-6);

type ProfileRow = { id: string; bio: string | null; avatar_url: string | null };

async function readProfile(request: Parameters<typeof getSession>[0], s: Awaited<ReturnType<typeof getSession>>) {
  const r = await request.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${s.user.id}&select=id,bio,avatar_url`, { headers: rest(s) });
  expect(r.ok(), `reading profile: ${r.status()}`).toBe(true);
  const [row] = (await r.json()) as ProfileRow[];
  expect(row, "no profile row").toBeTruthy();
  return row;
}

async function openFromProfile(page: Page, name: RegExp, heading: string) {
  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "Log Out" }), "the profile page never finished loading").toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name }).filter({ visible: true }).first().click();
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible({ timeout: 30_000 });
  await assertHealthy(page, heading);
}

const j7 = scenarioTitle({ journey: "profile", persona: "both", state: "approved", rotation, outcome: "smooth" });
test(j7, async ({ browser, request, journey }) => {
  test.setTimeout(10 * 60_000);
  test.skip(filteredOut(j7), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  const helper = await getSession(request, "helper");
  const poster = await getSession(request, "poster");
  const before = await readProfile(request, helper);
  const hctx = await newUserContext(browser, helper, { rotation });
  const pctx = await newUserContext(browser, poster, { rotation });
  const hp = journey.track("helper", await hctx.newPage());
  const pp = journey.track("poster", await pctx.newPage());

  // Put the profile back even if a step fails half-way.
  journey.cleanup("restore bio and avatar", async () => {
    const r = await request.patch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${helper.user.id}`, {
      headers: rest(helper, { Prefer: "return=representation" }),
      data: { bio: before.bio, avatar_url: before.avatar_url },
    });
    expect(r.ok(), `restoring profile: ${r.status()} ${await r.text()}`).toBe(true);
    expect(await readProfile(request, helper)).toMatchObject({ bio: before.bio, avatar_url: before.avatar_url });
  });

  await test.step("edit a profile field and see it on the profile", async () => {
    await openFromProfile(hp, /^Edit profile$|^Edit$/, "Edit Profile");
    const about = hp.getByRole("textbox", { name: "About you" });
    await about.fill(`${before.bio ?? ""} Journey ${RUN}.`.trim());
    const save = hp.getByRole("button", { name: "Save Changes" });
    await expect(save, "the save bar never offered Save Changes after an edit").toBeEnabled({ timeout: 15_000 });
    await journey.milestone(hp, "edit-profile-dirty");
    await save.click();
    await expect
      .poll(async () => (await readProfile(request, helper)).bio ?? "", { timeout: 30_000, message: "Save Changes did not write the bio" })
      .toContain(`Journey ${RUN}.`);
    await hp.goto("/profile");
    await expect(hp.getByText(`Journey ${RUN}.`), "the edited bio is not on the profile").toBeVisible({ timeout: 30_000 });
    await assertHealthy(hp, "profile after edit");
    await journey.milestone(hp, "profile-edited");
  });

  await test.step("change the photo through the crop dialog", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lh-avatar-"));
    const file = join(dir, "avatar.png");
    // A real-looking picture, not a flat fill: the editor rejects a single-colour
    // image as "came through blank", correctly.
    const px = Buffer.alloc(600 * 600 * 3);
    for (let y = 0; y < 600; y++) for (let x = 0; x < 600; x++) {
      const i = (y * 600 + x) * 3;
      px[i] = (x * 255) / 600; px[i + 1] = (y * 255) / 600; px[i + 2] = ((x ^ y) & 0xff);
    }
    await sharp(px, { raw: { width: 600, height: 600, channels: 3 } }).png().toFile(file);
    await openFromProfile(hp, /^Edit profile$|^Edit$/, "Edit Profile");
    await hp.locator("input[type=file][accept*='image']").first().setInputFiles(file);
    const crop = hp.getByRole("dialog").filter({ hasText: "Position your photo" });
    await expect(crop, "choosing a photo did not open the crop dialog").toBeVisible({ timeout: 20_000 });
    await crop.getByRole("slider", { name: "Zoom" }).fill("1.5").catch(() => {});
    await journey.milestone(hp, "crop-dialog");
    await crop.getByRole("button", { name: "Use Photo" }).click();
    await expect(crop).toBeHidden({ timeout: 30_000 });
    await expect
      .poll(async () => (await readProfile(request, helper)).avatar_url, { timeout: 45_000, message: "the new photo never saved to the profile" })
      .not.toBe(before.avatar_url);
    await expect(hp.getByText("That photo came through blank"), "the new photo is reported blank").toHaveCount(0, { timeout: 20_000 });
    await assertHealthy(hp, "after photo change");
    await journey.milestone(hp, "photo-changed");
  });

  await test.step("availability: turn a day off, save, see it stick, restore", async () => {
    // Save is a DELETE of the week followed by an INSERT (HelperAvailability.tsx),
    // so the journey waits for the INSERT: leaving between the two wipes the
    // week (filed in docs/OPEN.md). The real hours are snapshotted and put back.
    const hoursBefore = await request.get(
      `${SUPABASE_URL}/rest/v1/helper_availability?helper_id=eq.${helper.user.id}&specific_date=is.null&select=day_of_week,is_available,start_time,end_time&order=day_of_week`,
      { headers: rest(helper) },
    );
    const week = (await hoursBefore.json()) as Array<Record<string, unknown>>;
    expect(week.length, "the helper has no saved weekly hours to start from").toBe(7);
    journey.cleanup("restore weekly hours", async () => {
      const now = await request.get(
        `${SUPABASE_URL}/rest/v1/helper_availability?helper_id=eq.${helper.user.id}&specific_date=is.null&select=day_of_week,is_available,start_time,end_time&order=day_of_week`,
        { headers: rest(helper) },
      );
      if (JSON.stringify(await now.json()) === JSON.stringify(week)) return;
      await request.delete(`${SUPABASE_URL}/rest/v1/helper_availability?helper_id=eq.${helper.user.id}&specific_date=is.null`, { headers: rest(helper) });
      const put = await request.post(`${SUPABASE_URL}/rest/v1/helper_availability`, {
        headers: rest(helper, { Prefer: "return=minimal" }),
        data: week.map((d) => ({ ...d, helper_id: helper.user.id, specific_date: null })),
      });
      expect(put.ok(), `restoring weekly hours: ${put.status()} ${await put.text()}`).toBe(true);
    });
    await openFromProfile(hp, /^Availability/, "Availability");
    const sunday = hp.getByRole("switch", { name: "Toggle Sunday" });
    const wasOn = (await sunday.getAttribute("aria-checked")) === "true" || (await sunday.getAttribute("data-state")) === "checked";
    await sunday.click();
    const saved = hp.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/rest/v1/helper_availability") && r.ok(), { timeout: 30_000 });
    await hp.getByRole("button", { name: "Save Availability" }).click();
    await saved;
    await assertHealthy(hp, "availability saved");
    await hp.reload();
    await expect(hp.getByRole("switch", { name: "Toggle Sunday" }), "Sunday did not persist").toHaveAttribute("aria-checked", String(!wasOn), { timeout: 30_000 });
    await journey.milestone(hp, "availability-changed");
    await hp.getByRole("switch", { name: "Toggle Sunday" }).click();
    const restored = hp.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/rest/v1/helper_availability") && r.ok(), { timeout: 30_000 });
    await hp.getByRole("button", { name: "Save Availability" }).click();
    await restored;
    await hp.reload();
    await expect(hp.getByRole("switch", { name: "Toggle Sunday" }), "Sunday was not restored").toHaveAttribute("aria-checked", String(wasOn), { timeout: 30_000 });
  });

  await test.step("a notification toggle persists, then restore", async () => {
    await openFromProfile(hp, /^Notifications/, "Notifications");
    const digest = hp.getByRole("switch", { name: "Daily match digest" });
    const was = await digest.getAttribute("aria-checked");
    await digest.click();
    await expect(digest).not.toHaveAttribute("aria-checked", String(was));
    await assertHealthy(hp, "toggle flipped");
    await hp.waitForTimeout(1_500);
    await hp.reload();
    await expect(hp.getByRole("switch", { name: "Daily match digest" }), "the toggle did not persist").not.toHaveAttribute("aria-checked", String(was), { timeout: 30_000 });
    await journey.milestone(hp, "notification-toggled");
    await hp.getByRole("switch", { name: "Daily match digest" }).click();
    await hp.waitForTimeout(1_500);
    await hp.reload();
    await expect(hp.getByRole("switch", { name: "Daily match digest" }), "the toggle was not restored").toHaveAttribute("aria-checked", String(was), { timeout: 30_000 });
  });

  await test.step("poster saves the Helpr, finds them in Saved Helprs, removes them", async () => {
    await pp.goto(`/user/${helper.user.id}`);
    const save = pp.getByRole("button", { name: /^Save Helpr$|^Unsave Helpr$/ }).first();
    await expect(save).toBeVisible({ timeout: 30_000 });
    await assertHealthy(pp, "helper public profile");
    if ((await save.getAttribute("aria-label")) === "Unsave Helpr") {
      await save.click(); // start from a clean state
      await expect(pp.getByRole("button", { name: "Save Helpr" }).first()).toBeVisible();
    }
    await pp.getByRole("button", { name: "Save Helpr" }).first().click();
    await expect(pp.getByRole("button", { name: "Unsave Helpr" }).first()).toBeVisible({ timeout: 20_000 });
    await journey.milestone(pp, "helper-saved");
    await openFromProfile(pp, /^Saved Helprs/, "Saved Helprs");
    await expect(pp.getByText(/Hallie/).first(), "the saved Helpr is not in Saved Helprs").toBeVisible({ timeout: 30_000 });
    await journey.milestone(pp, "saved-helprs-list");
    await pp.goto(`/user/${helper.user.id}`);
    await pp.getByRole("button", { name: "Unsave Helpr" }).first().click();
    await expect(pp.getByRole("button", { name: "Save Helpr" }).first()).toBeVisible({ timeout: 20_000 });
  });

  await test.step("poster saves a search from Browse, sees it, deletes it", async () => {
    await pp.goto("/dashboard");
    await pp.getByRole("button", { name: "Filters" }).first().click();
    // A saved search is a saved FILTER SET; with none active the dialog says "set filters first".
    await pp.getByRole("dialog").getByRole("group", { name: "Filter by category" }).getByRole("button", { name: /cleaning/i }).first().click();
    if (!(await pp.getByRole("dialog").getByRole("button", { name: /Saved Searches/ }).isVisible().catch(() => false))) {
      await pp.getByRole("button", { name: "Filters" }).first().click();
    }
    await pp.getByRole("dialog").getByRole("button", { name: /Saved Searches/ }).click();
    const dialog = pp.getByRole("dialog").filter({ hasText: "Saved Searches" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const name = `Journey ${RUN}`;
    await dialog.getByPlaceholder("e.g. Lawn care under $200").fill(name);
    await dialog.getByRole("button", { name: "Save filter set" }).click();
    await expect(dialog.getByText(name), "the saved search did not appear in the list").toBeVisible({ timeout: 20_000 });
    await assertHealthy(pp, "saved search created");
    await journey.milestone(pp, "saved-search");
    const row = dialog.locator("div").filter({ hasText: name }).filter({ has: pp.getByRole("button", { name: "Delete saved search" }) }).last();
    await row.getByRole("button", { name: "Delete saved search" }).click();
    const confirm = pp.getByRole("button", { name: /^Delete$/ });
    if (await confirm.first().waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false)) await confirm.first().click();
    await expect(dialog.getByText(name), "the saved search was not deleted").toHaveCount(0, { timeout: 20_000 });
    await dialog.getByRole("button", { name: "Close" }).last().click();
    // Leave Browse unfiltered for the next person on this account.
    await pp.getByRole("button", { name: "Filters" }).first().click();
    const clear = pp.getByRole("dialog").getByRole("button", { name: /clear/i }).first();
    if (await clear.isVisible().catch(() => false)) await clear.click();
  });

  await hctx.close();
  await pctx.close();
});

const j8 = scenarioTitle({ journey: "settings-signout", persona: "both", state: "approved", rotation, outcome: "smooth" });
test(j8, async ({ browser, request, journey }) => {
  test.setTimeout(8 * 60_000);
  test.skip(filteredOut(j8), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  const helper = await getSession(request, "helper");
  const ctx = await newUserContext(browser, helper, { rotation });
  const page = journey.track("helper", await ctx.newPage());

  for (const [button, heading] of [
    [/^Account Security/, "Account Security"],
    [/^Notifications/, "Notifications"],
    [/^Accessibility/, "Accessibility"],
    [/^Legal/, "Legal"],
    [/^Warnings & Strikes/, "Warnings & Strikes"],
    [/^Help & Support/, "Help & Support"],
    [/^Earnings & Payouts/, "Earnings"],
  ] as const) {
    await test.step(`${heading} opens`, async () => {
      await page.goto("/profile");
      await expect(page.getByRole("button", { name: "Log Out" }), "the profile page never finished loading").toBeVisible({ timeout: 45_000 });
      await page.getByRole("button", { name: button }).filter({ visible: true }).first().click();
      await expect(page.getByRole("heading", { level: 1 }).first(), `${heading} did not open`).toContainText(new RegExp(heading.split(" ")[0], "i"), { timeout: 30_000 });
      await assertHealthy(page, heading);
      await journey.milestone(page, `settings-${heading}`);
    });
  }

  // Log Out currently signs the account out EVERYWHERE (supabase-js default
  // scope "global"; filed in docs/OPEN.md). On a shared account that kicks
  // every other lane out, so it runs only where nothing else holds the
  // account: the nightly CI job, which sets JOURNEY_GLOBAL_SIGNOUT_OK=1.
  if (process.env.JOURNEY_GLOBAL_SIGNOUT_OK !== "1") {
    test.info().annotations.push({
      type: "uncovered",
      description: "sign out / sign back in not driven locally: Log Out revokes every session of the shared account (OPEN.md). Runs in e2e-journeys.yml.",
    });
    await ctx.close();
    return;
  }

  await test.step("sign out", async () => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Log Out" }).click();
    await expect(page.getByRole("heading", { name: "Log Out?" }), "Log Out asked for no confirmation").toBeVisible({ timeout: 10_000 });
    await journey.milestone(page, "log-out-confirm");
    await page.getByRole("button", { name: "Log Out" }).last().click();
    await expect.poll(async () => page.evaluate((k) => localStorage.getItem(k), AUTH_STORAGE_KEY), { timeout: 20_000, message: "the session is still stored after Log Out" }).toBeNull();
    forgetSession("helper"); // Log Out revoked every helper session, including the cached one
    await expect(page).not.toHaveURL(/\/profile/, { timeout: 20_000 });
    await page.goto("/my-jobs");
    await expect(page, "a signed-out visitor reached /my-jobs").toHaveURL(/\/(login|signup|$)|\/\?/, { timeout: 30_000 });
    await assertHealthy(page, "signed out");
    await journey.milestone(page, "signed-out");
  });

  await test.step("sign back in", async () => {
    const email = process.env.PLAYWRIGHT_HELPER_EMAIL;
    const password = process.env.PLAYWRIGHT_HELPER_PASSWORD;
    if (email && password) {
      await page.goto("/login");
      await page.getByRole("textbox", { name: /email/i }).first().fill(email);
      await page.getByLabel(/password/i).first().fill(password);
      await page.getByRole("button", { name: /^(Log In|Sign In|Continue)/ }).first().click();
    } else {
      // No password on this machine: sign in the way the email link does,
      // through a one-time link opened in this same browser.
      const { execFileSync } = await import("node:child_process");
      const out = execFileSync("node", ["scripts/test-signin-link.mjs", "helper-e2e", "--json"], { encoding: "utf8" });
      const { actionLink } = JSON.parse(out) as { actionLink: string };
      await page.goto(actionLink);
    }
    await page.waitForTimeout(8_000);
    await journey.milestone(page, "after-sign-in-landing");
    test.info().annotations.push({ type: "sign-in-landing", description: page.url().replace(/#.*/, "#…") });
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Hallie Helper", level: 1 }), "not signed back in as the helper").toBeVisible({ timeout: 30_000 });
    await assertHealthy(page, "signed back in");
    await journey.milestone(page, "signed-back-in");
  });
  await ctx.close();
});
