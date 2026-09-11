import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
await goto(page, '/post-job', 1200);
await page.locator('main button', { hasText: 'Start Fresh' }).first().click(); await page.waitForTimeout(800);
await page.locator('#city').fill('Baton Rouge'); await page.locator('#zipCode').fill('70808'); await page.waitForTimeout(200);
console.log('city:', await page.evaluate(() => ['#city','#state','#zipCode'].map(id => { const c = document.querySelector(id); return id + ` sw=${c.scrollWidth} cw=${c.clientWidth}`; }).join(' | ')));
await page.locator('#city').scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await shoot(page, 'v2_city');
await b.close();
