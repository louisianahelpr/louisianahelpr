#!/usr/bin/env node
/**
 * Repro: Complete Profile ZIP / Last-name values under the valid ✓ icon at
 * ≤430px. Usage: node scripts/audit/complete-profile-icon-clip.mjs <outDir> [baseURL] [chromium|webkit]
 */
import { chromium, webkit } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = resolve(new URL("../..", import.meta.url).pathname);
const OUT = resolve(process.argv[2] ?? "test-results/cp-clip");
const BASE = process.argv[3] ?? "https://www.louisianahelpr.com";
const ENGINE = process.argv[4] ?? "chromium";
mkdirSync(OUT, { recursive: true });

const { acquireBrowserLock, releaseBrowserLock } = await import(pathToFileURL(resolve(REPO, "e2e/browserLock.ts")).href);
await acquireBrowserLock();
process.on("exit", () => releaseBrowserLock());

const raw = JSON.parse(execSync("node scripts/test-signin-link.mjs incomplete-e2e --session --json", { cwd: process.env.SIGNIN_REPO ?? REPO, encoding: "utf8", maxBuffer: 1 << 24 }));
const browser = await (ENGINE === "webkit" ? webkit : chromium).launch();
const results = [];
for (const width of [320, 375, 430]) {
  const ctx = await browser.newContext({ viewport: { width, height: 812 }, serviceWorkers: "block" });
  await ctx.addInitScript(([k, v]) => {
    localStorage.setItem(k, v);
    localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
    localStorage.setItem("helpr_welcomed", "1");
  }, [raw.key, raw.value]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/complete-profile`, { waitUntil: "networkidle" });
  await page.locator("#lastName").waitFor({ timeout: 30000 });
  await page.locator("#firstName").fill("Marguerite");
  await page.locator("#lastName").fill("Thibodeaux-Broussard");
  await page.locator("#zipCode").fill("70528");
  await page.locator("#zipCode").blur();
  await page.waitForTimeout(800);
  // Every input with an absolutely-positioned trailing sibling: does the value run under it?
  const rows = await page.evaluate(() => {
    const out = [];
    for (const input of document.querySelectorAll("input")) {
      const wrap = input.parentElement;
      if (!wrap) continue;
      const icon = [...wrap.children].find((c) => c !== input && getComputedStyle(c).position === "absolute" && c.getBoundingClientRect().left > input.getBoundingClientRect().left + input.getBoundingClientRect().width / 2);
      if (!icon) continue;
      const ir = input.getBoundingClientRect(); const cr = icon.getBoundingClientRect();
      const cs = getComputedStyle(input);
      const c = document.createElement("canvas").getContext("2d"); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const textW = c.measureText(input.value).width;
      const contentW = ir.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const textRight = ir.left + parseFloat(cs.paddingLeft) + Math.min(textW, contentW);
      out.push({ id: input.id, value: input.value, inputW: Math.round(ir.width), padR: cs.paddingRight, iconLeft: Math.round(cr.left - ir.left), textW: Math.round(textW), contentW: Math.round(contentW), overflows: textW > contentW, textUnderIcon: textRight > cr.left, textOverflow: cs.textOverflow });
    }
    return out;
  });
  results.push({ width, rows });
  await page.locator("#zipCode").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${ENGINE}-${width}.png` });
  await ctx.close();
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
