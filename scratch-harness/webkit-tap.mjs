// Diagnostic only (never landed): taps a calendar day in real WebKit, three contexts.
import { webkit, devices } from "playwright";
const b = await webkit.launch();
for (const mode of ["alone", "logistics", "scroller"]) {
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log(mode, "pageerror", e.message));
  await p.goto(`http://127.0.0.1:4320/scratch-harness/cal.html?mode=${mode}`, { waitUntil: "networkidle" });
  const day = await p.evaluate(() => { const t = new Date(); t.setDate(t.getDate() + 2); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; });
  let btn = p.locator(`[data-day="${day}"] button`);
  if (!(await btn.count())) { await p.locator('button[aria-label*="next" i]').first().click(); btn = p.locator(`[data-day="${day}"] button`); }
  await btn.waitFor({ timeout: 20000 }); await btn.scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  const box = await btn.boundingBox();
  const hit = await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName} ${String(e.className).slice(0, 50)} "${e.textContent.slice(0, 10)}"` : null; }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(600);
  const tapResult = `${await p.locator("#out").textContent()} calls=${await p.evaluate(() => window.calls || 0)}`;
  await p.screenshot({ path: `test-results/webkit-cal-${mode}.png` });
  console.log(`RESULT ${mode}: day=${day} hit=${hit} after-tap: ${tapResult}`);
  await ctx.close();
}
await b.close();
