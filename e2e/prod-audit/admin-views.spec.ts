/**
 * Every /admin?view=* renders on PROD, as the admin-e2e account, at 375,
 * without a route or app crash. The view list is parsed from the `View` union
 * in src/pages/Admin.tsx, so a new view is checked the day it is added.
 *
 * Origin (2026-09-12): the mocked visual sweep captured "This page hit a
 * problem" on /admin?view=tiers. Reads only: every Supabase write is refused
 * at the wire, except read RPCs (get_*, list_*, ...).
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findErrorScreen } from "../errorScreens";
import { newUserContext, sessionFor, settle, SUPABASE_URL } from "./harness";

const CRASHES = ["route crash (RouteErrorBoundary)", "app crash (ErrorBoundary)"];

function adminViews(src = readFileSync(join(process.cwd(), "src/pages/Admin.tsx"), "utf8")): string[] {
  const m = /type View\s*=\s*([^;]+);/.exec(src);
  if (!m) throw new Error("Could not find `type View` in src/pages/Admin.tsx");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

const VIEWS = adminViews();

test("the admin view inventory is parsed (non-empty, includes tiers)", () => {
  expect(VIEWS.length).toBeGreaterThan(10);
  expect(VIEWS).toContain("tiers");
});

for (const view of VIEWS) {
  test(`/admin?view=${view} renders without a crash`, async ({ browser, request }, info) => {
    const admin = await sessionFor(request, "admin");
    const ctx = await newUserContext(browser, admin);
    // Admin views read through POST /rpc/get_* etc.; writeFirewall refuses every
    // POST, which rendered each RPC-backed view as its load-error state. Read
    // RPCs pass; every other write is still refused at the wire.
    const READ_RPC = /\/rest\/v1\/rpc\/(get_|list_|count_|admin_get_|admin_list_|search_)/;
    await ctx.route(`${SUPABASE_URL}/**`, async (route) => {
      const req = route.request();
      const m = req.method();
      if (m === "GET" || m === "HEAD" || m === "OPTIONS" || READ_RPC.test(req.url()) || /\/auth\/v1\/(token|user)/.test(req.url())) return route.continue();
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
    if (found && !CRASHES.includes(found.name)) {
      info.annotations.push({ type: "non-crash error copy", description: `${view}: ${found.name} — ${found.excerpt}` });
    }
    const crash = found && CRASHES.includes(found.name) ? found : null;
    expect(crash, `/admin?view=${view}: ${crash?.name} — ${crash?.excerpt}`).toBeNull();
    await ctx.close();
  });
}
