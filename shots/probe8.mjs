import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
const t0 = Date.now();
page.on('response', r => { const u = r.url(); if (/rest\/v1|rpc/.test(u)) console.log(((Date.now()-t0)/1000).toFixed(1), r.status(), u.replace(/^https:\/\/[^/]+/, '').slice(0, 120)); });
await goto(page, '/my-posts', 1500);
await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(800);
console.log('CLICK applicants at', ((Date.now()-t0)/1000).toFixed(1));
await page.locator('main button', { hasText: /Applicants \(2\)/ }).first().click();
for (let i = 0; i < 30; i++) { await page.waitForTimeout(1000); const has = await page.locator('text=Hallie H.').count(); const hdr = await page.locator('text=Applicants').count(); if (i % 3 === 0 || has) console.log('t+' + (i+1), 'hallie', has, 'hdrs', hdr); if (has) break; }
await shoot(page, 'p8_probe');
await b.close();
