import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
await goto(page, '/profile?tab=profile', 2000);
console.log(await page.evaluate(() => { const out = []; for (const el of document.querySelectorAll('main button')) { const r = el.getBoundingClientRect(); if (r.right > 376 && r.width) { const sc = el.closest('[class*=overflow-x]'); out.push({ text: el.innerText.slice(0,40), right: Math.round(r.right), top: Math.round(r.top), scroller: sc ? sc.className.slice(0,80) : null, scrollerSW: sc?.scrollWidth, scrollerCW: sc?.clientWidth }); } } return out; }));
await page.evaluate(() => window.scrollTo(0, 600)); await page.waitForTimeout(300); await shoot(page, 'p18_editprofile_mid');
await page.evaluate(() => window.scrollTo(0, 1300)); await page.waitForTimeout(300); await shoot(page, 'p18_editprofile_low');
await b.close();
