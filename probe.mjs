import { chromium } from "playwright";
import { execSync } from "node:child_process";
const sess = JSON.parse(execSync("node scripts/test-signin-link.mjs helper --session --json").toString());
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] })); }, [sess.key, sess.value]);
const page = await ctx.newPage();
for (const url of ["/admin?view=people", "/dashboard", "/legal"]) {
  await page.goto("http://localhost:4205" + url, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const root = document.getElementById("root"); const cs = getComputedStyle(root);
    const rail = document.querySelector(".desktop-rail, aside, nav[aria-label]");
    const main = document.querySelector("main"); const mr = main?.getBoundingClientRect();
    return { html: document.documentElement.className, rootPR: cs.paddingRight, rootPT: cs.paddingTop, rootW: root.getBoundingClientRect().width, mainRight: mr?.right, mainW: mr?.width, railLeft: [...document.querySelectorAll("*")].filter(e => getComputedStyle(e).position === "fixed" && e.getBoundingClientRect().width > 150 && e.getBoundingClientRect().width < 320).map(e => e.tagName + "." + [...e.classList].slice(0, 3).join(".") + "@" + Math.round(e.getBoundingClientRect().left)) };
  });
  console.log(url, JSON.stringify(r));
}
await b.close();
