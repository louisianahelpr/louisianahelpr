// Guides lane: screenshot the landing's Top 10 row at 375 and 1440 from a local vite preview. Service workers and every
// Supabase / PostHog / Sentry request are blocked (no prod writes).
import { chromium } from "playwright";
const base = process.argv[2];
const out = process.argv[3];
const browser = await chromium.launch();
const results = [];
for (const [w, h] of [[375, 812], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
  await ctx.route(/supabase\.co|posthog|sentry/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(`${base}/gift-guides`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-gift-top10] [data-gift-pick]", { timeout: 20000 });
  await page.waitForTimeout(1500);
  const el = page.locator("[data-gift-top10]");
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: `${out}/top10-rank-${w}.png` });
  results.push(await page.evaluate(() => ({
    w: innerWidth,
    docScroll: document.documentElement.scrollWidth,
    ranks: [...document.querySelectorAll("[data-gift-top10] [data-gift-rank]")].map((b) => b.textContent),
    names: [...document.querySelectorAll("[data-gift-top10] .gg-nm-name")].map((n) => n.textContent.slice(0, 32)),
  })));
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
