/**
 * SCRATCH probe — senior-mode / reduced-transparency measurement sweep.
 * Untracked scaffolding for the accessibility audit lane; not a suite contract.
 *
 * Run:  HAPPY_PATH_BASE_URL=http://127.0.0.1:5201 LH_TAG=before \
 *         npx playwright test e2e/happy-path/zz-senior-probe.spec.ts \
 *         --project=happy-path --reporter=line --workers=1
 */
import {
  test,
  expect,
  FAKE_CUSTOMER,
  installSupabaseMocks,
  seedAuthedSession,
} from "./fixtures";
import type { Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";

// Scratch measurement tooling for the accessibility audit lane — NOT a suite
// contract. A full pass is ~15 minutes of navigation and per-character range
// measurement, and CI's happy-path job runs this whole directory, so it stays
// opt-in. Run it with LH_SENIOR_PROBE=1; see the header comment for the
// invocation. Everything it proved is written up in the audit report.
test.skip(
  !process.env.LH_SENIOR_PROBE,
  "senior-mode measurement probe — set LH_SENIOR_PROBE=1 to run",
);

const OUT = "/tmp/lh-senior";
mkdirSync(OUT, { recursive: true });
const TAG = process.env.LH_TAG || "run";

const WIDTHS = [320, 375] as const;

const ROUTES = [
  { name: "dashboard", url: "/dashboard" },
  { name: "jobs", url: "/jobs" },
  { name: "browse", url: "/browse" },
  { name: "messages", url: "/messages" },
  { name: "my-jobs", url: "/my-jobs" },
  { name: "my-posts", url: "/my-posts" },
  { name: "activity", url: "/activity" },
  { name: "analytics", url: "/profile?tab=analytics" },
  { name: "settings", url: "/settings" },
  { name: "profile-notifications", url: "/profile?tab=notifications" },
  { name: "profile-accessibility", url: "/profile?tab=accessibility" },
  { name: "profile-availability", url: "/profile?tab=availability" },
  { name: "profile-referral", url: "/profile?tab=referral" },
  { name: "profile-subscription", url: "/profile?tab=subscription" },
  { name: "profile-security", url: "/profile?tab=security" },
  { name: "profile-payment", url: "/profile?tab=payment" },
  { name: "profile-saved-helpers", url: "/profile?tab=saved_helpers" },
  { name: "job-detail", url: "/jobs/10000000-0000-4000-8000-000000000001" },
  { name: "post-job", url: "/post-job" },
  { name: "profile-landing", url: "/profile" },
];

/** Everything the page can tell us about controls, clipping and frosting. */
const PROBE = () => {
  const out: Record<string, unknown> = {};

  const controls = document.querySelectorAll<HTMLElement>(
    'button, a[role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"]',
  );
  const tiny: Record<string, unknown>[] = [];
  controls.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.height < 44) {
      tiny.push({
        role: el.getAttribute("role") || el.tagName.toLowerCase(),
        h: +r.height.toFixed(1),
        w: +r.width.toFixed(1),
        cls: el.className.toString().slice(0, 70),
      });
    }
  });

  const byRole = (sel: string) =>
    [...document.querySelectorAll<HTMLElement>(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      const thumb = el.firstElementChild as HTMLElement | null;
      const tr = thumb?.getBoundingClientRect();
      return {
        label: (el.getAttribute("aria-label") || el.id || el.textContent || "")
          .slice(0, 34)
          .trim(),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
        thumb: tr ? `${tr.width.toFixed(0)}x${tr.height.toFixed(0)}` : null,
        minH: getComputedStyle(el).minHeight,
        cls: el.className.toString().slice(0, 60),
      };
    });

  // -- horizontal truncation ---------------------------------------------
  const hTrunc: Record<string, unknown>[] = [];
  // -- vertical clipping (text hidden with no affordance at all) ----------
  const vClip: Record<string, unknown>[] = [];
  document.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const cs = getComputedStyle(el);
    const txt = (el.textContent || "").trim();
    if (!txt) return;
    if (el.clientWidth === 0) return;

    const overX = el.scrollWidth - el.clientWidth;
    if (overX > 1 && cs.overflowX !== "auto" && cs.overflowX !== "scroll") {
      hTrunc.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className.toString().slice(0, 110),
        text: txt.slice(0, 48),
        over: overX,
        ellipsis: cs.textOverflow,
        fontSize: cs.fontSize,
      });
    }
    const overY = el.scrollHeight - el.clientHeight;
    if (
      overY > 1 &&
      (cs.overflowY === "hidden" || cs.overflow === "hidden") &&
      el.clientHeight > 0
    ) {
      vClip.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className.toString().slice(0, 110),
        text: txt.slice(0, 48),
        over: overY,
        clientH: el.clientHeight,
      });
    }
  });

  out.rootLen = (document.getElementById("root")?.innerHTML || "").length;
  out.docOverflow =
    document.documentElement.scrollWidth - document.documentElement.clientWidth;
  out.seniorClass = document.documentElement.classList.contains("senior-mode");
  out.tinyControls = tiny;
  out.switches = byRole('[role="switch"]');
  out.checkboxes = byRole('[role="checkbox"], input[type="checkbox"]');
  out.radios = byRole('[role="radio"], input[type="radio"]');
  out.hTrunc = hTrunc.sort((a, b) => (b.over as number) - (a.over as number)).slice(0, 40);
  out.vClip = vClip.sort((a, b) => (b.over as number) - (a.over as number)).slice(0, 25);
  return out;
};

async function settle(page: Page) {
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
  // Profile tab panels are lazy — a route can satisfy the check above with
  // just its chrome while the panel is still resolving. Wait for the DOM to
  // stop growing instead of guessing a fixed delay.
  let prev = -1;
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(400);
    const len = await page.evaluate(
      () => (document.getElementById("root")?.innerHTML || "").length,
    );
    if (len === prev && len > 3000) break;
    prev = len;
  }
  await page.waitForTimeout(400);
}

for (const senior of [false, true]) {
  for (const w of WIDTHS) {
    test(`sweep ${w} ${senior ? "on" : "off"}`, async ({ context, page, baseURL }) => {
      test.setTimeout(600_000);
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
      await page.setViewportSize({ width: w, height: 780 });

      const cells: Record<string, unknown> = {};
      for (const r of ROUTES) {
        const cell = `${r.name}|${w}|${senior ? "on" : "off"}`;
        try {
          await page.goto(r.url, { waitUntil: "domcontentloaded" });
          await settle(page);
          // App.tsx strips the device-local class on mount (finding 1). Force
          // it so this sweep measures the senior-mode CSS, not that bug.
          await page.evaluate((on) => {
            document.documentElement.classList.toggle("senior-mode", on);
          }, senior);
          await page.waitForTimeout(300);
          cells[cell] = await page.evaluate(PROBE);
        } catch (e) {
          cells[cell] = { error: String(e).slice(0, 140) };
        }
      }
      writeFileSync(
        `${OUT}/sweep-${TAG}-${w}-${senior ? "on" : "off"}.json`,
        JSON.stringify({ pageErrors: pageErrors.slice(0, 8), cells }, null, 1),
      );
      expect(Object.keys(cells).length).toBe(ROUTES.length);
    });
  }
}

/**
 * Synthetic control bench — the three Radix control shapes rendered against
 * the real stylesheet, measured with the class off and on. This is the only
 * way to measure the `min-h-[52px]` radio without finding a route that both
 * renders one and seeds it.
 */
test("control bench", async ({ context, page, baseURL }) => {
  test.setTimeout(120_000);
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
  await page.setViewportSize({ width: 375, height: 780 });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await settle(page);

  const bench = await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "lh-bench";
    host.style.cssText = "position:absolute;top:0;left:0;width:375px;";
    host.innerHTML = `
      <button role="switch" id="b-switch" class="peer inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full">
        <span class="pointer-events-none block h-[27px] w-[27px] rounded-full"></span>
      </button>
      <button role="checkbox" id="b-checkbox" class="peer h-4 w-4 shrink-0 rounded-sm border"></button>
      <button role="radio" id="b-radio52" class="flex min-h-[52px] w-full min-w-0 flex-col items-center justify-center gap-1 px-1.5 py-2 rounded-ds-md"><span>Tier</span></button>
      <button role="radio" id="b-radio-plain" class="h-4 w-4 rounded-full border"></button>
      <button id="b-button" class="px-3">Ordinary</button>
      <a id="b-link" href="#" class="block px-3">Block link</a>
      <a id="b-linkbtn" role="button" href="#" class="block px-3">Link button</a>
      <div role="tab" id="b-tab" class="px-3">Tab</div>
    `;
    document.body.appendChild(host);

    const ids = [
      "b-switch",
      "b-checkbox",
      "b-radio52",
      "b-radio-plain",
      "b-button",
      "b-link",
      "b-linkbtn",
      "b-tab",
    ];
    const read = () =>
      Object.fromEntries(
        ids.map((id) => {
          const el = document.getElementById(id)!;
          const r = el.getBoundingClientRect();
          return [
            id,
            {
              h: +r.height.toFixed(1),
              w: +r.width.toFixed(1),
              minH: getComputedStyle(el).minHeight,
            },
          ];
        }),
      );

    document.documentElement.classList.remove("senior-mode");
    const off = read();
    document.documentElement.classList.add("senior-mode");
    const on = read();
    document.documentElement.classList.remove("senior-mode");
    host.remove();
    return { off, on };
  });

  writeFileSync(`${OUT}/bench-${TAG}.json`, JSON.stringify(bench, null, 1));
  console.log("BENCH " + JSON.stringify(bench));
});

test("boot trace", async ({ context, page, baseURL }) => {
  test.setTimeout(120_000);
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_simple_mode", "1");
    } catch {
      /* noop */
    }
    const w = window as unknown as { __tokTrace: unknown[] };
    w.__tokTrace = [];
    const t0 = performance.now();
    const orig = DOMTokenList.prototype.toggle;
    DOMTokenList.prototype.toggle = function (
      this: DOMTokenList,
      tok: string,
      force?: boolean,
    ) {
      const res = orig.call(this, tok, force);
      if (tok === "senior-mode") {
        const stack = (new Error().stack || "").split("\n").slice(1, 4).join(" | ");
        w.__tokTrace.push({
          t: Math.round(performance.now() - t0),
          force,
          result: res,
          stack,
        });
      }
      return res;
    };
  });
  await page.setViewportSize({ width: 375, height: 780 });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const trace = await page.evaluate(() => ({
    calls: (window as unknown as { __tokTrace: unknown[] }).__tokTrace,
    finalClass: document.documentElement.classList.contains("senior-mode"),
    storedPref: localStorage.getItem("helpr_simple_mode"),
    ds11: (() => {
      const el = document.querySelector(".text-ds-11");
      return el ? getComputedStyle(el).fontSize : "none-on-page";
    })(),
  }));
  writeFileSync(`${OUT}/boot-${TAG}.json`, JSON.stringify(trace, null, 1));
  console.log("BOOT " + JSON.stringify(trace, null, 1));
});

test("reduced transparency", async ({ context, page, baseURL }) => {
  test.setTimeout(300_000);
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
  const client = await context.newCDPSession(page);
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
    { name: "job-detail", url: "/jobs/10000000-0000-4000-8000-000000000001" },
  ]) {
    await page.goto(r.url, { waitUntil: "domcontentloaded" });
    await settle(page);
    out[r.name] = await page.evaluate(() => {
      const frosted: Record<string, unknown>[] = [];
      document.querySelectorAll<HTMLElement>("*").forEach((el) => {
        const cs = getComputedStyle(el);
        const bf =
          cs.backdropFilter ||
          (cs as unknown as { webkitBackdropFilter: string }).webkitBackdropFilter;
        if (!bf || bf === "none") return;
        const box = el.getBoundingClientRect();
        if (box.width < 8 || box.height < 8) return;
        frosted.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className.toString().slice(0, 80),
          backdropFilter: bf,
          inline: /backdrop-filter/i.test(el.getAttribute("style") || ""),
          bg: cs.backgroundColor,
        });
      });
      return { count: frosted.length, frosted: frosted.slice(0, 40) };
    });
  }
  writeFileSync(`${OUT}/rt-${TAG}.json`, JSON.stringify(out, null, 1));
  console.log(
    "RT counts " +
      JSON.stringify(
        Object.fromEntries(
          Object.entries(out).map(([k, v]) => [k, (v as { count: number }).count]),
        ),
      ),
  );
});

/** Visual proof at both widths, senior off and on, for the most-affected routes. */
test("shots", async ({ context, page, baseURL }) => {
  test.setTimeout(600_000);
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
  mkdirSync(`${OUT}/shots`, { recursive: true });
  for (const w of [320, 375]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const r of [
      { name: "messages", url: "/messages" },
      { name: "activity", url: "/activity" },
      { name: "profile-subscription", url: "/profile?tab=subscription" },
      { name: "profile-notifications", url: "/profile?tab=notifications" },
      { name: "profile-landing", url: "/profile" },
      { name: "dashboard", url: "/dashboard" },
    ]) {
      for (const senior of [false, true]) {
        await page.goto(r.url, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.evaluate((on) => {
          document.documentElement.classList.toggle("senior-mode", on);
        }, senior);
        await page.waitForTimeout(400);
        await page.screenshot({
          path: `${OUT}/shots/${r.name}-${w}-${senior ? "on" : "off"}.png`,
          fullPage: false,
        });
      }
    }
  }
});

/**
 * The non-negotiable, measured directly: for every clamped/truncated text node,
 * count the characters actually VISIBLE inside its content box with the class
 * off, then again with it on, on the SAME page load and the SAME elements.
 * Senior Mode must never show fewer.
 */
const VISCOUNT = () => {
  const els = [
    ...document.querySelectorAll<HTMLElement>(
      '.truncate, [class*="line-clamp-"]',
    ),
  ].filter((el) => {
    const t = (el.textContent || "").trim();
    const r = el.getBoundingClientRect();
    return t.length > 1 && t.length < 300 && r.width > 8 && r.height > 4;
  });

  const visibleChars = (el: HTMLElement): number => {
    const box = el.getBoundingClientRect();
    const maxR = box.left + el.clientWidth + 1.5;
    const maxB = box.top + el.clientHeight + 1.5;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n = 0;
    let node: Node | null;
    const range = document.createRange();
    while ((node = walker.nextNode())) {
      const len = (node.nodeValue || "").length;
      for (let i = 0; i < len; i++) {
        try {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right <= maxR && r.bottom <= maxB) n++;
        } catch {
          /* detached node */
        }
      }
    }
    return n;
  };

  return els.map((el, i) => ({
    i,
    cls: el.className.toString().slice(0, 80),
    total: (el.textContent || "").trim().length,
    vis: visibleChars(el),
  }));
};

test("text visibility", async ({ context, page, baseURL }) => {
  test.setTimeout(900_000);
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
  const out: Record<string, unknown> = {};
  for (const w of [320, 375]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const r of ROUTES) {
      try {
        await page.goto(r.url, { waitUntil: "domcontentloaded" });
        await settle(page);
        await page.evaluate(() =>
          document.documentElement.classList.remove("senior-mode"),
        );
        await page.waitForTimeout(250);
        const off = await page.evaluate(VISCOUNT);
        await page.evaluate(() =>
          document.documentElement.classList.add("senior-mode"),
        );
        await page.waitForTimeout(350);
        const on = await page.evaluate(VISCOUNT);
        await page.evaluate(() =>
          document.documentElement.classList.remove("senior-mode"),
        );
        out[`${r.name}|${w}`] = { off, on };
      } catch (e) {
        out[`${r.name}|${w}`] = { error: String(e).slice(0, 120) };
      }
    }
  }
  writeFileSync(`${OUT}/vis-${TAG}.json`, JSON.stringify(out, null, 1));
});

test("axe", async ({ context, page, baseURL }) => {
  test.setTimeout(900_000);
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
  const out: Record<string, unknown> = {};
  for (const senior of [false, true]) {
    for (const r of [
      { name: "profile-saved-helpers", url: "/profile?tab=saved_helpers" },
      { name: "profile-referral", url: "/profile?tab=referral" },
      { name: "profile-subscription", url: "/profile?tab=subscription" },
      { name: "analytics", url: "/profile?tab=analytics" },
      { name: "profile-notifications", url: "/profile?tab=notifications" },
      { name: "profile-landing", url: "/profile" },
      { name: "messages", url: "/messages" },
      { name: "dashboard", url: "/dashboard" },
    ]) {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(r.url, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.evaluate((on) => {
        document.documentElement.classList.toggle("senior-mode", on);
      }, senior);
      await page.waitForTimeout(400);
      const res = await new AxeBuilder({ page }).analyze();
      const diag = await page.evaluate(() => ({
        rootLen: (document.getElementById("root")?.innerHTML || "").length,
        headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
          .map((h) => h.tagName + ":" + (h.textContent || "").trim().slice(0, 22))
          .slice(0, 14),
        interactiveInInteractive: document.querySelectorAll(
          'a button, button button, a a, button a, [role="button"] button',
        ).length,
      }));
      out[`${r.name}|${senior ? "on" : "off"}|diag`] = diag;
      out[`${r.name}|${senior ? "on" : "off"}`] = res.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        detail: v.nodes.slice(0, 2).map((n) => (n.failureSummary || "").slice(0, 150)),
        targets: v.nodes.slice(0, 3).map((n) => String(n.target[0]).slice(0, 90)),
      }));
    }
  }
  writeFileSync(`${OUT}/axe-${TAG}.json`, JSON.stringify(out, null, 1));
});
