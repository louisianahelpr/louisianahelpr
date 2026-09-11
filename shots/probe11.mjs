import { launch, ctx, goto } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
page.on('response', async r => { const u = r.url(); if (/jobs\?select=id%2Ccustomer_id/.test(u)) console.log(r.status(), await r.text()); });
page.on('console', m => { if (/QuickApply|cancel/i.test(m.text())) console.log('C', m.text()); });
await goto(page, '/jobs/5979d626-15de-4b5d-beb0-51973338b101', 6000);
console.log('url', page.url());
console.log(await page.evaluate(() => document.querySelector('[data-sonner-toaster]')?.innerText));
await b.close();
