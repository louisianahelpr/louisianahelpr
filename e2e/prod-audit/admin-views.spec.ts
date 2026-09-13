/**
 * Every /admin?view=* renders on PROD, as the admin-e2e account, at 375,
 * without ANY error screen: no route or app crash, no "couldn't load" data
 * failure, no "couldn't verify your access" gate. The view list is parsed from
 * the `View` union in src/pages/Admin.tsx, so a new view is checked the day it
 * is added.
 *
 * Origin (2026-09-12): the mocked visual sweep captured "This page hit a
 * problem" on /admin?view=tiers. Reads only: every Supabase write is refused
 * at the wire, except named read RPCs.
 *
 * 2026-09-13: the first version failed only on crashes and merely annotated a
 * "couldn't load" state, so /admin?view=support showed "We couldn't load the
 * support queue" and passed. The cause was this spec: `admin_support_queue` is
 * a read RPC whose name matched none of the read prefixes, so the firewall
 * refused it. Every refused request is now named in the failure message, so a
 * load failure the firewall caused says which call it blocked.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findErrorScreen } from "../errorScreens";
import { newUserContext, sessionFor, settle, SUPABASE_URL } from "./harness";

function adminViews(src = readFileSync(join(process.cwd(), "src/pages/Admin.tsx"), "utf8")): string[] {
  const m = /type View\s*=\s*([^;]+);/.exec(src);
  if (!m) throw new Error("Could not find `type View` in src/pages/Admin.tsx");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

const VIEWS = adminViews();

/**
 * Read RPCs by prefix, plus read RPCs whose names carry no read verb. Adding a
 * name here is a claim that the function does not write: check
 * `pg_get_functiondef` on prod first.
 */
const READ_RPC = /\/rest\/v1\/rpc\/(get_|list_|count_|admin_get_|admin_list_|search_|admin_support_queue(\?|$))/;

test("the admin view inventory is parsed (non-empty, includes tiers)", () => {
  expect(VIEWS.length).toBeGreaterThan(10);
  expect(VIEWS).toContain("tiers");
});

test("the read allow-list passes the support queue and still refuses writes", () => {
  expect(READ_RPC.test(`${SUPABASE_URL}/rest/v1/rpc/admin_support_queue`)).toBe(true);
  expect(READ_RPC.test(`${SUPABASE_URL}/rest/v1/rpc/admin_support_queue_resolve`)).toBe(false);
  expect(READ_RPC.test(`${SUPABASE_URL}/rest/v1/rpc/admin_ban_user`)).toBe(false);
});

for (const view of VIEWS) {
  test(`/admin?view=${view} renders without an error screen`, async ({ browser, request }, info) => {
    const admin = await sessionFor(request, "admin");
    const ctx = await newUserContext(browser, admin);
    const blocked: string[] = [];
    await ctx.route(`${SUPABASE_URL}/**`, async (route) => {
      const req = route.request();
      const m = req.method();
      if (m === "GET" || m === "HEAD" || m === "OPTIONS" || READ_RPC.test(req.url()) || /\/auth\/v1\/(token|user)/.test(req.url())) return route.continue();
      blocked.push(`${m} ${req.url().replace(SUPABASE_URL, "")}`);
      await route.abort("blockedbyclient").catch(() => {});
    });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/admin?view=${view}`);
    await settle(page, 1500);
    await page.screenshot({ path: info.outputPath(`admin-${view}.png`) });
    expect(new URL(page.url()).pathname, `admin-e2e was bounced off /admin (view=${view})`).toBe("/admin");
    const text = await page.locator("body").innerText().catch(() => "");
    const found = findErrorScreen(text, []);
    expect(
      found,
      `/admin?view=${view}: ${found?.name} — ${found?.excerpt}\nrefused at the wire: ${blocked.join(", ") || "nothing"}`,
    ).toBeNull();
    await ctx.close();
  });
}
