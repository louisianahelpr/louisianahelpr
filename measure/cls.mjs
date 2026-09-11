import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const port = process.argv[2];
const label = process.argv[3];
const sess = JSON.parse(fs.readFileSync(new URL("./session.json", import.meta.url)));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
});
await ctx.addInitScript(({ key, val }) => {
  try { window.localStorage.setItem(key, val); } catch {}
  try { window.localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] })); } catch {}
  window.__shifts = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__shifts.push({ t: Math.round(e.startTime), v: e.value,
        srcs: (e.sources||[]).map(s => (s.node && s.node.nodeName ? s.node.nodeName : "?") + "." + ((s.node && s.node.className && String(s.node.className).slice(0,40)) || "")) });
    }
  }).observe({ type: "layout-shift", buffered: true });
}, { key: sess.key, val: sess.value });

const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await cdp.send("Network.emulateNetworkConditions", {
  offline: false, latency: 400, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8,
});
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

const shots = [];
await page.goto(`http://localhost:${port}/profile`, { waitUntil: "commit" });

// early frame: as soon as the settings card exists
try { await page.waitForSelector("text=Payout", { timeout: 20000 }); } catch {}
const early = `/tmp/shot-${label}-early.png`;
await page.screenshot({ path: early }); shots.push(early);

await page.waitForTimeout(9000);
const late = `/tmp/shot-${label}-late.png`;
await page.screenshot({ path: late }); shots.push(late);

const shifts = await page.evaluate(() => window.__shifts);
const cls = shifts.reduce((a, s) => a + s.v, 0);
const slot = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find(x => /Finish setting up|couldn't check your payout/.test(x.textContent||""));
  return b ? { h: b.getBoundingClientRect().height, text: b.textContent.slice(0,40) } : null;
});
console.log(JSON.stringify({ label, cls: +cls.toFixed(4), n: shifts.length, shifts, slot, shots }, null, 1));
await browser.close();
