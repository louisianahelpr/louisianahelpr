import { chromium } from "playwright";
import fs from "node:fs";
const PHASE = process.argv[2];               // before | after
const OUT = "docs/audit/launch-2026-09/lanes/e2e/shots";
const JOB = "b732b37d-20e7-4685-abba-50d8602fe6b1";   // open + payment_status='abandoned'
const MARK = "Mow and edge the front yard";
const s = JSON.parse(fs.readFileSync("scratch/sess-poster.json", "utf8"));
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: false });
for (const [w, h] of [[375, 812], [1440, 900]]) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme });
    await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v);
      localStorage.setItem("helpr_onboarding", JSON.stringify({completed:true,currentStep:0,completedSteps:[]})); }, [s.key, s.value]);
    const p = await ctx.newPage();
    await p.goto(`http://localhost:8347/my-posts?filter=waiting`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(11000);
    const nn = p.getByRole("button", { name: /^Not now$/i }); if (await nn.count()) { await nn.click().catch(()=>{}); await p.waitForTimeout(1200); }
    const card = p.getByText(MARK).first();
    if (await card.count()) { await card.click(); await p.waitForTimeout(3000); } else console.log("!! card missing", w, scheme);
    const el = p.locator("text=" + MARK).first();
    await el.scrollIntoViewIfNeeded().catch(()=>{});
    await p.waitForTimeout(800);
    const f = `${OUT}/ghost-job-${PHASE}-${w}-${scheme}.png`;
    await p.screenshot({ path: f });
    console.log("shot", f);
    const body = (await p.innerText("body")).replace(/\s+/g, " ");
    const i = body.indexOf(MARK);
    console.log(`  ${w}/${scheme} ::`, body.slice(i, i + 420));
    await ctx.close();
  }
}
await b.close();
