// Admin console sweep driver — shoots every view at 375/1440 × light/dark and measures.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";

const VIEWS = ["home","analytics","people","jobs","settings","disputes","broadcasts","notifications","notiflogs","reports","support","referrals","subscriptions","fraud","audit","health","export","payouts","tiers","marketing","social","idvreview","credentials","exceptions","banreview"];
const only = process.argv[2] ? process.argv[2].split(",") : VIEWS;
const tag = process.argv[3] || "";
const sess = JSON.parse(execSync("node scripts/test-signin-link.mjs helper --session --json", { cwd: process.env.HOME + "/.lh-sweep/admin" }).toString());
const browser = await chromium.launch({ headless: process.env.HEADLESS === "1" });
const out = [];
for (const vw of (process.env.VW ? process.env.VW.split(",").map(Number) : [375, 1440])) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vw === 375 ? 812 : 900 }, colorScheme: theme, deviceScaleFactor: 1 });
    await ctx.addInitScript(([k, v, t]) => {
      localStorage.setItem(k, v);
      localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
      localStorage.setItem("helpr-theme", t);
    }, [sess.key, sess.value, theme]);
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 200)));
    page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("supabase")) errs.push(`HTTP ${r.status()} ${r.url().replace(/^.*\/rest\/v1\//, "").replace(/^.*\/functions\/v1\//, "fn:").slice(0, 120)}`); });
    for (const view of only) {
      const shot = `shots/${tag}${view}-${vw}-${theme}.png`;
      if (fs.existsSync(shot) && !process.env.FORCE) { continue; }
      errs.length = 0;
      console.log("→", view, vw, theme);
      await page.goto(`http://localhost:4205/admin?view=${view}`, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(1500);
      // wait for spinners to settle
      for (let i = 0; i < 20; i++) {
        const n = await page.locator(".animate-spin, [role=status]").count();
        if (n === 0) break;
        await page.waitForTimeout(500);
      }
      const m = await Promise.race([page.evaluate(() => {
        const de = document.documentElement;
        const bad = [];
        const wide = [];
        const clipped = [];
        const els = document.querySelectorAll("body *");
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > de.clientWidth + 1 && getComputedStyle(el).position !== "fixed") wide.push((el.tagName + "." + [...el.classList].slice(0, 3).join(".") + " " + Math.round(r.right)).slice(0, 90));
        }
        for (const el of document.querySelectorAll("button, a, [role=tab], [role=radio], .badge, span[class*=badge], td, th, h1, h2, h3, label, select")) {
          const cs = getComputedStyle(el);
          if (cs.overflow === "visible" && cs.textOverflow !== "ellipsis") continue;
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.textOverflow !== "ellipsis") clipped.push((el.tagName + " '" + (el.textContent || "").trim().slice(0, 40) + "' " + el.scrollWidth + ">" + el.clientWidth).slice(0, 100));
        }
        const txt = document.body.innerText;
        for (const p of ["NaN", "undefined", "[object Object]", "null", "Invalid Date", "$-"]) if (txt.includes(p)) bad.push(p);
        return {
          scrollW: de.scrollWidth, clientW: de.clientWidth, h1: document.querySelectorAll("h1").length,
          rows: document.querySelectorAll("tbody tr").length, bad, wide: wide.slice(0, 6), clipped: clipped.slice(0, 12),
          boundary: /hit a problem|Something went wrong/i.test(txt), h1text: document.querySelector("h1")?.textContent?.trim().slice(0, 40),
        };
      }), new Promise((_, rej) => setTimeout(() => rej(new Error("evaluate timeout")), 30000))]).catch((e) => ({ scrollW: 0, clientW: 0, h1: -1, rows: -1, bad: [String(e)], wide: [], clipped: [], boundary: false }));
      await page.screenshot({ path: shot, fullPage: vw < 900, timeout: 30000 }).catch((e) => console.log("shot fail", String(e)));
      out.push({ view, vw, theme, ...m, errs: [...new Set(errs)].slice(0, 6) });
      const flag = (m.scrollW > m.clientW ? " OVERFLOW" : "") + (m.wide.length ? " WIDE" : "") + (m.clipped.length ? " CLIPPED" : "") + (m.bad.length ? " BAD" : "") + (errs.length ? " ERR" : "") + (m.boundary ? " BOUNDARY" : "");
      console.log(`${view}@${vw}/${theme} h1=${m.h1}(${m.h1text}) rows=${m.rows}${flag}`);
      if (flag) console.log("   ", JSON.stringify({ wide: m.wide, clipped: m.clipped, bad: m.bad, errs: [...new Set(errs)].slice(0, 6) }));
    }
    await ctx.close();
  }
}
fs.writeFileSync(`shots/${tag}results.json`, JSON.stringify(out, null, 1));
await browser.close();
