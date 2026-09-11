import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
// 1. search miss → Clear search
await goto(page, '/my-posts', 1500);
await page.getByRole('button', { name: 'Search jobs' }).click(); await page.keyboard.type('zzz-nomatch'); await page.waitForTimeout(800);
await shoot(page, 'v1_search_miss');
const cta = await page.locator('main button', { hasText: /Clear search|^Show / }).first().innerText();
console.log('search-miss CTA:', cta);
await page.locator('main button', { hasText: /Clear search/ }).click(); await page.waitForTimeout(800);
console.log('after clear: cards =', await page.locator('button:has-text("Expand Job Details")').count(), 'q=', new URL(page.url()).searchParams.get('q'));
// 2. description wrap
await goto(page, '/my-posts?filter=waiting', 1500);
await page.locator('text=[sweep-poster] Urgent long desc').first().click(); await page.waitForTimeout(900);
const d = await page.evaluate(() => { const p = [...document.querySelectorAll('main p')].find(p => /Supercali/.test(p.textContent)); const r = p.getBoundingClientRect(); const card = p.closest('[class*=rounded]'); return { pRight: r.right, sw: p.scrollWidth, cw: p.clientWidth, cardRight: card?.getBoundingClientRect().right }; });
console.log('desc:', d);
await shoot(page, 'v1_desc_wrap');
// 3. city field
await goto(page, '/post-job', 1200);
await page.locator('main button', { hasText: 'Start Fresh' }).first().click(); await page.waitForTimeout(800);
await page.locator('#city').fill('Baton Rouge'); await page.waitForTimeout(200);
console.log('city:', await page.evaluate(() => { const c = document.querySelector('#city'); return { sw: c.scrollWidth, cw: c.clientWidth, w: c.getBoundingClientRect().width }; }));
await page.locator('#city').scrollIntoViewIfNeeded(); await shoot(page, 'v1_city');
await b.close();
