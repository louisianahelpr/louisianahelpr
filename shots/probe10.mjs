import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
const t0 = Date.now();
page.on('response', r => { const u = r.url(); if (/open_jobs_browse|jobs\?select=id%2Ccustomer_id|jobs\?select=id,customer/.test(u)) console.log(((Date.now()-t0)/1000).toFixed(1), r.status(), u.replace(/^https:\/\/[^/]+/, '').slice(0, 160)); });
await goto(page, '/jobs/5979d626-15de-4b5d-beb0-51973338b101', 8000);
console.log('url', page.url());
console.log('toasts:', await page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast], [role=status]')].map(e => e.innerText).join(' || ')));
await shoot(page, 'p12_cancelled_deeplink');
await b.close();
