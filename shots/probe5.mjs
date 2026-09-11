import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
await goto(page, '/my-posts', 1500);
await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(800);
page.errors.length = 0;
await page.locator('main button', { hasText: /^\s*Share\s*$/ }).first().click(); await page.waitForTimeout(1500);
console.log('share errs:', page.errors);
console.log('toasts:', await page.evaluate(() => [...document.querySelectorAll('[role=status], [data-sonner-toast], li[data-radix-toast], [role=alert]')].map(e => e.innerText).join(' || ')));
await shoot(page, 'p5_share_after');
// Edit dialog geometry
await page.locator('main button', { hasText: /^\s*Edit\s*$/ }).first().click(); await page.waitForTimeout(1200);
console.log(await page.evaluate(() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); const r = d.getBoundingClientRect(); const scs = [...d.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)).map(e => e.className.slice(0,60) + ` sh=${e.scrollHeight} ch=${e.clientHeight}`); return { rect: [r.top, r.height, r.bottom], vh: innerHeight, dsh: d.scrollHeight, dch: d.clientHeight, overflowY: getComputedStyle(d).overflowY, scs }; }));
await b.close();
