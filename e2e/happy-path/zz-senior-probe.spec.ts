/**
 * SCRATCH probe — senior-mode / reduced-transparency measurement sweep.
 * Untracked, not part of the suite contract. Delete after the audit lane.
 *
 * Run:  HAPPY_PATH_BASE_URL=http://127.0.0.1:5199 npx playwright test \
 *         e2e/happy-path/zz-senior-probe.spec.ts --project=happy-path --reporter=line
 */
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "/tmp/lh-senior";
mkdirSync(OUT, { recursive: true });

const WIDTHS = [320, 375] as const;

const ROUTES = [
  { name: "dashboard", url: "/dashboard" },
  { name: "jobs", url: "/jobs" },
  { name: "browse", url: "/browse" },
  { name: "messages", url: "/messages" },
  { name: "my-jobs", url: "/my-jobs" },
  { name: "my-posts", url: "/my-posts" },
  { name: "activity", url: "/activity" },
  { name: "analytics", url: "/analytics" },
  { name: "settings", url: "/settings" },
  { name: "profile-notifications", url: "/profile?tab=notifications" },
  { name: "profile-accessibility", url: "/profile?tab=accessibility" },
  { name: "profile-availability", url: "/profile?tab=availability" },
  { name: "profile-referral", url: "/profile?tab=referral" },
  { name: "profile-subscription", url: "/profile?tab=subscription" },
  { name: "profile-security", url: "/profile?tab=security" },
  { name: "profile-payment", url: "/profile?tab=payment" },
  { name: "post-job", url: "/post-job" },
  { name: "profile-landing", url: "/profile" },
];

async function setSenior(page: Page, on: boolean) {
  await page.addInitScript((v) => {
    try { localStorage.setItem("helpr_simple_mode", v ? "1" : "0"); } catch { /* noop */ }
  }, on);
}

/** Collect every control + every truncating text node on the current page. */
const PROBE = () => {
  const ellipsisOf = (el: Element) => getComputedStyle(el).textOverflow;
  const rows: Record<string, unknown>[] = [];

  // -- controls -----------------------------------------------------------
  const controls = document.querySelectorAll<HTMLElement>(
    'button, a[role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"]',
  );
  const seen = new Map<string, { w: number; h: number; n: number }>();
  controls.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const role = el.getAttribute("role") || (el as HTMLInputElement).type || el.tagName.toLowerCase();
    const key = `${role}|${Math.round(r.width)}x${Math.round(r.height)}`;
    const prev = seen.get(key);
    if (prev) prev.n += 1;
    else seen.set(key, { w: Math.round(r.width), h: Math.round(r.height), n: 1 });
  });
  const controlRows = [...seen.entries()].map(([k, v]) => ({ key: k, ...v }));

  // switch thumbs, specifically
  const switches = [...document.querySelectorAll<HTMLElement>('[role="switch"]')].map((el) => {
    const r = el.getBoundingClientRect();
    const thumb = el.firstElementChild as HTMLElement | null;
    const tr = thumb?.getBoundingClientRect();
    return {
      label: (el.getAttribute("aria-label") || el.id || el.textContent || "").slice(0, 40).trim(),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      thumb: tr ? `${tr.width.toFixed(0)}x${tr.height.toFixed(0)}` : null,
      minH: getComputedStyle(el).minHeight,
    };
  });
  const checkboxes = [...document.querySelectorAll<HTMLElement>('[role="checkbox"], input[type="checkbox"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), minH: getComputedStyle(el).minHeight,
             cls: el.className.toString().slice(0, 80) };
  });
  const radios = [...document.querySelectorAll<HTMLElement>('[role="radio"], input[type="radio"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), minH: getComputedStyle(el).minHeight,
             cls: el.className.toString().slice(0, 80) };
  });

  // -- truncation ---------------------------------------------------------
  document.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const over = el.scrollWidth - el.clientWidth;
    if (over <= 1) return;
    if (el.clientWidth === 0) return;
    const cs = getComputedStyle(el);
    if (cs.overflowX === "auto" || cs.overflowX === "scroll") return; // deliberate scroller
    const txt = (el.textContent || "").trim().slice(0, 48);
    if (!txt) return;
    rows.push({
      tag: el.tagName.toLowerCase(),
      cls: el.className.toString().slice(0, 110),
      text: txt,
      over,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      ellipsis: ellipsisOf(el),
      overflowX: cs.overflowX,
      fontSize: cs.fontSize,
    });
  });

  return {
    rootLen: (document.getElementById("root")?.innerHTML || "").length,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    seniorClass: document.documentElement.classList.contains("senior-mode"),
    controlRows,
    switches,
    checkboxes,
    radios,
    truncation: rows.sort((a, b) => (b.over as number) - (a.over as number)).slice(0, 25),
  };
};

for (const senior of [false, true]) {
  for (const w of WIDTHS) {
    test(`sweep ${w} ${senior ? "on" : "off"}`, async ({ customerPage }) => {
      test.setTimeout(300_000);
      const page = customerPage;
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
      await setSenior(page, senior);
      await page.setViewportSize({ width: w, height: 780 });
      const result: Record<string, unknown> = {};
      for (const r of ROUTES) {
        const cell = `${r.name}|${w}|${senior ? "on" : "off"}`;
        try {
          await page.goto(r.url, { waitUntil: "domcontentloaded" });
          // vite dev compiles routes lazily; a fresh context needs longer than a
          // warm one. Wait for the route's controls to actually exist.
          await page
            .waitForFunction(
              () =>
                document.querySelectorAll(
                  'button, a[role="button"], [role="tab"], [role="switch"]',
                ).length > 1,
              null,
              { timeout: 15_000 },
            )
            .catch(() => {});
          await page.waitForTimeout(900);
          // App.tsx strips the device-local class on mount (finding 1). Force
          // it back so this sweep measures the senior-mode CSS, not the bug.
          await page.evaluate((on) => {
            document.documentElement.classList.toggle("senior-mode", on);
          }, senior);
          await page.waitForTimeout(250);
          result[cell] = await page.evaluate(PROBE);
        } catch (e) {
          result[cell] = { error: String(e).slice(0, 120) };
        }
      }
      writeFileSync(
        `${OUT}/sweep-${process.env.LH_TAG || "run"}-${w}-${senior ? "on" : "off"}.json`,
        JSON.stringify({ pageErrors: errors.slice(0, 10), cells: result }, null, 1),
      );
      expect(Object.keys(result).length).toBe(ROUTES.length);
    });
  }
}

test("boot trace", async ({ customerPage }) => {
  test.setTimeout(120_000);
  const page = customerPage;
  await page.addInitScript(() => {
    try { localStorage.setItem("helpr_simple_mode", "1"); } catch { /* noop */ }
    const w = window as unknown as { __tokTrace: unknown[] };
    w.__tokTrace = [];
    const t0 = performance.now();
    const orig = DOMTokenList.prototype.toggle;
    DOMTokenList.prototype.toggle = function (this: DOMTokenList, tok: string, force?: boolean) {
      const out = orig.call(this, tok, force);
      if (tok === "senior-mode") {
        const stack = (new Error().stack || "").split("\n").slice(1, 5).join(" | ");
        w.__tokTrace.push({ t: Math.round(performance.now() - t0), force, result: out, stack });
      }
      return out;
    };
  });
  await page.setViewportSize({ width: 375, height: 780 });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const trace = await page.evaluate(() => ({
    calls: (window as unknown as { __tokTrace: unknown[] }).__tokTrace,
    finalClass: document.documentElement.classList.contains("senior-mode"),
    ds11: (() => {
      const el = document.querySelector(".text-ds-11");
      return el ? getComputedStyle(el).fontSize : "none-on-page";
    })(),
  }));
  writeFileSync(`${OUT}/boot-${process.env.LH_TAG || "run"}.json`, JSON.stringify(trace, null, 1));
  console.log(JSON.stringify(trace, null, 1));
});

test("reduced transparency", async ({ customerPage }) => {
  test.setTimeout(300_000);
  const page = customerPage;
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-transparency", value: "reduce" },
      { name: "pointer", value: "coarse" },
    ],
  });
  await page.setViewportSize({ width: 375, height: 780 });
  const out: Record<string, unknown> = {};
  for (const r of [
    { name: "dashboard", url: "/dashboard" },
    { name: "messages", url: "/messages" },
    { name: "browse", url: "/browse" },
    { name: "landing", url: "/" },
    { name: "profile-landing", url: "/profile" },
    { name: "activity", url: "/activity" },
  ]) {
    await page.goto(r.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1100);
    out[r.name] = await page.evaluate(() => {
      const frosted: Record<string, unknown>[] = [];
      document.querySelectorAll<HTMLElement>("*").forEach((el) => {
        const cs = getComputedStyle(el);
        const bf = cs.backdropFilter || (cs as unknown as { webkitBackdropFilter: string }).webkitBackdropFilter;
        if (!bf || bf === "none") return;
        const r2 = el.getBoundingClientRect();
        if (r2.width < 8 || r2.height < 8) return;
        frosted.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className.toString().slice(0, 90),
          backdropFilter: bf,
          inline: !!(el.getAttribute("style") || "").match(/backdrop-filter/i),
          bg: cs.backgroundColor,
        });
      });
      return { count: frosted.length, frosted: frosted.slice(0, 40) };
    });
  }
  writeFileSync(`${OUT}/rt-${process.env.LH_TAG || "run"}.json`, JSON.stringify(out, null, 1));
});
