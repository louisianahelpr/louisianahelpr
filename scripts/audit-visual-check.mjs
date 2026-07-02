// One-shot visual + meta verification for the 2026-07 audit batch fixes.
// Renders each touched surface at 375 and 1440, captures screenshots,
// asserts meta tags / redirects / overflow. Run: node scripts/audit-visual-check.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = "http://localhost:8080";
const OUT = "/tmp/audit-shots";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const browser = await chromium.launch();

async function check(name, path, { expectPath, expectMeta, expectText } = {}) {
  for (const [label, width, height] of [["375", 375, 812], ["1440", 1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1200);
      const finalPath = new URL(page.url()).pathname;
      const title = await page.title();
      const desc = await page.locator('meta[name="description"]').getAttribute("content").catch(() => null);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href").catch(() => null);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
      const issues = [];
      if (expectPath && finalPath !== expectPath) issues.push(`path=${finalPath} want=${expectPath}`);
      if (expectMeta) {
        if (!desc || desc.length < 40) issues.push(`meta description missing/thin: ${desc}`);
        if (!canonical) issues.push("canonical missing");
      }
      if (expectText && !bodyText.includes(expectText)) issues.push(`missing text "${expectText}"`);
      if (overflow > 0) issues.push(`horizontal overflow ${overflow}px`);
      const realErrors = errors.filter(
        (e) => !e.includes("favicon") && !e.includes("Failed to load resource") && !e.includes("posthog") && !e.includes("sentry"),
      );
      if (realErrors.length) issues.push(`console errors: ${realErrors.slice(0, 2).join(" | ")}`);
      await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: false });
      results.push({ name: `${name}@${label}`, ok: issues.length === 0, title, finalPath, issues });
    } catch (e) {
      results.push({ name: `${name}@${label}`, ok: false, issues: [String(e).slice(0, 200)] });
    }
    await page.close();
  }
}

await check("jobs", "/jobs", { expectPath: "/jobs", expectMeta: true });
await check("evacuation", "/evacuation", { expectPath: "/evacuation", expectMeta: true });
await check("community", "/community", { expectPath: "/community" });
await check("job-history-redirect", "/job-history", {});
await check("parishes-redirect", "/parishes", { expectPath: "/jobs" });
await check("parish-slug-redirect", "/parish/orleans", { expectPath: "/jobs" });
await check("partner-redirect", "/become-a-partner", { expectPath: "/for-business" });
await check("impact-redirect", "/impact", { expectPath: "/" });
await check("browse-guest", "/browse", { expectPath: "/browse" });

await browser.close();
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  ${r.finalPath ?? ""}  ${r.title ?? ""}${r.issues?.length ? "\n      " + r.issues.join("\n      ") : ""}`);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
