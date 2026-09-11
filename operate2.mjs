// Operate pass 2: user detail sub-dialogs (reopening the detail each time), inline dispute decision, payouts hold/select-all, jobs tabs.
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const vw = Number(process.argv[2] || 375);
const theme = process.argv[3] || "light";
const sess = JSON.parse(execSync("node scripts/test-signin-link.mjs helper --session --json", { cwd: process.env.HOME + "/.lh-sweep/admin" }).toString());
const browser = await chromium.launch({ headless: process.env.HEADLESS === "1" });
const ctx = await browser.newContext({ viewport: { width: vw, height: vw === 375 ? 812 : 900 }, colorScheme: theme });
await ctx.addInitScript(([k, v, t]) => {
  localStorage.setItem(k, v);
  localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
  localStorage.setItem("helpr-theme", t);
}, [sess.key, sess.value, theme]);
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const errs = [];
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errs.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 160)));
page.on("dialog", (d) => { console.log("  native dialog:", d.message()); d.dismiss(); });
let n = 0;
const shot = async (name) => { n++; const p = `shots/op2-${vw}-${theme}-${String(n).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p }); return p; };
const clipCheck = async (label) => {
  const r = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, a, [role=tab], [role=radio], h1, h2, h3, label, p, span")) {
      const cs = getComputedStyle(el);
      if (cs.overflow === "visible") continue;
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis") out.push(`${el.tagName} '${(el.textContent || "").trim().slice(0, 40)}' ${el.scrollWidth}>${el.clientWidth}`);
    }
    const de = document.documentElement;
    return { clipped: out.filter((s) => !/Skip to content|Pin |Sidebar navigation/.test(s)), overflow: de.scrollWidth > de.clientWidth, txt: document.body.innerText };
  });
  const bad = ["NaN", "undefined", "[object Object]", "Invalid Date"].filter((p) => r.txt.includes(p));
  if (r.clipped.length || r.overflow || bad.length) console.log(`  !! ${label}:`, JSON.stringify({ clipped: r.clipped, overflow: r.overflow, bad }));
};
const go = async (view) => { await page.goto(`http://localhost:4205/admin?view=${view}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200); };
const byText = (sel, re) => page.locator(sel).filter({ hasText: re });
const dialogs = () => page.locator("[role=dialog], [role=alertdialog]");
const step = async (label, fn) => {
  console.log("STEP", label);
  try { await fn(); } catch (e) { console.log("  FAIL", label, String(e).split("\n")[0]); await shot("FAIL-" + label.replace(/\W+/g, "_")); }
  if (errs.length) { console.log("  console errs:", [...new Set(errs)]); errs.length = 0; }
};
const openPerry = async () => {
  await go("people");
  await byText("[role=tab]", /^All/).first().click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder(/Search name/).fill("Perry");
  await page.waitForTimeout(800);
  await byText("[role=button]", /Perry/).first().click();
  await page.waitForTimeout(1200);
};
const userDialog = (name, re, cancelRe = /^(Cancel|Close|Not now|Keep|Back|Never mind|Go back)$/i) => step("user-" + name, async () => {
  await openPerry();
  const detail = dialogs().first();
  const btn = detail.locator("button").filter({ hasText: re }).first();
  await btn.scrollIntoViewIfNeeded();
  const clipped = await btn.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  if (clipped) console.log(`  !! button '${re}' clipped`);
  await btn.click();
  await page.waitForTimeout(900);
  await shot("dlg-" + name);
  await clipCheck("dlg-" + name);
  const cnt = await dialogs().count();
  const dlg = dialogs().last();
  const txt = (await dlg.innerText()).replace(/\s+/g, " ");
  console.log(`  dialogs open: ${cnt}; text: ${txt.slice(0, 320)}`);
  const confirmBtns = await dlg.locator("button").allInnerTexts();
  console.log("  buttons:", confirmBtns.map((t) => t.trim()).filter(Boolean));
  // For multi-step (ban): pick a reason to reveal the final confirm, then cancel.
  const cancel = dlg.locator("button").filter({ hasText: cancelRe }).first();
  if (await cancel.count()) await cancel.click(); else await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  console.log("  after cancel dialogs open:", await dialogs().count());
});
await userDialog("formal-warning", /Formal Warning/);
await userDialog("reset-password", /Reset Password/);
await userDialog("restrict-apps", /Restrict Applications/);
await userDialog("suspend-ban", /Suspend \/ Ban/);
await userDialog("delete-account", /Delete Account/);
await userDialog("view-history", /View History/);
await userDialog("impersonate", /Impersonate/);
await step("user-tabs", async () => {
  await openPerry();
  const detail = dialogs().first();
  for (const t of ["Overview", "Jobs", "Reviews", "Docs", "Emails", "Actions"]) {
    const tab = detail.locator("[role=tab], button").filter({ hasText: new RegExp("^" + t + "$") }).first();
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(700); await shot("user-tab-" + t.toLowerCase()); await clipCheck("user-tab-" + t); console.log(`  tab ${t}:`, (await detail.innerText()).replace(/\s+/g, " ").slice(0, 200)); }
    else console.log("  no tab", t);
  }
  const tabs = detail.locator("[role=tab]");
  const tabInfo = await tabs.evaluateAll((els) => els.map((e) => ({ t: e.textContent.trim(), sw: e.scrollWidth, cw: e.clientWidth, r: Math.round(e.getBoundingClientRect().right) })));
  console.log("  tabs geometry:", JSON.stringify(tabInfo));
  await page.keyboard.press("Escape");
});
// Disputes: inline decide form
await step("disputes-decide-inline", async () => {
  await go("disputes");
  await byText("button", /Decide Outcome/).first().click();
  await page.waitForTimeout(900);
  await shot("disputes-decide-form");
  await clipCheck("decide-form");
  const main = page.locator("main").first();
  const txt = (await main.innerText()).replace(/\s+/g, " ");
  const i = txt.indexOf("Decision note");
  console.log("  form text:", txt.slice(i, i + 500));
  const btns = await main.locator("button").allInnerTexts();
  console.log("  buttons:", btns.map((t) => t.trim()).filter(Boolean));
  const cancel = byText("button", /^Cancel$/).first();
  if (await cancel.count()) { await cancel.click(); await page.waitForTimeout(400); console.log("  cancelled"); }
});
await step("disputes-quick-release", async () => {
  await byText("button", /Quick: Release/).first().click();
  await page.waitForTimeout(900);
  await shot("dlg-quick-release");
  const d = dialogs().last();
  console.log("  dialogs:", await dialogs().count(), "text:", (await d.innerText().catch(() => "NONE")).replace(/\s+/g, " ").slice(0, 300));
  const cancel = d.locator("button").filter({ hasText: /Cancel|Keep|Back/i }).first();
  if (await cancel.count()) await cancel.click(); else await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
});
await step("disputes-quick-refund", async () => {
  await byText("button", /Quick: Refund/).first().click();
  await page.waitForTimeout(900);
  await shot("dlg-quick-refund");
  const d = dialogs().last();
  console.log("  dialogs:", await dialogs().count(), "text:", (await d.innerText().catch(() => "NONE")).replace(/\s+/g, " ").slice(0, 300));
  const cancel = d.locator("button").filter({ hasText: /Cancel|Keep|Back/i }).first();
  if (await cancel.count()) await cancel.click(); else await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
});
await step("disputes-retry-settlement", async () => {
  const b = byText("button", /Retry settlement/).first();
  console.log("  retry present:", await b.count(), "disabled:", await b.isDisabled());
});
await step("disputes-decided-tab", async () => {
  await byText("[role=tab], button", /^Decided/).first().click();
  await page.waitForTimeout(700);
  await shot("disputes-decided-tab");
  console.log("  text:", (await page.locator("main").first().innerText()).replace(/\s+/g, " ").slice(0, 300));
});
// Payouts
await step("payouts-hold", async () => {
  await go("payouts");
  const hold = page.locator("main button").filter({ hasText: /^Hold$/ }).first();
  await hold.scrollIntoViewIfNeeded();
  await hold.click({ timeout: 10000 });
  await page.waitForTimeout(800);
  await shot("payouts-after-hold");
  console.log("  tabs:", (await page.locator("[role=tablist]").first().innerText()).replace(/\s+/g, " "));
  await byText("[role=tab]", /Hold/).first().click();
  await page.waitForTimeout(600);
  await shot("payouts-hold-tab");
  await clipCheck("payouts-hold-tab");
  const btns = await page.locator("main button").allInnerTexts();
  console.log("  buttons:", btns.map((t) => t.trim().replace(/\s+/g, " ")).filter(Boolean));
  const rel = page.locator("main button").filter({ hasText: /Release|Unhold|Move|Ready/i }).first();
  if (await rel.count()) { await rel.click(); await page.waitForTimeout(600); console.log("  released hold; tabs:", (await page.locator("[role=tablist]").first().innerText()).replace(/\s+/g, " ")); }
});
await step("payouts-select-all", async () => {
  await go("payouts");
  await byText("button", /Select All/).first().click();
  await page.waitForTimeout(600);
  await shot("payouts-select-all");
  const btns = await page.locator("main button").allInnerTexts();
  console.log("  buttons:", btns.map((t) => t.trim().replace(/\s+/g, " ")).filter(Boolean));
  const bulk = page.locator("main button").filter({ hasText: /Bulk Approve/ }).first();
  await bulk.click();
  await page.waitForTimeout(800);
  await shot("dlg-bulk-approve");
  const d = dialogs().last();
  console.log("  dialogs:", await dialogs().count(), "text:", (await d.innerText().catch(() => "NONE")).replace(/\s+/g, " ").slice(0, 300));
  const cancel = d.locator("button").filter({ hasText: /Cancel|Keep|Back/i }).first();
  if (await cancel.count()) await cancel.click(); else await page.keyboard.press("Escape");
});
// Jobs
await step("jobs-tabs", async () => {
  await go("jobs");
  const tabs = page.locator("main button").filter({ hasText: /Flagged|Resolved|Ghosts|All \(/ });
  const names = await tabs.allInnerTexts();
  console.log("  tabs:", names.map((t) => t.replace(/\s+/g, " ")));
  for (let i = 0; i < names.length; i++) { await tabs.nth(i).click(); await page.waitForTimeout(900); await shot("jobs-tab-" + i); await clipCheck("jobs-tab-" + i); console.log(`  ${names[i].replace(/\s+/g, " ")}:`, (await page.locator("main").first().innerText()).replace(/\s+/g, " ").slice(0, 160)); }
  const card = page.locator("main h3, main [class*=font-semibold]").filter({ hasText: /\w{4,}/ }).first();
  await card.click();
  await page.waitForTimeout(900);
  await shot("jobs-card-click");
  console.log("  dialogs after card click:", await dialogs().count(), "url:", page.url());
  const btns = await page.locator("main button").allInnerTexts();
  console.log("  first-card buttons:", btns.map((t) => t.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 20));
});
// Broadcast inline form
await step("broadcast-form", async () => {
  await go("broadcasts");
  await byText("button", /New Broadcast/).first().click();
  await page.waitForTimeout(700);
  await shot("broadcast-form");
  await clipCheck("broadcast-form");
  console.log("  text:", (await page.locator("main").first().innerText()).replace(/\s+/g, " ").slice(0, 400));
});
// Settings — add admin / abuse limits inputs
await step("settings-forms", async () => {
  await go("settings");
  const inputs = await page.locator("main input").evaluateAll((els) => els.map((e) => ({ type: e.type, ph: e.placeholder, v: e.value })));
  console.log("  inputs:", JSON.stringify(inputs));
  const add = byText("button", /Add Admin/).first();
  await add.scrollIntoViewIfNeeded();
  await shot("settings-admins");
  console.log("  add admin disabled:", await add.isDisabled());
});
// Notifications master toggles — read only
await step("notifications-view", async () => {
  await go("notifications");
  const sw = page.locator("main [role=switch]");
  console.log("  switches:", await sw.count(), "states:", await sw.evaluateAll((els) => els.map((e) => e.getAttribute("aria-checked")).join("")));
});
await browser.close();
