// Throwaway verification harness for the browse-map preview sheet rework.
// Renders /browse in map view at 320/375/768/1440, opens a pin preview, and
// makes MEASURED assertions (elementFromPoint hit-testing, overflow, rail
// placement) rather than eyeballing screenshots.
//
// Usage: node scripts/e2e/map-preview-check.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:5199";
const OUT = "/tmp/lh-map-shots";
mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { w: 320, h: 720, label: "320" },
  { w: 375, h: 812, label: "375" },
  { w: 768, h: 1024, label: "768" },
  { w: 1440, h: 900, label: "1440" },
];

// Long title + 4-digit price — the collision case the owner called out.
const LONG = process.env.LONG_TITLE === "1";

// Optional authed session (scripts/test-signin-link.mjs helper --session --json).
// The desktop rail and the bottom dock only render for a signed-in user, so the
// 1440 rail check and the "is anything trapped under the dock" check need one.
const SESSION = process.env.LH_SESSION_FILE
  ? JSON.parse(readFileSync(process.env.LH_SESSION_FILE, "utf8"))
  : null;
const ROUTE = process.env.LH_ROUTE || "/browse";

const results = [];

const browser = await chromium.launch({ channel: "chrome" });

for (const { w, h, label } of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript((sess) => {
    localStorage.setItem(
      "helpr_onboarding",
      JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
    );
    sessionStorage.setItem("helpr.browseView", "map");
    if (sess) localStorage.setItem(sess.key, sess.value);
  }, SESSION);
  const page = await ctx.newPage();
  if (LONG) {
    // Worst case the owner named: a long title and a 4-digit price. Rewritten
    // at the network layer so it travels the real RPC → MapJob → JobCard path.
    await page.route(/get_open_jobs_for_map/, async (route) => {
      const res = await route.fetch();
      let rows;
      try { rows = JSON.parse(await res.text()); } catch { return route.fulfill({ response: res }); }
      if (Array.isArray(rows)) {
        for (const r of rows) {
          r.title = "Two dogs plus one very anxious rescue cat need weekend drop-in visits, feeding and a long evening walk";
          r.budget = 1234;
          r.is_urgent = true;
          r.urgent_fee = 25;
        }
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    });
  }
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: "domcontentloaded" });

  // Wait for the map surface (MapKit needs its token + script).
  await page.waitForSelector('[data-testid="browse-map-surface"]', { timeout: 30000 });
  await page.waitForTimeout(6000);

  const pinCount = await page.locator(".browse-map-pin").count();
  const clusterCount = await page.locator(".browse-map-cluster").count();

  // Open a preview with a REAL pointer click on a pin whose centre actually
  // hit-tests to itself (MapKit stacks clustered pins under the bubble).
  const target = await page.evaluate(() => {
    for (const p of document.querySelectorAll(".browse-map-pin")) {
      const r = p.getBoundingClientRect();
      if (r.width === 0 || r.y < 0 || r.bottom > innerHeight) continue;
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      if (document.elementFromPoint(cx, cy)?.closest(".browse-map-pin") === p) {
        return { cx, cy, jobId: p.dataset.jobId, name: p.getAttribute("aria-label") };
      }
    }
    return null;
  });
  let opened = false;
  if (target) {
    await page.mouse.click(target.cx, target.cy);
    opened = await page
      .waitForSelector('[data-testid="browse-map-preview"]', { timeout: 6000 })
      .then(() => true)
      .catch(() => false);
  }
  if (opened) await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => {
    const out = {};
    const doc = document.documentElement;
    out.overflow = { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    const widest = [...document.querySelectorAll("*")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > doc.clientWidth + 1)
      .slice(0, 3)
      .map((x) => `${x.el.tagName}.${(x.el.className || "").toString().slice(0, 60)} w=${Math.round(x.r.width)}`);
    out.tooWide = widest;

    const sheet = document.querySelector('[data-testid="browse-map-preview"]');
    if (!sheet) return { ...out, sheet: null };
    const sr = sheet.getBoundingClientRect();
    out.sheet = { x: sr.x, y: sr.y, w: sr.width, h: sr.height, bottom: sr.bottom };

    const close = document.querySelector('[data-testid="browse-map-preview-close"]');
    const cr = close.getBoundingClientRect();
    out.close = {
      w: cr.width,
      h: cr.height,
      cx: cr.x + cr.width / 2,
      cy: cr.y + cr.height / 2,
    };
    const atClose = document.elementFromPoint(out.close.cx, out.close.cy);
    out.elementFromPointAtCloseCentre = {
      tag: atClose?.tagName,
      testid: atClose?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      isCloseControl: !!atClose?.closest('[data-testid="browse-map-preview-close"]'),
      ariaLabel: atClose?.closest("button")?.getAttribute("aria-label") ?? null,
    };

    // The price chip inside the reused JobCard.
    const priceEl =
      sheet.querySelector('[data-testid="job-price"]') ||
      [...sheet.querySelectorAll("span,div")].find(
        (el) => /^\$?[\d,]+$/.test((el.textContent || "").trim()) && el.children.length <= 2 && el.getBoundingClientRect().width > 20,
      );
    if (priceEl) {
      const pr = priceEl.getBoundingClientRect();
      out.price = { text: priceEl.textContent.trim().slice(0, 20), w: pr.width, h: pr.height, cx: pr.x + pr.width / 2, cy: pr.y + pr.height / 2 };
      const atPrice = document.elementFromPoint(out.price.cx, out.price.cy);
      out.elementFromPointAtPriceCentre = {
        tag: atPrice?.tagName,
        text: (atPrice?.textContent || "").trim().slice(0, 24),
        isCloseControl: !!atPrice?.closest('[data-testid="browse-map-preview-close"]'),
        insidePrice: priceEl.contains(atPrice) || atPrice === priceEl,
      };
      // Do the close button and the price chip overlap at all?
      const c = close.getBoundingClientRect();
      out.closePriceOverlap =
        !(c.right <= pr.left || c.left >= pr.right || c.bottom <= pr.top || c.top >= pr.bottom);
    }

    // Title box
    const title = sheet.querySelector("h2");
    if (title) {
      const tr = title.getBoundingClientRect();
      const c = close.getBoundingClientRect();
      out.title = { text: title.textContent.trim().slice(0, 40), w: tr.width, lines: Math.round(tr.height / parseFloat(getComputedStyle(title).lineHeight || "20")) };
      out.closeTitleOverlap =
        !(c.right <= tr.left || c.left >= tr.right || c.bottom <= tr.top || c.top >= tr.bottom);
    }

    // Recenter button vs sheet
    const rc = document.querySelector('[data-testid="browse-map-recenter"]');
    if (rc) {
      const rr = rc.getBoundingClientRect();
      out.recenter = { w: rr.width, h: rr.height, x: rr.x, y: rr.y, bottom: rr.bottom, cx: rr.x + rr.width / 2, cy: rr.y + rr.height / 2 };
      const atRc = document.elementFromPoint(out.recenter.cx, out.recenter.cy);
      out.elementFromPointAtRecentreCentre = {
        isRecentre: !!atRc?.closest('[data-testid="browse-map-recenter"]'),
        tag: atRc?.tagName,
        label: atRc?.closest("button")?.getAttribute("aria-label") ?? null,
      };
      out.recenterSheetOverlap = out.sheet
        ? !(rr.right <= sr.left || rr.left >= sr.right || rr.bottom <= sr.top || rr.top >= sr.bottom)
        : false;
    }

    // Map pane geometry (for the 1440 rail check)
    const pane = document.querySelector('[data-testid="browse-map-surface"]');
    if (pane) {
      const pr2 = pane.getBoundingClientRect();
      out.pane = { x: pr2.x, w: pr2.width, right: pr2.right };
    }
    out.railWidth = getComputedStyle(doc).getPropertyValue("--desktop-sidebar-w").trim();
    out.bottomNavH = getComputedStyle(doc).getPropertyValue("--bottom-nav-h").trim() || "(unset → 96px)";
    out.htmlClass = doc.className;

    // Item 5 — is anything interactive trapped under the bottom dock?
    const dock = document.querySelector("nav[class*='fixed'], [data-testid='mobile-nav'], nav");
    const dr = dock?.getBoundingClientRect();
    if (dr && dr.height) {
      out.dock = { y: dr.y, h: dr.height, bottom: dr.bottom, tag: dock.tagName };
      // Sample a grid of points across the band the dock covers and see what
      // the topmost element is: if a pin or a control answers, it is reachable;
      // if the dock answers, whatever is under it is not.
      const trapped = [];
      for (let x = 12; x < innerWidth - 12; x += 24) {
        for (let y = dr.y + 4; y < Math.min(dr.bottom, innerHeight) - 4; y += 12) {
          const top = document.elementFromPoint(x, y);
          if (!top) continue;
          const pin = top.closest(".browse-map-pin, .browse-map-cluster");
          if (pin) trapped.push({ x, y, name: pin.getAttribute("aria-label") });
        }
      }
      out.pinsReachableInDockBand = trapped.slice(0, 5);
      // Are any pins geometrically inside the dock band at all?
      out.pinsInsideDockBand = [...document.querySelectorAll(".browse-map-pin, .browse-map-cluster")]
        .filter((p) => { const r = p.getBoundingClientRect(); return r.height && r.bottom > dr.y && r.top < dr.bottom; })
        .map((p) => p.getAttribute("aria-label"))
        .slice(0, 6);
    }
    return out;
  });

  // Accessible names on pins + clusters
  const a11y = await page.evaluate(() => {
    const pins = [...document.querySelectorAll(".browse-map-pin")];
    const clusters = [...document.querySelectorAll(".browse-map-cluster")];
    const describe = (el) => ({
      role: el.getAttribute("role"),
      tabindex: el.getAttribute("tabindex"),
      name: el.getAttribute("aria-label"),
    });
    return {
      pins: pins.length,
      clusters: clusters.length,
      pinsWithName: pins.filter((p) => p.getAttribute("aria-label")).length,
      pinsFocusable: pins.filter((p) => p.getAttribute("tabindex") === "0").length,
      clustersWithName: clusters.filter((p) => p.getAttribute("aria-label")).length,
      clustersFocusable: clusters.filter((p) => p.getAttribute("tabindex") === "0").length,
      samplePin: pins[0] ? describe(pins[0]) : null,
      sampleCluster: clusters[0] ? describe(clusters[0]) : null,
    };
  });

  const shot = `${OUT}/map-${label}${LONG ? "-long" : ""}.png`;
  await page.screenshot({ path: shot });

  results.push({ label, w, pinCount, clusterCount, opened, target, shot, probe, a11y, consoleErrors: consoleErrors.slice(0, 5) });
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
