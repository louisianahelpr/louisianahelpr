// Guest-surface sweep: every signed-out route × 375/1440 × light/dark.
// Shots → shots/<slug>-<w>-<theme>.png ; measurements → shots/report.json
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:4201";
const OUT = new URL("./shots/", import.meta.url).pathname;
const ROUTES = [
  ["landing", "/"],
  ["browse", "/browse"],
  ["browse-map", "/browse?view=map"],
  ["login", "/login"],
  ["signup", "/signup"],
  ["forgot", "/forgot-password"],
  ["reset", "/reset-password"],
  ["legal-terms", "/legal?tab=terms"],
  ["legal-community", "/legal?tab=community"],
  ["legal-privacy", "/legal?tab=privacy"],
  ["support", "/support"],
  ["help", "/help"],
  ["signup-pending", "/signup-pending"],
  ["account-pending", "/account-pending"],
  ["account-denied", "/account-denied"],
  ["account-banned", "/account-banned"],
  ["enterprise-404", "/enterprise"],
  ["business-404", "/business"],
  ["pif-404", "/pay-it-forward"],
  ["notfound", "/this-does-not-exist"],
  ["gift-card-guest", "/gift-card"],
  ["job-guest", "/jobs/" + (process.env.JOB_ID || "00000000-0000-0000-0000-000000000000")],
];
const VIEWPORTS = [375, 1440];
const THEMES = ["light", "dark"];

const browser = await chromium.launch({ headless: process.env.HEADLESS === "1" });
const report = [];
for (const theme of THEMES) {
  for (const w of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: w === 375 ? 812 : 900 },
      colorScheme: theme,
      deviceScaleFactor: 1,
    });
    for (const [slug, path] of ROUTES) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
      page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 200)));
      try {
        await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const sh = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < sh; y += 500) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(150); }
        await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(600);
        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const vw = de.clientWidth;
          const wide = [];
          const clipped = [];
          const bad = [];
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            const cs = getComputedStyle(el);
            if (cs.position === "fixed" && cs.visibility === "hidden") continue;
            if (r.right > vw + 1 && cs.overflow !== "hidden" && !el.closest('[style*="overflow"]')) {
              const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 3).join(".") : "");
              wide.push(tag + " right=" + Math.round(r.right));
            }
            const isCtl = /^(BUTTON|A|SPAN|LABEL)$/.test(el.tagName) || el.getAttribute("role") === "tab";
            if (isCtl && !/sr-only/.test(el.className) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && /hidden|clip/.test(cs.overflowX + cs.overflow)) {
              clipped.push((el.textContent || "").trim().slice(0, 40) + " sw=" + el.scrollWidth + " cw=" + el.clientWidth);
            }
          }
          const txt = document.body.innerText;
          for (const s of ["NaN", "undefined", "[object Object]", "null"]) {
            if (new RegExp("(^|\\s)" + s.replace(/[[\]]/g, "\\$&") + "(\\s|$)").test(txt)) bad.push(s);
          }
          const imgs = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src.slice(-60));
          const fonts = {};
          for (const el of document.querySelectorAll("h1,h2,h3,p,button,a,span,li")) {
            const f = getComputedStyle(el).fontFamily.split(",")[0].replace(/"/g, "");
            fonts[f] = (fonts[f] || 0) + 1;
          }
          const h1 = document.querySelector("h1");
          return {
            scrollWidth: de.scrollWidth, clientWidth: vw,
            overflow: de.scrollWidth > vw,
            wide: wide.slice(0, 8), clipped: clipped.slice(0, 12), bad, brokenImgs: imgs,
            fonts, title: document.title, h1: h1 ? h1.textContent.trim().slice(0, 80) : null,
            bg: getComputedStyle(document.body).backgroundColor,
          };
        });
        const file = `${slug}-${w}-${theme}.png`;
        await page.screenshot({ path: OUT + file, fullPage: true });
        report.push({ slug, path, w, theme, finalUrl: page.url().replace(BASE, ""), file, errors: errors.slice(0, 5), ...m });
        console.log(slug, w, theme, "→", page.url().replace(BASE, ""), m.overflow ? "OVERFLOW" : "ok", m.clipped.length ? "CLIPPED:" + m.clipped.length : "", errors.length ? "ERR:" + errors.length : "");
      } catch (e) {
        report.push({ slug, path, w, theme, fatal: String(e).slice(0, 300) });
        console.log(slug, w, theme, "FATAL", String(e).slice(0, 120));
      }
      await page.close();
    }
    await ctx.close();
  }
}
fs.writeFileSync(OUT + "report.json", JSON.stringify(report, null, 2));
await browser.close();
