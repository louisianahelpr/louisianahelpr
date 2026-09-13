#!/usr/bin/env node
/**
 * Repro for four keyboard-a11y defects against PROD (terminal 2, 2026-09-12).
 * Usage: node scripts/audit/a11y-focus-repro.mjs <outDir> [baseURL]
 */
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = resolve(new URL("../..", import.meta.url).pathname);
const OUT = resolve(process.argv[2] ?? "test-results/a11y-repro");
const BASE = process.argv[3] ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://www.louisianahelpr.com";
mkdirSync(OUT, { recursive: true });

const { acquireBrowserLock, releaseBrowserLock } = await import(pathToFileURL(resolve(REPO, "e2e/browserLock.ts")).href);
await acquireBrowserLock();
process.on("exit", () => releaseBrowserLock());

const raw = JSON.parse(execSync("node scripts/test-signin-link.mjs helper-e2e --session --json", { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 24 }));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });
await ctx.addInitScript(([k, v]) => {
  localStorage.setItem(k, v);
  localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
  localStorage.setItem("helpr_welcomed", "1");
}, [raw.key, raw.value]);
const page = await ctx.newPage();
const results = {};
const active = () => page.evaluate(() => {
  const a = document.activeElement;
  return a ? `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}[${a.getAttribute("role") ?? ""}|${a.getAttribute("aria-label") ?? ""}]` : "null";
});

// 1. DOB wheel focus ring (signup step 2 is guest-visible, but we're signed in; use a fresh guest context)
{
  const guest = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });
  const g = await guest.newPage();
  await g.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  // Step 1 → step 2 may need fields; try the DOB trigger directly if present, else fill step 1
  let trigger = g.locator("#dob");
  if (!(await trigger.count())) {
    await g.locator("#email").fill(`a11y-${Date.now()}@example.com`);
    await g.locator("#password").fill("Xx!12345678aa");
    for (const id of ["#policies", "#age-confirm"]) await g.locator(id).click();
    await g.getByRole("button", { name: /continue/i }).first().click();
    await g.waitForTimeout(1000);
    trigger = g.locator("#dob");
  }
  await g.screenshot({ path: `${OUT}/1-signup.png` });
  if (await trigger.count()) {
    await trigger.click();
    await g.waitForTimeout(500);
    const month = g.getByRole("listbox", { name: "Month" });
    await month.focus();
    await g.keyboard.press("Tab"); await g.keyboard.press("Shift+Tab"); // ensure :focus-visible via keyboard
    await g.waitForTimeout(150);
    const info = await month.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { focused: document.activeElement === el, matchesFV: el.matches(":focus-visible"), outline: cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor, boxShadow: cs.boxShadow };
    });
    results.dobWheel = info;
    await g.screenshot({ path: `${OUT}/1-dob-wheel-month-focused.png` });
  } else {
    results.dobWheel = "no #dob found";
  }
  await guest.close();
}

// 2. Messages thread open
{
  await page.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/2-messages-list.png` });
  const anyRow = page.locator("button.flex-1.min-w-0.text-left").first();
  const before = await active();
  if (await anyRow.count()) {
    await anyRow.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    results.thread = { before, afterOpen: await active(), url: page.url() };
    await page.screenshot({ path: `${OUT}/2-thread-open-focus.png` });
  } else {
    results.thread = { before, note: "no conversation rows", html: await page.locator("main").innerText().catch(() => "") };
  }
}

// 3. Push master switch
{
  await page.goto(`${BASE}/profile?tab=notifications`, { waitUntil: "networkidle" });
  const sw = page.getByRole("switch", { name: "Push notifications master toggle" });
  await sw.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(500);
  await sw.focus();
  const before = await active();
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  const after = await active();
  await page.screenshot({ path: `${OUT}/3-push-master-after-toggle.png` });
  // restore
  await sw.focus(); await page.keyboard.press("Space"); await page.waitForTimeout(1200);
  results.pushMaster = { before, after, afterRestore: await active() };
}

// 4. #require-photo-proof name
{
  await page.goto(`${BASE}/post-job`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const el = page.locator("#require-photo-proof");
  // may be on a later step; try scrolling/finding
  if (!(await el.count())) {
    await page.getByRole("button", { name: /start fresh/i }).first().click();
    await page.waitForTimeout(1000);
  }
  if (await el.count()) {
    await el.scrollIntoViewIfNeeded();
    const snap = await el.ariaSnapshot();
    results.photoProof = { ariaSnapshot: snap, label: await el.evaluate((e) => ({ id: e.id, role: e.getAttribute("role"), ariaLabel: e.getAttribute("aria-label"), labelledby: e.getAttribute("aria-labelledby"), labelsCount: e.labels?.length, labelText: [...(e.labels ?? [])].map((l) => l.textContent?.trim()) })) };
    await page.screenshot({ path: `${OUT}/4-photo-proof.png` });
  } else {
    results.photoProof = "not found on /post-job";
    await page.screenshot({ path: `${OUT}/4-post-job.png` });
  }
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
