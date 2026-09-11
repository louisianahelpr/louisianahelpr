import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
await goto(page, '/my-posts?filter=done', 2500);
await page.locator('text=[sweep-poster] Applicants two').first().click(); await page.waitForTimeout(1200);
console.log(await page.evaluate(() => [...document.querySelectorAll('main button')].map(b => (b.innerText.replace(/\s+/g,' ').trim() || '[' + b.getAttribute('aria-label') + ']')).join(' | ')));
await shoot(page, 'v6_card');
const r = page.locator('main button', { hasText: /Review/ }).first();
if (await r.count()) { await r.click(); await page.waitForTimeout(1500); console.log('review title:', await page.evaluate(() => [...document.querySelectorAll('[role=dialog] *')].map(e => e.innerText).find(t => /^Rate /.test(t || '')))); await shoot(page, 'v6_review_title'); }
await b.close();
