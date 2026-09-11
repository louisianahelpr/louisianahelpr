// Design-checklist measurements (items 5, 6, 13, 14) across all admin views at 375 + 1440, light.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
const VIEWS = ["home","analytics","people","jobs","settings","disputes","broadcasts","notifications","notiflogs","reports","support","referrals","subscriptions","fraud","audit","health","export","payouts","tiers","marketing","social","idvreview","credentials","exceptions","banreview"];
const sess = JSON.parse(execSync("node scripts/test-signin-link.mjs helper --session --json").toString());
const b = await chromium.launch({ headless: true });
const agg = { fonts: {}, italics: {}, small: {}, flatPrimary: {}, h1: {}, titleSizes: {} };
for (const vw of [375, 1440]) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vw === 375 ? 812 : 900 } });
  await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] })); }, [sess.key, sess.value]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  for (const view of VIEWS) {
    await page.goto(`http://localhost:4205/admin?view=${view}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const main = document.querySelectorAll("main")[1] || document.querySelector("main");
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const fonts = new Set(), italics = [], small = [], flat = [], titleSizes = new Set();
      for (const el of main.querySelectorAll("*")) {
        if (!vis(el)) continue;
        const cs = getComputedStyle(el);
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (hasText) {
          const f = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
          if (!/Bodoni|Montserrat/i.test(f)) fonts.add(f + " @" + el.tagName + " '" + el.textContent.trim().slice(0, 30) + "'");
          if (cs.fontStyle === "italic" && !/^H[1-3]$/.test(el.tagName) && !el.closest("h1,h2,h3")) italics.push(el.tagName + " '" + el.textContent.trim().slice(0, 40) + "'");
        }
        if (el.matches("button, a[href], [role=switch], [role=tab], [role=radio], input[type=checkbox]")) {
          const r = el.getBoundingClientRect();
          if ((r.height < 44 || r.width < 44) && !el.closest("[role=tablist]") ) small.push(`${el.tagName}${el.getAttribute("role") ? "[" + el.getAttribute("role") + "]" : ""} '${(el.getAttribute("aria-label") || el.textContent).trim().slice(0, 24)}' ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        if (el.matches("button") && cs.backgroundImage === "none" && el.classList.contains("btn-grad-primary")) flat.push(el.textContent.trim().slice(0, 30));
      }
      const h1 = document.querySelector("h1"); const h1cs = h1 && getComputedStyle(h1);
      return { fonts: [...fonts], italics: [...new Set(italics)], small: [...new Set(small)], flat, h1: h1 ? `${h1cs.fontFamily.split(",")[0]} ${h1cs.fontSize}` : "none" };
    });
    agg.fonts[`${view}@${vw}`] = r.fonts; agg.italics[`${view}@${vw}`] = r.italics; agg.small[`${view}@${vw}`] = r.small; agg.flatPrimary[`${view}@${vw}`] = r.flat; agg.h1[`${view}@${vw}`] = r.h1;
    console.log(`${view}@${vw} h1=${r.h1} fonts=${r.fonts.length} italics=${r.italics.length} small=${r.small.length} flat=${r.flat.length}`);
    if (r.fonts.length) console.log("   fonts:", r.fonts.slice(0, 5));
    if (r.italics.length) console.log("   italics:", r.italics.slice(0, 6));
    if (r.small.length) console.log("   small:", r.small.slice(0, 8));
    if (r.flat.length) console.log("   FLAT PRIMARY:", r.flat);
  }
  await ctx.close();
}
await b.close();
