// Operate pass: open dialogs, run filters, confirm destructive dialogs appear, CANCEL.
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
const shot = async (name) => { n++; const p = `shots/op-${vw}-${theme}-${String(n).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p, fullPage: false }); return p; };
const clipCheck = async (label) => {
  const r = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, a, [role=tab], [role=radio], h1, h2, h3, label")) {
      const cs = getComputedStyle(el);
      if (cs.overflow === "visible") continue;
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis") out.push(`${el.tagName} '${(el.textContent || "").trim().slice(0, 40)}' ${el.scrollWidth}>${el.clientWidth}`);
    }
    const de = document.documentElement;
    return { clipped: out.filter((s) => !s.includes("Skip to content")), overflow: de.scrollWidth > de.clientWidth, txt: document.body.innerText };
  });
  const bad = ["NaN", "undefined", "[object Object]", "Invalid Date"].filter((p) => r.txt.includes(p));
  if (r.clipped.length || r.overflow || bad.length) console.log(`  !! ${label}:`, JSON.stringify({ clipped: r.clipped, overflow: r.overflow, bad }));
};
const go = async (view) => { await page.goto(`http://localhost:4205/admin?view=${view}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200); };
const byText = (sel, re) => page.locator(sel).filter({ hasText: re });
const dialog = () => page.locator("[role=dialog], [role=alertdialog]").last();
const closeDialog = async () => {
  const d = dialog();
  if (await d.count() === 0) { console.log("  (no dialog open)"); return; }
  const cancel = d.locator("button").filter({ hasText: /^(Cancel|Close|Not now|Keep|Back|Never mind|Go back)$/i }).first();
  if (await cancel.count()) await cancel.click(); else await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  if (await dialog().count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
  console.log("  dialog closed:", (await dialog().count()) === 0);
};
const step = async (label, fn) => {
  console.log("STEP", label);
  try { await fn(); } catch (e) { console.log("  FAIL", label, String(e).split("\n")[0]); await shot("FAIL-" + label.replace(/\W+/g, "_")); }
  if (errs.length) { console.log("  console errs:", [...new Set(errs)]); errs.length = 0; }
};

// ── Users ──
await step("users-open-perry", async () => {
  await go("people");
  await byText("[role=tab]", /^All/).first().click();
  await page.waitForTimeout(800);
  await clipCheck("users-all");
  await page.getByPlaceholder(/Search name/).fill("Perry");
  await page.waitForTimeout(800);
  await shot("users-search-perry");
  const row = byText("[role=button]", /Perry/).first();
  await row.click();
  await page.waitForTimeout(1200);
  await shot("user-detail-top");
  await clipCheck("user-detail");
});
const userDialog = (name, re) => step("user-" + name, async () => {
  const btn = dialog().locator("button").filter({ hasText: re }).first();
  await btn.scrollIntoViewIfNeeded();
  const clipped = await btn.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  if (clipped) console.log(`  !! button '${re}' clipped`);
  await btn.click();
  await page.waitForTimeout(900);
  await shot("dlg-" + name);
  await clipCheck("dlg-" + name);
  const dlg = dialog();
  console.log("  dialog title:", (await dlg.locator("h2, h1, [id*=title]").first().textContent().catch(() => "?"))?.trim().slice(0, 80));
  await closeDialog();
});
await userDialog("manual-verify", /Manually Verify/);
await userDialog("formal-warning", /Formal Warning/);
await userDialog("reset-password", /Reset Password/);
await userDialog("restrict-apps", /Restrict Applications/);
await userDialog("suspend-ban", /Suspend \/ Ban/);
await userDialog("delete-account", /Delete Account/);
await step("user-tabs", async () => {
  for (const t of ["Overview", "Verification", "Jobs", "Notes", "Actions", "Activity", "History"]) {
    const tab = dialog().locator("[role=tab], button").filter({ hasText: new RegExp("^" + t) }).first();
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(600); await shot("user-tab-" + t.toLowerCase()); await clipCheck("user-tab-" + t); }
  }
  await closeDialog();
});
await step("users-filters", async () => {
  await go("people");
  for (const t of ["Pending", "Email", "Active", "Banned", "Denied", "All"]) {
    const tab = byText("[role=tab]", new RegExp("^" + t)).first();
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(700); const cnt = await page.locator("[role=button]").filter({ hasText: /\w/ }).count(); const txt = (await page.locator("main").first().innerText()).match(/\d+ \w+ users?/)?.[0]; console.log(`  tab ${t}: ${txt} (rows ${cnt})`); }
  }
  await shot("users-all-tab");
});

// ── Disputes ──
await step("disputes-decide", async () => {
  await go("disputes");
  await byText("button", /Decide Outcome/).first().click();
  await page.waitForTimeout(900);
  await shot("dlg-decide-outcome");
  await clipCheck("decide-outcome");
  console.log("  dlg text:", (await dialog().innerText()).replace(/\s+/g, " ").slice(0, 400));
  await closeDialog();
});
await step("disputes-quick-release", async () => {
  await byText("button", /Quick: Release/).first().click();
  await page.waitForTimeout(900);
  await shot("dlg-quick-release");
  console.log("  dlg text:", (await dialog().innerText()).replace(/\s+/g, " ").slice(0, 300));
  await closeDialog();
});
await step("disputes-quick-refund", async () => {
  await byText("button", /Quick: Refund/).first().click();
  await page.waitForTimeout(900);
  await shot("dlg-quick-refund");
  console.log("  dlg text:", (await dialog().innerText()).replace(/\s+/g, " ").slice(0, 300));
  await closeDialog();
});
await step("disputes-filters", async () => {
  for (const f of [">30d", "Poster", "No-show"]) {
    await byText("[role=radio], button", new RegExp("^" + f.replace(/[>]/g, "\\$&") + "$")).first().click();
    await page.waitForTimeout(500);
    console.log(`  filter ${f}: ${(await page.locator("main").first().innerText()).match(/\d+ disputes?/)?.[0]}`);
  }
  await shot("disputes-filtered");
  await byText("[role=tab], button", /^Decided/).first().click();
  await page.waitForTimeout(600);
  await shot("disputes-decided-tab");
});

// ── Payouts ──
await step("payouts-payout-confirm", async () => {
  await go("payouts");
  await byText("button", /^Pay Out$/).first().click();
  await page.waitForTimeout(900);
  await shot("dlg-payout");
  console.log("  dlg text:", (await dialog().innerText()).replace(/\s+/g, " ").slice(0, 300));
  await closeDialog();
});
await step("payouts-hold", async () => {
  await byText("button", /^Hold$/).first().click();
  await page.waitForTimeout(700);
  await shot("payouts-after-hold");
  console.log("  tabs:", (await page.locator("[role=tablist]").innerText()).replace(/\s+/g, " "));
  await byText("[role=tab]", /Hold/).first().click();
  await page.waitForTimeout(600);
  await shot("payouts-hold-tab");
  await clipCheck("payouts-hold-tab");
  const rel = byText("button", /Release|Unhold|Move back/).first();
  if (await rel.count()) { await rel.click(); await page.waitForTimeout(500); console.log("  released hold"); }
  await byText("[role=tab]", /Ready/).first().click();
});
await step("payouts-select-all", async () => {
  await byText("button", /Select All/).first().click();
  await page.waitForTimeout(600);
  await shot("payouts-select-all");
  const bulk = byText("button", /Pay Out .*\(|Pay .* selected|Pay Out All/i).first();
  if (await bulk.count()) { await bulk.click(); await page.waitForTimeout(800); await shot("dlg-bulk-payout"); console.log("  dlg text:", (await dialog().innerText()).replace(/\s+/g, " ").slice(0, 300)); await closeDialog(); }
  else console.log("  no bulk button found; buttons:", await page.locator("main button").allInnerTexts());
});

// ── Broadcasts ──
await step("broadcast-new", async () => {
  await go("broadcasts");
  await byText("button", /New Broadcast/).first().click();
  await page.waitForTimeout(800);
  await shot("dlg-new-broadcast");
  await clipCheck("new-broadcast");
  await closeDialog();
});

// ── Reports ──
await step("reports-actions", async () => {
  await go("reports");
  await clipCheck("reports");
  for (const t of ["Investigating", "Resolved", "Dismissed", "All", "New"]) {
    const tab = byText("[role=tab], button", new RegExp("^" + t + "$")).first();
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(600); console.log(`  tab ${t}: ${(await page.locator("main").first().innerText()).split("\n").slice(0, 6).join(" | ").slice(0, 160)}`); }
  }
  const vp = byText("button", /View Profile|View Job/).first();
  console.log("  first view button:", await vp.innerText(), "disabled:", await vp.isDisabled());
  const msg = byText("button", /^Message/).first();
  if (await msg.count() && !(await msg.isDisabled())) { await msg.click(); await page.waitForTimeout(700); await shot("dlg-report-message"); await closeDialog(); } else console.log("  message button disabled (deleted subject)");
});

// ── Jobs ──
await step("jobs-tabs", async () => {
  await go("jobs");
  const tabs = await page.locator("[role=tab]").allInnerTexts();
  console.log("  tabs:", tabs.map((t) => t.replace(/\s+/g, " ")));
  for (let i = 0; i < tabs.length; i++) { await page.locator("[role=tab]").nth(i).click(); await page.waitForTimeout(700); await shot("jobs-tab-" + i); await clipCheck("jobs-tab-" + tabs[i]); }
  const first = page.locator("main [role=button], main article, main .cursor-pointer").first();
  if (await first.count()) { await first.click(); await page.waitForTimeout(900); await shot("jobs-detail"); await clipCheck("jobs-detail"); await closeDialog(); }
});

// ── Settings ──
await step("settings", async () => {
  await go("settings");
  await clipCheck("settings");
  const btns = await page.locator("main button").allInnerTexts();
  console.log("  buttons:", btns.map((t) => t.trim()).filter(Boolean));
});

// ── Support / Fraud / Notif logs filters ──
await step("support-tabs", async () => {
  await go("support");
  for (const t of ["Resolved", "All"]) { await byText("[role=tab], button", new RegExp("^" + t + "$")).first().click(); await page.waitForTimeout(600); console.log(`  ${t}:`, (await page.locator("main").first().innerText()).split("\n").slice(2, 5).join(" | ").slice(0, 120)); }
  await shot("support-all");
  await clipCheck("support-all");
});
await step("notiflogs-filters", async () => {
  await go("notiflogs");
  const selects = page.locator("main select, main [role=combobox]");
  console.log("  selects:", await selects.count());
  await page.getByPlaceholder(/Search by email/).fill("zzzz-no-match");
  await page.waitForTimeout(800);
  await shot("notiflogs-filtered-empty");
  console.log("  empty text:", (await page.locator("main").first().innerText()).split("\n").slice(-4).join(" | "));
});
await step("fraud-resolved", async () => {
  await go("fraud");
  await byText("button", /Show Resolved/).first().click();
  await page.waitForTimeout(700);
  await shot("fraud-resolved");
  console.log("  text:", (await page.locator("main").first().innerText()).split("\n").slice(2, 8).join(" | ").slice(0, 200));
});
await step("audit-export", async () => {
  await go("audit");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }).catch(() => null), byText("button", /Export CSV/).first().click()]);
  console.log("  download:", dl ? await dl.suggestedFilename() : "NONE");
});
await step("export-users", async () => {
  await go("export");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }).catch(() => null), byText("button", /Export Users/).first().click()]);
  console.log("  download:", dl ? await dl.suggestedFilename() : "NONE");
  await page.waitForTimeout(800);
  await shot("export-after");
});
await step("marketing-segment", async () => {
  await go("marketing");
  await clipCheck("marketing");
  const btns = await page.locator("main button").allInnerTexts();
  console.log("  buttons:", btns.map((t) => t.trim()).filter(Boolean));
  const send = byText("button", /^Send to/).first();
  if (await send.count()) console.log("  send disabled:", await send.isDisabled());
});
await step("social-filters", async () => {
  await go("social");
  for (const f of ["Scheduled", "Published", "Failed"]) { const b = byText("button", new RegExp("^" + f)).first(); if (await b.count()) { await b.click(); await page.waitForTimeout(500); console.log(`  ${f}:`, (await page.locator("main").first().innerText()).match(/Nothing here\.|No posts yet\./)?.[0] ?? "rows"); } }
  await shot("social-failed");
  const compose = byText("button", /Compose|New post/i).first();
  if (await compose.count()) { await compose.click(); await page.waitForTimeout(800); await shot("dlg-compose"); await clipCheck("compose"); await closeDialog(); }
});
await step("sidebar-badges", async () => {
  await go("home");
  const trig = page.locator("button[aria-label*='menu' i], button[aria-label*='navigation' i], header button").last();
  await trig.click();
  await page.waitForTimeout(700);
  await shot("sidebar-open");
  await clipCheck("sidebar");
  const nav = await page.locator("nav, [role=navigation], aside").last().innerText().catch(() => "");
  console.log("  nav:", nav.replace(/\s+/g, " ").slice(0, 400));
});
await step("command-palette", async () => {
  await page.keyboard.press("Escape");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.waitForTimeout(600);
  await shot("cmd-palette");
  console.log("  palette open:", await dialog().count());
  await page.keyboard.press("Escape");
});
await browser.close();
