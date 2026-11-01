// @mutate src/components/admin/AdminSupport.tsx |             {pillLabel(label, counts.get(value))} |             {label}
/**
 * The admin console's chrome, measured on the real screen as admin-e2e against
 * prod data, read-only (every write refused at the wire). Owner, 2026-10-27,
 * three asks from screenshots of /admin at 1440:
 *
 *  1. "support and any other page title should be at the top, not pushed down
 *     like that": on every admin view the h1 (and its back arrow) sits IN the
 *     top bar's row. Measured: the h1's vertical centre lies inside the fixed
 *     bar's rect, and it starts left of the bell (getBoundingClientRect), at
 *     1440 (the global bar) and 375 (the admin bar). Before: bar bottom 56,
 *     "Support" h1 top 88 at 1440.
 *  2. "pending, resolved and all each need the number of items in each": every
 *     pill of Support, Reports, Stuck Jobs and Subscriptions reads "Label (n)".
 *  3. "a better way to see these tickets and open reports ... leave it open on
 *     the left panel": at 1440 the left nav's Admin group is open on a fresh
 *     device, from Home as well as /admin; each queue's red badge equals its
 *     screen's Pending/New/Awaiting pill and the Dashboard's Priority Alert;
 *     the Admin row's badge is their total.
 * Source guards for the same rules: src/test/adminTitleInTopBar.test.tsx,
 * src/test/adminFilterPillsShowCounts.test.ts, src/test/adminNavPendingBadges.test.ts.
 */
import { expect, test, type Browser, type APIRequestContext, type Page } from "../prodTest";
import { READ_RPC } from "../adminRpcClassification";
import { isStorageSignPath } from "../readRpc";
import { isConsentAcceptance, newUserContext, sessionFor, settle, SUPABASE_URL } from "./harness";

const TITLE_VIEWS: [string, string][] = [
  ["support", "Support"], ["reports", "Reports"], ["disputes", "Disputes"],
  ["stalled", "Stuck Jobs"], ["subscriptions", "Subscriptions"], ["people", "Users"],
];

async function adminPage(browser: Browser, request: APIRequestContext, width: number): Promise<{ page: Page; blocked: string[]; close: () => Promise<void> }> {
  const admin = await sessionFor(request, "admin");
  const ctx = await newUserContext(browser, admin);
  const blocked: string[] = [];
  await ctx.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const m = req.method();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS" || READ_RPC.test(req.url()) || isStorageSignPath(new URL(req.url()).pathname) || /\/auth\/v1\/(token|user)/.test(req.url())) return route.continue();
    if (isConsentAcceptance(m, new URL(req.url()).pathname, req.postData())) return route.continue();
    blocked.push(`${m} ${req.url().replace(SUPABASE_URL, "")}`);
    await route.abort("blockedbyclient").catch(() => {});
  });
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height: width > 900 ? 900 : 812 });
  return { page, blocked, close: () => ctx.close() };
}

/** The h1's rect against the fixed top bar's, and the bell's left edge. */
function titleGeometry() {
  const visible = (el: Element) => el.getBoundingClientRect().height > 0;
  const h1 = [...document.querySelectorAll("h1")].find(visible);
  const bar = [...document.querySelectorAll("header")].find((h) => visible(h) && getComputedStyle(h).position === "fixed");
  const bell = bar?.querySelector('[aria-label="Notifications"]');
  const r = (el: Element | null | undefined) => (el ? el.getBoundingClientRect() : null);
  const [t, b, n] = [r(h1), r(bar), r(bell)];
  return {
    text: h1?.textContent?.trim() ?? null,
    h1: t && { top: Math.round(t.top), bottom: Math.round(t.bottom), left: Math.round(t.left), centre: Math.round((t.top + t.bottom) / 2) },
    bar: b && { top: Math.round(b.top), bottom: Math.round(b.bottom) },
    bellLeft: n ? Math.round(n.left) : null,
  };
}

for (const width of [1440, 375]) {
  test(`every admin view's title sits in the top bar's row @ ${width}`, async ({ browser, request }, info) => {
    const { page, blocked, close } = await adminPage(browser, request, width);
    try {
      for (const [view, title] of TITLE_VIEWS) {
        await page.goto(`/admin?view=${view}`);
        await settle(page, 800);
        const g = await page.evaluate(titleGeometry);
        await page.screenshot({ path: info.outputPath(`admin-${view}-${width}.png`) });
        const where = `/admin?view=${view} @ ${width}: ${JSON.stringify(g)} (refused: ${blocked.join(", ") || "nothing"})`;
        expect(g.text, where).toBe(title);
        expect(g.h1 && g.bar, where).toBeTruthy();
        expect(g.h1!.centre, `title row below the bar — ${where}`).toBeGreaterThanOrEqual(g.bar!.top);
        expect(g.h1!.centre, `title row below the bar — ${where}`).toBeLessThanOrEqual(g.bar!.bottom);
        expect(g.bellLeft, where).not.toBeNull();
        expect(g.h1!.left, `title right of the bell — ${where}`).toBeLessThan(g.bellLeft!);
      }
    } finally {
      await close();
    }
  });
}

/** Each pill's "(n)", by label. A pill with no number fails the count rule. */
async function pillCounts(page: Page, group: string): Promise<Record<string, number | null>> {
  const texts = await page.getByRole("group", { name: group }).locator("button").allInnerTexts().catch(() => [] as string[]);
  const radios = texts.length ? texts : await page.getByRole("radiogroup", { name: group }).getByRole("radio").allInnerTexts();
  return Object.fromEntries(
    radios.map((t) => {
      const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(t.replace(/\s+/g, " ").trim());
      return m ? [m[1], Number(m[2])] : [t.trim(), null];
    }),
  );
}

/** The left nav's red count per admin row (absent = no badge = 0), and the Admin row's total. */
async function navBadges(page: Page): Promise<{ rows: Record<string, number>; total: number; open: boolean }> {
  return page.evaluate(() => {
    const rows: Record<string, number> = {};
    for (const b of document.querySelectorAll<HTMLElement>("[data-admin-badge]")) rows[b.dataset.adminBadge!] = Number(b.textContent);
    const t = document.querySelector<HTMLElement>("[data-admin-total-badge]");
    return {
      rows,
      total: t ? Number(t.dataset.adminTotalBadge) : 0,
      open: !!document.getElementById("side-panel-admin-sections"),
    };
  });
}

test("pills carry counts, and the nav badges, pills and Priority Alerts are one number @ 1440", async ({ browser, request }, info) => {
  const { page, close } = await adminPage(browser, request, 1440);
  try {
    // Fresh device: the Admin group is open, on Home too (not only inside /admin).
    await page.goto("/home");
    await settle(page, 2500);
    const home = await navBadges(page);
    await page.screenshot({ path: info.outputPath("home-nav-1440.png") });
    expect(home.open, "the Admin group is open by default").toBe(true);
    expect(home.total, `the Admin row's total is the sum of its queue badges: ${JSON.stringify(home)}`).toBe(
      Object.entries(home.rows).filter(([id]) => !["jobs", "referrals", "subscriptions"].includes(id)).reduce((s, [, n]) => s + n, 0),
    );

    const support = await (async () => { await page.goto("/admin?view=support"); await settle(page, 1500); return pillCounts(page, "Filter tickets by status"); })();
    await page.screenshot({ path: info.outputPath("support-1440.png") });
    const reports = await (async () => { await page.goto("/admin?view=reports"); await settle(page, 1500); return pillCounts(page, "Filter reports by status"); })();
    const stalled = await (async () => { await page.goto("/admin?view=stalled"); await settle(page, 1500); return pillCounts(page, "Which stuck jobs to show"); })();
    const subs = await (async () => { await page.goto("/admin?view=subscriptions"); await settle(page, 1500); return pillCounts(page, "Filter by subscription status"); })();
    for (const [name, counts] of Object.entries({ support, reports, stalled, subs })) {
      expect(Object.keys(counts).length, name).toBeGreaterThan(1);
      for (const [label, n] of Object.entries(counts)) expect(n, `${name} pill "${label}" shows no count`).not.toBeNull();
    }

    await page.goto("/admin");
    await settle(page, 2500);
    const nav = await navBadges(page);
    const alerts = await page.evaluate(() => {
      const out: Record<string, number> = {};
      for (const b of document.querySelectorAll("button")) {
        const m = /^(\d+)\s*(Active disputes|Open reports|Support tickets)/.exec((b.textContent ?? "").trim());
        if (m) out[m[2]] = Number(m[1]);
      }
      return out;
    });
    await page.screenshot({ path: info.outputPath("dashboard-1440.png") });
    const ctx = JSON.stringify({ nav, alerts, support, reports });
    expect(nav.rows.support ?? 0, ctx).toBe(support.Pending);
    expect(alerts["Support tickets"] ?? 0, ctx).toBe(support.Pending);
    expect(nav.rows.reports ?? 0, ctx).toBe(reports.New);
    expect(alerts["Open reports"] ?? 0, ctx).toBe(reports.New);
    expect(nav.rows.disputes ?? 0, ctx).toBe(alerts["Active disputes"] ?? 0);
  } finally {
    await close();
  }
});
