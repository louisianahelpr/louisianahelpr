import { chromium } from "playwright";
const BASE = process.argv[2] || "http://localhost:8082";
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
await ctx.addInitScript(() => {
  localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
  sessionStorage.setItem("helpr.browseView", "map");
});
const page = await ctx.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(`${BASE}/browse`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="browse-map-surface"]', { timeout: 30000 });
await page.waitForTimeout(6000);

const info = await page.evaluate(() => {
  const pins = [...document.querySelectorAll(".browse-map-pin")];
  return pins.slice(0, 20).map((p) => {
    const r = p.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      job: p.dataset.jobId?.slice(0, 8),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      visible: r.width > 0 && r.height > 0 && r.y > 0 && r.y < innerHeight,
      topIsPin: !!top?.closest(".browse-map-pin"),
      topTag: top?.tagName, topClass: (top?.className || "").toString().slice(0, 60),
      parentDisplay: getComputedStyle(p.parentElement).display,
      pointerEvents: getComputedStyle(p).pointerEvents,
    };
  });
});
console.log(JSON.stringify(info, null, 2));

// Try a real click on the first pin whose centre hit-tests to itself.
const idx = info.findIndex((p) => p.topIsPin);
console.log("clickable pin index:", idx);
if (idx >= 0) {
  const p = info[idx];
  await page.mouse.click(p.x + p.w / 2, p.y + p.h / 2);
  await page.waitForTimeout(1500);
  console.log("sheet after mouse click:", await page.locator('[data-testid="browse-map-preview"]').count());
}
if ((await page.locator('[data-testid="browse-map-preview"]').count()) === 0) {
  const r = await page.evaluate(() => {
    const p = document.querySelector(".browse-map-pin");
    p.click();
    return "dispatched";
  });
  await page.waitForTimeout(1200);
  console.log("dispatch .click():", r, "sheet:", await page.locator('[data-testid="browse-map-preview"]').count());
}
await page.screenshot({ path: "/tmp/lh-map-shots/debug.png" });
await browser.close();
