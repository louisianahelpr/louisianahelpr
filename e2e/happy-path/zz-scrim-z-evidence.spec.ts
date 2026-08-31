import { test, expect, installSupabaseMocks, seedAuthedSession, FAKE_CUSTOMER } from "./fixtures";
import type { MockRule } from "./fixtures";
import { mkdirSync } from "node:fs";

/** TEMPORARY: A/B the anchored-panel scrim at z-40 vs z-50 and record whether
 *  the app's fixed chrome (top nav, bottom dock — both z-50) is actually
 *  covered. Delete when done. */

const OTHER = "00000000-0000-4000-8000-0000000000aa";
const AGO = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const OUT = "/Users/lexilombas/louisianahelpr/.claude/tmp/anchored-panel-audit";

const JOBS = Array.from({ length: 12 }, (_, i) => ({
  id: `30000000-0000-4000-8000-0000000000${String(i + 10)}`,
  title: `JOB CARD ${i + 1}`, description: `Task ${i + 1} description that is long enough to look real.`,
  category: "cleaning", budget: 100 + i, date_needed: "2026-09-20", customer_id: OTHER,
  status: "open", created_at: AGO(60 + i * 10), updated_at: AGO(60 + i * 10),
  is_urgent: false, urgent_fee: 0, is_flexible_schedule: false, is_recurring: false,
  is_group_job: false, helpers_needed: 1, estimated_hours: 2, special_requirements: null,
  photos: [], boosted_at: null, boost_expires_at: null, expires_at: null, start_time: "09:00",
  recurrence_interval: null, recurrence_end_date: null, parent_job_id: null,
  payment_status: "unpaid", location: "New Orleans, LA", pricing_mode: "fixed", applicant_count: 0,
}));

const NOTIFS = Array.from({ length: 24 }, (_, i) => ({
  id: `50000000-0000-4000-8000-0000000000${String(i + 10)}`,
  user_id: FAKE_CUSTOMER.id, type: "info", title: `Notification ${i + 1}`,
  message: `Body copy for notification ${i + 1}, long enough to wrap on a phone.`,
  body: `Body copy ${i + 1}.`, link: null, read: i >= 9, created_at: AGO(30 + i * 45),
}));

const PROFILE = {
  id: `${FAKE_CUSTOMER.id}-profile`, user_id: FAKE_CUSTOMER.id, full_name: FAKE_CUSTOMER.fullName,
  avatar_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  bio: "Smoke-test profile bio with at least twenty characters.", date_of_birth: "1990-01-01",
  phone: "5045550100", location: "New Orleans, LA",
  id_document_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  approval_status: "approved", ban_status: "active", is_legacy_user: true, subscription_tier: "free",
  subscription_expires_at: null, referral_code: "SMOKE", is_verified: true, role: "customer",
  skills: "moving", created_at: AGO(9999), updated_at: AGO(1),
};

const rules: MockRule[] = [
  { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/open_jobs_browse", handle: () => ({ status: 200, body: JOBS }) },
  { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/notifications", handle: () => ({ status: 200, body: NOTIFS }) },
  { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/profiles", handle: () => ({ status: 200, body: [PROFILE] }) },
  { match: (u, m) => m === "POST" && u.pathname === "/rest/v1/rpc/get_safe_profiles",
    handle: () => ({ status: 200, body: [{ user_id: OTHER, full_name: "Other Poster", avatar_url: null, is_verified: true, location: "New Orleans, LA" }] }) },
];

// Set the scrim's z-index and report what is painted over the app's fixed
// chrome. Hit-testing order === paint order, so with pointer-events forced to
// `auto` on the scrim, elementFromPoint over the dock / top nav answers
// "is the scrim above this?" exactly.
const AB = (z: string) => `(() => {
  const scrim = Array.from(document.querySelectorAll('div')).find((el) => {
    const cs = getComputedStyle(el);
    return cs.position === 'fixed' && (cs.backdropFilter || '').includes('blur(24px)');
  });
  if (!scrim) return { error: 'no scrim' };
  scrim.style.zIndex = '${z}';
  const prevPe = scrim.style.pointerEvents;
  scrim.style.pointerEvents = 'auto';
  const name = (el) => el ? (el.tagName + (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ').filter(Boolean).slice(0,2).join('.')) : null;
  const at = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return { el: name(el), isScrim: el === scrim, inChrome: !!(el && el.closest('.mobile-nav-frame, .glass-nav')) };
  };
  const dock = document.querySelector('.mobile-nav-frame');
  const nav = document.querySelector('.glass-nav');
  const dr = dock ? dock.getBoundingClientRect() : null;
  const nr = nav ? nav.getBoundingClientRect() : null;
  const out = {
    z: getComputedStyle(scrim).zIndex,
    dockPresent: !!dock,
    dockZ: dock ? getComputedStyle(dock).zIndex : null,
    overDock: dr ? at(dr.x + dr.width / 2, dr.y + dr.height / 2) : null,
    navPresent: !!nav,
    navZ: nav ? getComputedStyle(nav).zIndex : null,
    overNav: nr ? at(nr.x + nr.width / 2, nr.y + nr.height / 2) : null,
    // sanity: the panel itself must still be above the scrim
    overPanelCentre: (() => {
      const p = document.querySelector('[data-radix-popper-content-wrapper]');
      if (!p) return null;
      const b = p.getBoundingClientRect();
      return at(b.x + b.width / 2, b.y + 40);
    })(),
  };
  scrim.style.pointerEvents = prevPe;
  return out;
})()`;

for (const { w, h } of [{ w: 375, h: 812 }, { w: 1440, h: 900 }]) {
  test(`scrim z A/B @ ${w}`, async ({ page, context, baseURL }) => {
    test.setTimeout(900_000);
    mkdirSync(OUT, { recursive: true });
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await context.addInitScript(() => {
      try {
        localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
        localStorage.setItem("helpr_welcomed", "1");
      } catch { /* noop */ }
    });
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules });
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    await page.locator('button[aria-label^="Notifications"]').first().click({ timeout: 20000 });
    await page.waitForTimeout(1000);

    const geo = await page.evaluate(() => {
      const dock = document.querySelector('.mobile-nav-frame');
      const nav = document.querySelector('.glass-nav');
      const r = (e: Element | null) => e ? (({ x, y, width, height }) => ({ x, y, width, height }))(e.getBoundingClientRect()) : null;
      return { dock: r(dock), nav: r(nav) };
    });

    const shots: Record<string, Buffer> = {};
    const report: Record<string, unknown> = { size: `${w}x${h}`, geo };
    for (const z of ["40", "50"]) {
      report[`z${z}`] = await page.evaluate(AB(z));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/z${z}-notifications-${w}.png` });
      if (geo.dock && geo.dock.width > 0 && geo.dock.height > 0) {
        shots[`dock${z}`] = await page.screenshot({
          clip: { x: geo.dock.x, y: geo.dock.y, width: geo.dock.width, height: geo.dock.height },
        });
      }
      if (geo.nav && geo.nav.width > 0 && geo.nav.height > 0) {
        shots[`nav${z}`] = await page.screenshot({
          clip: { x: geo.nav.x, y: geo.nav.y, width: geo.nav.width, height: geo.nav.height },
        });
      }
    }
    report.dockPixelsDifferBetweenZ = shots.dock40 && shots.dock50 ? !shots.dock40.equals(shots.dock50) : null;
    report.navPixelsDifferBetweenZ = shots.nav40 && shots.nav50 ? !shots.nav40.equals(shots.nav50) : null;

    console.log(`\n===== Z EVIDENCE ${w} =====\n` + JSON.stringify(report, null, 2));
    expect(report).toBeTruthy();
  });
}
