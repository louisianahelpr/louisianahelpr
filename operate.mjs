import { chromium } from "playwright";
const BASE = "http://localhost:4201";
const OUT = new URL("./shots/op-", import.meta.url).pathname;
const b = await chromium.launch({ headless: true });
const results = [];
const log = (k, v) => { results.push([k, v]); console.log(k, "→", v); };

async function fresh(w = 375, theme = "light") {
  const ctx = await b.newContext({ viewport: { width: w, height: w === 375 ? 812 : 900 }, colorScheme: theme });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("PAGEERROR", String(e).slice(0, 200)));
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: OUT + name + ".png", fullPage: true });
const gloss = async (page, sel) => { const el = await page.$(sel); return el ? (await el.evaluate((e) => getComputedStyle(e).backgroundImage.slice(0, 60))) : "MISSING"; };

// ---------- LANDING ----------
try {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  log("landing: Post a Job gloss", await gloss(page, 'a:has-text("Post a Job")'));
  log("landing: Get Started gloss", await gloss(page, 'a:has-text("Get Started"), button:has-text("Get Started")'));
  const links = await page.$$eval("a[href]", (as) => as.map((a) => [a.textContent.trim().slice(0, 30), a.getAttribute("href")]));
  log("landing: links", JSON.stringify(links));
  // segmented control
  await page.click('text="I want to work"');
  await page.waitForTimeout(600);
  const stepsWork = await page.$$eval("#how-it-works h3, #how-it-works [class*=font-display]", (els) => els.map((e) => e.textContent.trim()).filter(Boolean).slice(0, 8));
  log("landing: 'I want to work' steps", JSON.stringify(stepsWork));
  await page.evaluate(() => document.querySelector("#how-it-works").scrollIntoView());
  await page.waitForTimeout(800);
  await shot(page, "landing-work-375");
  await page.click('text="Post a Job"'); await page.waitForTimeout(800);
  log("landing: Post a Job →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/"); await page.click('text="Browse Jobs"'); await page.waitForTimeout(800);
  log("landing: Browse Jobs →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/"); await page.click('text="Get Started"'); await page.waitForTimeout(800);
  log("landing: Get Started →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/"); await page.click('text="Log In"'); await page.waitForTimeout(800);
  log("landing: Log In →", page.url().replace(BASE, ""));
  await ctx.close();
} catch (e) { log('BLOCK FAILED', String(e).slice(0, 200)); }

// ---------- BROWSE ----------
for (const w of [375, 1440]) try {
  const { ctx, page } = await fresh(w);
  await page.goto(BASE + "/browse", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const btns = await page.$$eval("button, a", (els) => els.map((e) => (e.getAttribute("aria-label") || e.textContent.trim()).slice(0, 30)).filter(Boolean));
  log(`browse@${w}: controls`, JSON.stringify(btns));
  // search
  const search = await page.$('button[aria-label*="earch" i]');
  if (search) { await search.click(); await page.waitForTimeout(500); await shot(page, `browse-search-${w}`); const inp = await page.$('input[type="search"], input[placeholder*="earch" i]'); log(`browse@${w}: search input`, !!inp); if (inp) { await inp.fill("dog"); await page.waitForTimeout(900); log(`browse@${w}: 'dog' results`, await page.$$eval("h3, [class*=font-display]", (e) => e.map((x) => x.textContent.trim()).filter((t) => /walk|dog/i.test(t)).length)); await shot(page, `browse-search-dog-${w}`); const inp2 = await page.$('input[type="search"], input[placeholder*="earch" i]'); if (inp2) await inp2.fill(""); } }
  else log(`browse@${w}: search button`, "MISSING");
  // filters
  const filt = await page.$('button[aria-label*="ilter" i], button:has-text("Filters")');
  if (filt) {
    await filt.click(); await page.waitForTimeout(800); await shot(page, `browse-filters-${w}`);
    const sheetBtns = await page.$$eval('[role=dialog] button, [role=dialog] [role=radio], [role=dialog] [role=tab]', (els) => els.map((e) => (e.getAttribute("aria-label") || e.textContent.trim()).slice(0, 25)).filter(Boolean));
    log(`browse@${w}: filter sheet controls`, JSON.stringify(sheetBtns));
    const clipped = await page.$$eval('[role=dialog] button, [role=dialog] span, [role=dialog] label', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 && /hidden|clip/.test(getComputedStyle(e).overflow + getComputedStyle(e).overflowX) && !/sr-only/.test(e.className)).map((e) => e.textContent.trim().slice(0, 30) + " " + e.scrollWidth + ">" + e.clientWidth));
    log(`browse@${w}: filter sheet clipped`, JSON.stringify(clipped));
    const map = await page.$('[role=dialog] :text-is("Map"), [role=dialog] button:has-text("Map")');
    if (map) { await map.click(); await page.waitForTimeout(500); await page.keyboard.press("Escape"); await page.waitForTimeout(2500); await shot(page, `browse-map-${w}`); log(`browse@${w}: map canvas`, await page.$$eval("canvas, .mk-map-view, [class*=map]", (e) => e.length)); const mapPageErrs = await page.evaluate(() => document.body.innerText.includes("map") ); void mapPageErrs; }
    else log(`browse@${w}: Map toggle in sheet`, "MISSING");
  } else log(`browse@${w}: filters button`, "MISSING");
  // signup handoff via card
  await page.goto(BASE + "/browse", { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  const card = await page.$('article, [data-testid*="job"], a[href*="/jobs/"], [role=button]:has(h3)');
  const cardText = card ? (await card.textContent()).slice(0, 40) : "NONE";
  if (card) { await card.click(); await page.waitForTimeout(900); log(`browse@${w}: card tap (${cardText}) →`, page.url().replace(BASE, "")); await shot(page, `browse-cardtap-${w}`); }
  await page.goto(BASE + "/browse", { waitUntil: "networkidle" }); await page.click('text="Get Started"'); await page.waitForTimeout(700); log(`browse@${w}: Get Started →`, page.url().replace(BASE, ""));
  await page.goto(BASE + "/browse", { waitUntil: "networkidle" }); await page.click('text="Log In"'); await page.waitForTimeout(700); log(`browse@${w}: Log In →`, page.url().replace(BASE, ""));
  // deep link preview dialog
  const jobId = await page.evaluate(async () => { const r = await fetch("/browse"); return null; });
  void jobId;
  await ctx.close();
} catch (e) { log('BLOCK FAILED', String(e).slice(0, 200)); }

// ---------- LOGIN ----------
try {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  log("login: Log In gloss", await gloss(page, 'button[type=submit]'));
  await page.click('button[type=submit]'); await page.waitForTimeout(600);
  log("login: empty submit msg", (await page.evaluate(() => document.body.innerText)).match(/required|enter|valid|email/gi)?.slice(0, 4));
  await page.fill('input[type=email]', "nobody@example.com"); await page.fill('input[type=password]', "wrongpassword123!");
  await page.click('button[type=submit]'); await page.waitForTimeout(3500);
  await shot(page, "login-badcreds-375");
  log("login: bad creds msg", (await page.evaluate(() => document.body.innerText)).match(/invalid|incorrect|wrong|couldn|not found|error/gi)?.slice(0, 4));
  await page.click('text="Forgot Password?"'); await page.waitForTimeout(600); log("login: forgot →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/login"); await page.click('text="Create an Account"'); await page.waitForTimeout(600); log("login: create →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/login"); await page.click('button[aria-label*="ack" i], a[aria-label*="ack" i]'); await page.waitForTimeout(600); log("login: back →", page.url().replace(BASE, ""));
  await ctx.close();
} catch (e) { log('BLOCK FAILED', String(e).slice(0, 200)); }

// ---------- SIGNUP ----------
try {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/signup", { waitUntil: "networkidle" });
  await page.click('button:has-text("Continue")'); await page.waitForTimeout(600);
  await shot(page, "signup-empty-submit-375");
  log("signup: empty submit errors", (await page.evaluate(() => [...document.querySelectorAll('[role=alert], [aria-invalid=true], .text-destructive, [class*=error]')].map((e) => e.textContent.trim().slice(0, 50)).filter(Boolean))).slice(0, 6));
  await page.fill('input[type=email]', "not-an-email"); await page.fill('input[type=password]', "short");
  await page.click('button:has-text("Continue")'); await page.waitForTimeout(600);
  await shot(page, "signup-invalid-375");
  log("signup: invalid msgs", (await page.evaluate(() => document.body.innerText)).match(/valid email|characters|agree|18/gi)?.slice(0, 5));
  await page.fill('input[type=email]', "sweep-guest-test@example.com"); await page.fill('input[type=password]', "Sweep-Guest-Pass-2026!");
  for (const cb of await page.$$('button[role=checkbox]')) { const st = await cb.getAttribute("data-state"); if (st !== "checked") await cb.click(); }
  await page.waitForTimeout(300);
  log("signup: password checklist", (await page.evaluate(() => [...document.querySelectorAll('li, span')].map((e) => e.textContent.trim()).filter((t) => /characters|Lowercase|Uppercase|Number|Symbol/.test(t)).slice(0, 5))));
  await shot(page, "signup-filled-375");
  await page.click('button:has-text("Continue")'); await page.waitForTimeout(1500);
  log("signup: after Continue →", page.url().replace(BASE, ""));
  await shot(page, "signup-step2-375");
  const fields = await page.$$eval("input, select, textarea, button[type=submit]", (els) => els.map((e) => (e.getAttribute("placeholder") || e.getAttribute("name") || e.getAttribute("aria-label") || e.textContent.trim()).slice(0, 30)));
  log("signup: step2 fields", JSON.stringify(fields));
  const cont2 = await page.$('button:has-text("Continue"), button:has-text("Create")');
  if (cont2) { await cont2.click(); await page.waitForTimeout(700); await shot(page, "signup-step2-empty-375"); log("signup: step2 empty errors", await page.$$eval('[role=alert], [aria-invalid=true], p[class*=destructive], p[class*=error]', (e) => e.map((x) => x.textContent.trim().slice(0, 50)).filter(Boolean).slice(0, 8))); }
  const zip = await page.$('input[inputmode=numeric], input[placeholder*="ZIP" i], input[name*="zip" i]');
  if (zip) { await zip.fill("99999"); await page.waitForTimeout(900); log("signup: unknown ZIP msg", (await page.evaluate(() => document.body.innerText)).match(/[^\n]*(ZIP|zip)[^\n]*/g)?.slice(0, 3)); await zip.fill("70806"); await page.waitForTimeout(900); log("signup: 70806 →", (await page.evaluate(() => document.body.innerText)).match(/Baton Rouge|East Baton Rouge/)?.[0]); await shot(page, "signup-step2-zip-375"); }
  const clipped2 = await page.$$eval('button, span, label', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 && /hidden|clip/.test(getComputedStyle(e).overflow + getComputedStyle(e).overflowX) && !/sr-only/.test(e.className)).map((e) => e.textContent.trim().slice(0, 30) + " " + e.scrollWidth + ">" + e.clientWidth));
  log("signup: step2 clipped", JSON.stringify(clipped2));
  await ctx.close();
} catch (e) { log('BLOCK FAILED', String(e).slice(0, 200)); }

// ---------- FORGOT / RESET ----------
try {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/forgot-password", { waitUntil: "networkidle" });
  await page.click('button[type=submit]'); await page.waitForTimeout(500);
  log("forgot: empty submit", (await page.evaluate(() => document.body.innerText)).match(/required|enter|valid/gi)?.slice(0, 3));
  await page.fill('input[type=email]', "bad"); await page.click('button[type=submit]'); await page.waitForTimeout(500);
  log("forgot: invalid email", (await page.evaluate(() => document.body.innerText)).match(/valid|email/gi)?.slice(0, 3));
  await page.route("**/auth/v1/**", (r) => r.abort());
  await page.fill('input[type=email]', "sweep-guest-test@example.com"); await page.click('button[type=submit]'); await page.waitForTimeout(2500);
  await shot(page, "forgot-network-fail-375");
  log("forgot: network fail msg", (await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, " | "));
  await page.goto(BASE + "/reset-password", { waitUntil: "networkidle" });
  await page.click('text="Request a Reset Link"'); await page.waitForTimeout(600);
  log("reset: request link →", page.url().replace(BASE, ""));
  await ctx.close();
} catch (e) { log('BLOCK FAILED', String(e).slice(0, 200)); }

// ---------- SUPPORT ----------
try {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/support", { waitUntil: "networkidle" });
  await page.click('button[type=submit]'); await page.waitForTimeout(600);
  await shot(page, "support-empty-submit-375");
  log("support: empty submit", (await page.evaluate(() => document.body.innerText)).match(/required|enter|valid|choose/gi)?.slice(0, 4));
  await page.fill('input[name=name], input#name, input:nth-of-type(1)', "Sweep Tester");
  await page.fill('input[type=email]', "not-an-email");
  await page.click('button[type=submit]'); await page.waitForTimeout(600);
  log("support: bad email", (await page.evaluate(() => document.body.innerText)).match(/valid email|email/gi)?.slice(0, 3));
  // topic select
  const sel = await page.$("select");
  if (sel) { const opts = await sel.$$eval("option", (o) => o.map((x) => x.textContent)); log("support: topics", JSON.stringify(opts)); await sel.selectOption({ index: 1 }); }
  else { const trig = await page.$('button[role=combobox]'); if (trig) { await trig.click(); await page.waitForTimeout(500); await shot(page, "support-topic-open-375"); const opts = await page.$$eval('[role=option]', (o) => o.map((x) => x.textContent.trim())); log("support: topics", JSON.stringify(opts)); await page.click('[role=option]'); } }
  await page.fill('input[type=email]', "sweep-guest-test@example.com");
  const subj = await page.$('input[name=subject], input#subject'); if (subj) await subj.fill("Sweep test subject");
  await page.fill("textarea", "This is a sweep test message. Please ignore.");
  await page.route("**/functions/v1/**", (r) => r.abort());
  await page.route("**/rest/v1/**", (r) => r.abort());
  await page.click('button[type=submit]'); await page.waitForTimeout(3000);
  await shot(page, "support-network-fail-375");
  log("support: network-fail UX", (await page.evaluate(() => document.body.innerText)).match(/[^\n]*(fail|try again|error|wrong|couldn)[^\n]*/i)?.[0]?.slice(0, 120) || "NO MESSAGE");
  await ctx.close();
} catch (e) { log('BLOCK FAILED', String(e).slice(0, 200)); }

// ---------- LEGAL ----------
try {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/legal", { waitUntil: "networkidle" });
  for (const t of ["Rules", "Privacy", "Terms"]) { await page.click(`[role=tab]:has-text("${t}")`); await page.waitForTimeout(500); log(`legal: tab ${t} →`, page.url().replace(BASE, "") + " h2=" + (await page.$$eval("h2, h3", (e) => e.length))); }
  const acc = await page.$$('button[aria-expanded]');
  log("legal: accordions", acc.length);
  if (acc[0]) { await acc[0].click(); await page.waitForTimeout(500); log("legal: accordion expanded", await acc[0].getAttribute("aria-expanded")); await shot(page, "legal-accordion-open-375"); }
  const s = await page.$('button[aria-label*="earch" i]');
  if (s) { await s.click(); await page.waitForTimeout(400); await page.fill('input', "fee"); await page.waitForTimeout(800); await shot(page, "legal-search-fee-375"); log("legal: search 'fee' hits", await page.$$eval("mark, [class*=highlight]", (e) => e.length)); }
  else log("legal: search", "MISSING");
  await page.goto(BASE + "/legal"); await page.click('text="Contact support"'); await page.waitForTimeout(600); log("legal: contact support →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/terms"); await page.waitForTimeout(500); log("/terms →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/privacy"); await page.waitForTimeout(500); log("/privacy →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/rules"); await page.waitForTimeout(500); log("/rules →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/legal/privacy"); await page.waitForTimeout(500); log("/legal/privacy →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/help-center"); await page.waitForTimeout(500); log("/help-center →", page.url().replace(BASE, ""));
  await ctx.close();
} catch (e) { log('BLOCK FAILED', String(e).slice(0, 200)); }

// ---------- HELP ----------
try {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/help", { waitUntil: "networkidle" });
  const acc = await page.$$('button[aria-expanded]');
  log("help: accordions", acc.length);
  await acc[0].click(); await page.waitForTimeout(500);
  const inner = await page.$$('button[aria-expanded="true"] ~ * button[aria-expanded], [data-state=open] button[aria-expanded]');
  log("help: inner accordions after open", inner.length);
  if (inner[0]) { await inner[0].click(); await page.waitForTimeout(500); }
  await shot(page, "help-open-375");
  const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")).filter((h) => h && !h.startsWith("http") && !h.startsWith("mailto")));
  log("help: internal links", JSON.stringify([...new Set(links)]));
  await page.click('text="Contact support"'); await page.waitForTimeout(600); log("help: contact support →", page.url().replace(BASE, ""));
  await ctx.close();
} catch (e) { log('BLOCK FAILED', String(e).slice(0, 200)); }

// ---------- 404 ----------
try {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/legal"); await page.goto(BASE + "/nope", { waitUntil: "networkidle" });
  await page.click('text="Go Back"'); await page.waitForTimeout(600); log("404: Go Back →", page.url().replace(BASE, ""));
  await page.goto(BASE + "/nope"); await page.click('text="Back to Home"'); await page.waitForTimeout(600); log("404: Back to Home →", page.url().replace(BASE, ""));
  await ctx.close();
} catch (e) { log('BLOCK FAILED', String(e).slice(0, 200)); }

// ---------- FOOTER ----------
try {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/legal", { waitUntil: "networkidle" });
  const f = await page.$$eval("footer a[href]", (as) => as.map((a) => [a.textContent.trim().slice(0, 20) || a.getAttribute("aria-label"), a.getAttribute("href")]));
  log("footer links", JSON.stringify(f));
  await ctx.close();
} catch (e) { log('BLOCK FAILED', String(e).slice(0, 200)); }
await b.close();
