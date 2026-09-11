import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
await page.goto('http://localhost:4202/jobs/00000000-0000-0000-0000-000000000001');
for (let i = 1; i <= 8; i++) { await page.waitForTimeout(1000); const t = await page.evaluate(() => document.querySelector('[data-sonner-toaster]')?.innerText || ''); if (t) { console.log('t+' + i, 'toast:', t.replace(/\s+/g, ' ')); break; } }
await shoot(page, 'p12_missing_job_deeplink');
await b.close();
