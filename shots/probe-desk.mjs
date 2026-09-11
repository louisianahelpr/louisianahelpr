import { launch, VP, goto, shoot, measure, report } from "./lib.mjs";
const who = process.argv[2] || "helper";
const { browser, page, errors } = await launch({ who, viewport: VP.desktop, headless: true });
for (const [r, n] of [["/dashboard","dash"],["/my-jobs","myjobs"],["/profile?tab=notifications","notif"]]) {
  const t0 = Date.now();
  await goto(page, r, { wait: 500 });
  // poll until no skeleton/spinner
  let settled = null;
  for (let i = 0; i < 40; i++) {
    const busy = await page.evaluate(() => document.querySelectorAll('[class*="animate-pulse"], [class*="animate-spin"], [role="progressbar"]').length);
    if (busy === 0) { settled = Date.now() - t0; break; }
    await page.waitForTimeout(500);
  }
  await shoot(page, `probe-desk-${who}-${n}`);
  console.log(n, "settled ms:", settled, errors.splice(0).filter(e=>!/vibrate|_vercel|Failed|placeholder/.test(e)).slice(0,3));
}
await browser.close();
