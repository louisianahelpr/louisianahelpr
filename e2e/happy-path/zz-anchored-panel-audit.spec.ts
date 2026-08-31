import { test, expect, installSupabaseMocks, seedAuthedSession, FAKE_CUSTOMER } from "./fixtures";
import type { MockRule } from "./fixtures";
import { mkdirSync } from "node:fs";

/**
 * TEMPORARY audit harness for the two anchored panels (Notifications, Filters).
 * Not a regression gate — it prints a measurement report. Delete when done.
 */

const OTHER = "00000000-0000-4000-8000-0000000000aa";
const AGO = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const OUT = "/Users/lexilombas/louisianahelpr/.claude/tmp/anchored-panel-audit";

const JOBS = Array.from({ length: 12 }, (_, i) => ({
  id: `30000000-0000-4000-8000-0000000000${String(i + 10)}`,
  title: `JOB CARD ${i + 1}`,
  description: `Task ${i + 1} description that is long enough to look real.`,
  category: "cleaning",
  budget: 100 + i,
  date_needed: "2026-09-20",
  customer_id: OTHER,
  status: "open",
  created_at: AGO(60 + i * 10),
  updated_at: AGO(60 + i * 10),
  is_urgent: false, urgent_fee: 0, is_flexible_schedule: false, is_recurring: false,
  is_group_job: false, helpers_needed: 1, estimated_hours: 2, special_requirements: null,
  photos: [], boosted_at: null, boost_expires_at: null, expires_at: null, start_time: "09:00",
  recurrence_interval: null, recurrence_end_date: null, parent_job_id: null,
  payment_status: "unpaid", location: "New Orleans, LA", pricing_mode: "fixed",
  applicant_count: 0,
}));

const NOTIFS = Array.from({ length: 24 }, (_, i) => ({
  id: `50000000-0000-4000-8000-0000000000${String(i + 10)}`,
  user_id: FAKE_CUSTOMER.id,
  type: i % 3 === 0 ? "application_received" : i % 3 === 1 ? "job_update" : "info",
  title: `Notification ${i + 1}`,
  message: `Body copy for notification ${i + 1}, long enough to wrap on a phone.`,
  body: `Body copy for notification ${i + 1}.`,
  link: null,
  read: i >= 9,
  created_at: AGO(30 + i * 45),
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

const SIZES = [
  { w: 320, h: 720 },
  { w: 375, h: 812 },
  { w: 768, h: 1024 },
  { w: 1440, h: 900 },
];

// Probe run in the page: everything we want to know about an OPEN panel.
const PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const panel = q('[data-radix-popper-content-wrapper] [role="dialog"]') || q('[data-radix-popper-content-wrapper] > *');
  const scrims = Array.from(document.querySelectorAll('div')).filter((el) => {
    const cs = getComputedStyle(el);
    return cs.position === 'fixed' && el.getBoundingClientRect().width >= window.innerWidth - 1
      && (cs.backdropFilter || '').includes('blur(24px)');
  });
  const scrim = scrims[0] || null;
  const arrow = document.querySelector('[data-radix-popper-arrow], [data-radix-popper-content-wrapper] svg[data-radix-popper-arrow], [data-radix-popper-content-wrapper] span > svg');
  const dock = document.querySelector('.mobile-nav-frame');
  const topnav = document.querySelector('.glass-nav');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
  const active = document.activeElement;
  // stacking-context ancestors of an element (what confines its z-index)
  const ctxWalk = (el) => {
    const out = [];
    let n = el && el.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const creates = cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none'
        || cs.isolation === 'isolate' || cs.willChange.includes('transform') || cs.willChange.includes('opacity')
        || cs.contain.includes('paint') || cs.contain.includes('layout')
        || (cs.opacity !== '1') || (cs.position !== 'static' && cs.zIndex !== 'auto')
        || cs.mixBlendMode !== 'normal' || cs.backdropFilter !== 'none';
      if (creates) out.push(n.tagName + (n.id ? '#' + n.id : '') + '.' + String(n.className).split(' ').filter(Boolean).slice(0,2).join('.') + ' [z=' + cs.zIndex + ' pos=' + cs.position + ']');
      n = n.parentElement;
    }
    return out;
  };
  const domIndexInBody = (el) => { if (!el) return -1; let n = el; while (n && n.parentElement !== document.body) n = n.parentElement; return n ? Array.prototype.indexOf.call(document.body.children, n) : -1; };
  return {
    url: location.href,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyOverflow: getComputedStyle(document.body).overflow,
    bodyPointerEvents: document.body.style.pointerEvents || getComputedStyle(document.body).pointerEvents,
    scrim: scrim ? {
      zIndex: getComputedStyle(scrim).zIndex,
      pointerEvents: getComputedStyle(scrim).pointerEvents,
      backgroundColor: getComputedStyle(scrim).backgroundColor,
      backdropFilter: getComputedStyle(scrim).backdropFilter || getComputedStyle(scrim).webkitBackdropFilter,
      bodyChildIndex: domIndexInBody(scrim),
      className: scrim.className,
      stackingAncestors: ctxWalk(scrim),
    } : null,
    scrimCount: scrims.length,
    panel: r(panel),
    panelZ: panel ? getComputedStyle(panel.closest('[data-radix-popper-content-wrapper]') || panel).zIndex : null,
    panelBodyChildIndex: domIndexInBody(panel),
    arrow: r(arrow),
    dock: r(dock),
    dockZ: dock ? getComputedStyle(dock).zIndex : null,
    dockBodyChildIndex: domIndexInBody(dock),
    dockStackingAncestors: dock ? ctxWalk(dock) : null,
    topnav: r(topnav),
    topnavZ: topnav ? getComputedStyle(topnav).zIndex : null,
    topnavBodyChildIndex: domIndexInBody(topnav),
    topnavStackingAncestors: topnav ? ctxWalk(topnav) : null,
    activeEl: active ? active.tagName + '[' + (active.getAttribute('aria-label') || active.getAttribute('role') || '') + ']' : null,
    activeInsidePanel: !!(panel && active && panel.contains(active)),
    bodyChildren: Array.prototype.map.call(document.body.children, (c) => c.tagName + (c.id ? '#' + c.id : '') + '.' + String(c.className).split(' ').filter(Boolean).slice(0,1).join('')),
  };
})()`;

async function reset(page: import("@playwright/test").Page) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
}

async function run(page: import("@playwright/test").Page, which: "notifications" | "filters", w: number, h: number) {
  const label = which === "notifications" ? "Notifications" : "Filters";
  const trigger = page.locator(`button[aria-label^="${label}"]`).first();
  await trigger.waitFor({ state: "visible", timeout: 15000 });
  const triggerBox = await trigger.boundingBox();
  const urlBefore = page.url();
  const step = (m: string) => console.log(`   [${w}/${which}] ${m}`);
  step("trigger found");

  // Baseline pixels of the dock strip + top nav strip, panel CLOSED.
  const dockClip = { x: 0, y: Math.max(0, h - 110), width: w, height: 100 };
  const topClip = { x: 0, y: 0, width: w, height: 56 };
  const dockClosed = await page.screenshot({ clip: dockClip });
  const topClosed = await page.screenshot({ clip: topClip });

  await trigger.click({ timeout: 20000 });
  await page.waitForTimeout(900);
  step("opened");

  const probe = await page.evaluate(PROBE) as Record<string, unknown>;
  await page.screenshot({ path: `${OUT}/${which}-${w}.png` });

  const dockOpen = await page.screenshot({ clip: dockClip });
  const topOpen = await page.screenshot({ clip: topClip });

  // ---- outside tap onto a job card ----
  const target = await page.evaluate(() => {
    const panel = document.querySelector('[data-radix-popper-content-wrapper]');
    const pr = panel ? panel.getBoundingClientRect() : null;
    const dock = document.querySelector('.mobile-nav-frame');
    const dr = dock ? dock.getBoundingClientRect() : null;
    const cards = Array.from(document.querySelectorAll('[aria-label^="View JOB"]'));
    for (const c of cards) {
      const b = c.getBoundingClientRect();
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      if (b.width < 20 || b.height < 20) continue;
      if (pr && cx > pr.left && cx < pr.right && cy > pr.top && cy < pr.bottom) continue;
      if (dr && cy > dr.top) continue;
      if (cy < 60 || cy > window.innerHeight - 10) continue;
      return { x: cx, y: cy, label: c.getAttribute('aria-label') };
    }
    return null;
  });

  step("probed + screenshots");
  let tapResult: Record<string, unknown> = { skipped: "no job card outside the panel" };
  if (target) {
    await page.mouse.click(target.x as number, target.y as number);
    await page.waitForTimeout(900);
    const stillOpen = await page.locator('[data-radix-popper-content-wrapper]').count();
    tapResult = {
      tappedOn: target.label,
      at: [Math.round(target.x as number), Math.round(target.y as number)],
      urlBefore,
      urlAfter: page.url(),
      urlChanged: page.url() !== urlBefore,
      panelStillOpen: stillOpen > 0,
      jobDialogOpened: await page.locator('[role="dialog"]:visible').count(),
    };
  }

  step("outside tap done");
  // ---- bottom-nav tap (fresh page: the previous tap may have opened a dialog) ----
  await reset(page);
  let navTap: Record<string, unknown> = { skipped: true };
  {
    await trigger.click({ timeout: 20000 });
    await page.waitForTimeout(800);
    const navTarget = await page.evaluate(() => {
      const dock = document.querySelector('.mobile-nav-frame');
      if (!dock) return null;
      const items = Array.from(dock.querySelectorAll('a,button'));
      const it = items.find((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 20 && b.height > 20 && (e.getAttribute('href') || '') !== window.location.pathname;
      }) || items[0];
      if (!it) return null;
      const b = it.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, label: (it.textContent || '').trim().slice(0, 24), href: it.getAttribute('href') };
    });
    if (navTarget) {
      const u0 = page.url();
      await page.mouse.click(navTarget.x as number, navTarget.y as number);
      await page.waitForTimeout(900);
      navTap = {
        tappedOn: navTarget.label, href: navTarget.href,
        urlBefore: u0, urlAfter: page.url(), urlChanged: page.url() !== u0,
        panelStillOpen: (await page.locator('[data-radix-popper-content-wrapper]').count()) > 0,
      };
    }
  }

  step("nav tap done");
  // ---- scroll lock + escape + focus return (fresh page again) ----
  await reset(page);
  await trigger.click({ timeout: 20000 });
  await page.waitForTimeout(800);
  const scrollBefore = await page.evaluate(() => {
    const sc = document.querySelector('.app-shell-scroll, [data-app-shell-scroll]') as HTMLElement | null;
    return { win: window.scrollY, sc: sc ? sc.scrollTop : null };
  });
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(400);
  const scrollAfter = await page.evaluate(() => {
    const sc = document.querySelector('.app-shell-scroll, [data-app-shell-scroll]') as HTMLElement | null;
    return { win: window.scrollY, sc: sc ? sc.scrollTop : null };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  const afterEsc = await page.evaluate(() => {
    const a = document.activeElement;
    const scrims = Array.from(document.querySelectorAll('div')).filter((el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && (cs.backdropFilter || '').includes('blur(24px)');
    });
    return {
      panelCount: document.querySelectorAll('[data-radix-popper-content-wrapper]').length,
      scrimCount: scrims.length,
      activeEl: a ? a.tagName + '[' + (a.getAttribute('aria-label') || '') + ']' : null,
      bodyOverflow: getComputedStyle(document.body).overflow,
      bodyPointerEvents: document.body.style.pointerEvents,
    };
  });

  step("escape done");
  return {
    size: `${w}x${h}`,
    panel: which,
    triggerBox,
    probe,
    caretOffsetFromTriggerCentre:
      triggerBox && (probe.arrow as { x: number; w: number } | null)
        ? Math.round(((probe.arrow as { x: number; w: number }).x + (probe.arrow as { x: number; w: number }).w / 2) - (triggerBox.x + triggerBox.width / 2))
        : null,
    panelOverlapsDock:
      (probe.panel as { bottom: number } | null) && (probe.dock as { top: number } | null)
        ? (probe.panel as { bottom: number }).bottom > (probe.dock as { top: number }).top
        : null,
    horizontalOverflow: (probe.scrollWidth as number) > (probe.clientWidth as number),
    dockPixelsChangedByScrim: !dockClosed.equals(dockOpen),
    topNavPixelsChangedByScrim: !topClosed.equals(topOpen),
    tapOutsideOnJobCard: tapResult,
    tapOnBottomNav: navTap,
    scrollLocked: scrollBefore.win === scrollAfter.win && scrollBefore.sc === scrollAfter.sc,
    scrollBefore, scrollAfter,
    afterEscape: afterEsc,
    focusReturnedToTrigger: (afterEsc.activeEl || "").includes(label),
  };
}

for (const { w, h } of SIZES) {
  test(`anchored panels @ ${w}`, async ({ page, context, baseURL }) => {
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

    const results = [];
    for (const which of ["notifications", "filters"] as const) {
      // Start each panel from a clean slate: no dialog, no query string.
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      console.log(`[${w}] --> ${which}`);
      try {
        results.push(await run(page, which, w, h));
      } catch (e) {
        results.push({ size: `${w}x${h}`, panel: which, error: String(e).slice(0, 400) });
      }
      console.log(`[${w}] <-- ${which} done`);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
    }
    console.log(`\n===== REPORT ${w} =====\n` + JSON.stringify(results, null, 2));
    expect(results.length).toBe(2);
  });
}
