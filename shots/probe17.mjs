import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
page.on('response', r => { if (/storage\/v1/.test(r.url())) console.log('STORAGE', r.status(), r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 140)); });
await goto(page, '/messages?chat=1', 6000);
console.log(await page.evaluate(() => [...document.querySelectorAll('main img')].map(i => ({ src: i.src.slice(0, 120), nw: i.naturalWidth, complete: i.complete, w: Math.round(i.getBoundingClientRect().width), alt: i.alt }))));
await shoot(page, 'p21_thread_imgs');
console.log(await page.evaluate(() => [...document.querySelectorAll('main input, main textarea')].map(e => e.tagName + '#' + e.id + ' ' + (e.placeholder||e.getAttribute('aria-label')))));
await b.close();
