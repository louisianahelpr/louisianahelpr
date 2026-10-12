/**
 * The "Louisiana Helpr Team" thread works both ways on prod (Q1590).
 *
 * Owner, 2026-10-09: an admin presses "Message" on the User Profile dialog and
 * the user can answer. Migration 20261011161100 gave every row of that thread
 * `job_id` NULL and `team_thread_user_id` = the user; the staff side writes
 * through `admin_send_team_message`, the user through `send_team_reply`.
 *
 * Driven, not read: the seed admin sends a message to the shared poster; the
 * poster opens /messages?teamThread=<self>, sees it under the team's name and
 * replies from the composer; the admin then has the reply's notification and
 * sees the reply in their side of the thread. Both sides are photographed at
 * 375 and 1440 and checked for sideways overflow. Every row it wrote carries
 * RUN_MARKER and is removed with the service role afterwards.
 */
// Shown able to fail: with the team's name gone from the thread, the user's side reds.
// @mutate src/lib/teamThread.ts | export const TEAM_THREAD_NAME = "Louisiana Helpr Team"; | export const TEAM_THREAD_NAME = "Support";
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../prodTest";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";
import { srFetch } from "../serviceRoleFetch";
import { RUN_MARKER, SUPABASE_URL, getSession, restAs, selectAs, serviceRoleKey, type Session } from "./harness";

const WIDTHS = [375, 1440] as const;
let poster: Session;
let admin: Session;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
  admin = await getSession(request, "admin");
});

async function openAs(browser: Browser, s: Session, width: number, path: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width, height: width >= 768 ? 900 : 812 },
    serviceWorkers: "block",
  });
  await ctx.addInitScript(
    ({ key, val }) => {
      try {
        localStorage.setItem(key, val);
        localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
      } catch {
        /* signed out: the thread assertion below fails visibly */
      }
    },
    { key: AUTH_STORAGE_KEY, val: JSON.stringify(s) },
  );
  const page = await ctx.newPage();
  await page.goto(path, { waitUntil: "domcontentloaded" });
  return { page, close: () => ctx.close() };
}

async function fits(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test("team thread: admin message reaches the user, the user's reply reaches the admin (375 + 1440)", async ({ browser, request }, info) => {
  test.setTimeout(5 * 60_000);
  const svc = serviceRoleKey();
  // prod-audit.yml writes the key to .env for each leg; without it nothing is created that could not be removed.
  expect(svc, "no service-role key: this spec writes rows only the service role can remove").toBeTruthy();
  const hello = `${RUN_MARKER} team hello`;
  const reply = `${RUN_MARKER} team reply`;
  const userPath = `/messages?teamThread=${poster.user.id}`;
  const staffPath = `/messages?teamThread=${poster.user.id}&userId=${poster.user.id}`;

  try {
    const sent = await restAs(request, admin, "post", "rpc/admin_send_team_message", { p_user_id: poster.user.id, p_content: hello });
    expect(sent.ok(), `admin_send_team_message: ${sent.status()} ${await sent.text()}`).toBe(true);

    for (const width of WIDTHS) {
      const { page, close } = await openAs(browser, poster, width, userPath);
      await expect(page.getByText(hello).first(), `the user does not see the team's message at ${width}`).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText("Louisiana Helpr Team").first(), `no team name on the user's side at ${width}`).toBeVisible();
      if (width === 375) {
        const box = page.getByRole("textbox", { name: /type a message/i });
        await expect(box, "no composer in the user's team thread").toBeVisible({ timeout: 30_000 });
        await box.fill(reply);
        await page.getByRole("button", { name: /^send message$/i }).click();
        await expect(page.getByText(reply).first(), "the user's reply never rendered").toBeVisible({ timeout: 20_000 });
      }
      await page.waitForTimeout(800);
      await page.screenshot({ path: info.outputPath(`team-thread-user-${width}.png`) });
      expect(await fits(page), `the user's thread overflows sideways at ${width}`).toBe(true);
      await close();
    }

    type N = { id: string; title: string; message: string };
    await expect
      .poll(
        async () =>
          (await selectAs<N[]>(request, admin, `notifications?user_id=eq.${admin.user.id}&link=like.*teamThread=${poster.user.id}*&select=id,title,message&order=created_at.desc&limit=5`))
            .some((n) => n.message.includes(reply)),
        { timeout: 30_000, message: "the admin never got the reply's notification" },
      )
      .toBe(true);

    for (const width of WIDTHS) {
      const { page, close } = await openAs(browser, admin, width, staffPath);
      await expect(page.getByText(reply).first(), `the admin does not see the reply at ${width}`).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText(hello).first(), `the admin does not see their own message at ${width}`).toBeVisible();
      await page.waitForTimeout(800);
      await page.screenshot({ path: info.outputPath(`team-thread-admin-${width}.png`) });
      expect(await fits(page), `the admin's thread overflows sideways at ${width}`).toBe(true);
      await close();
    }
  } finally {
    // Node fetch, never the traced Playwright context (Q1421).
    const enc = encodeURIComponent(`${RUN_MARKER}*`);
    const done: string[] = [];
    for (const [table, q] of [
      ["notifications", `link=like.*teamThread=${poster.user.id}*&message=like.${enc}`],
      ["messages", `team_thread_user_id=eq.${poster.user.id}&content=like.${enc}`],
    ] as const) {
      const r = await srFetch(svc!, "DELETE", `${SUPABASE_URL}/rest/v1/${table}?${q}`, { extra: { Prefer: "return=representation" } });
      done.push(`${table}: ${r.ok() ? `${((await r.json()) as unknown[]).length} removed` : `NOT removed (${r.status()} ${await r.text()})`}`);
    }
    info.annotations.push({ type: "cleanup", description: done.join("; ") });
    console.log(`[team-thread] cleanup: ${done.join("; ")}`);
  }
});
