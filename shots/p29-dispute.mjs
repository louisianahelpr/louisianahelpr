import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
page.on('response', async r => { if (/rpc\/|functions\/v1/.test(r.url()) && r.request().method() === 'POST' && /disput/.test(r.url())) console.log('NET', r.status(), r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 80), (await r.text().catch(()=>'')).slice(0, 200)); });
await goto(page, '/my-posts?filter=done', 2000);
await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(900);
await page.locator('main button', { hasText: /^\s*Dispute/ }).first().click(); await page.waitForTimeout(1200);
const dl = page.locator('[role=dialog]').last();
// submit empty first
await dl.locator('button', { hasText: /Submit Dispute/ }).click({ force: true }); await page.waitForTimeout(800); await shoot(page, 'p29_dispute_empty_submit');
console.log('empty submit text:', (await dl.innerText()).replace(/\s+/g,' ').slice(0, 200));
// pick reason
const sel = dl.locator('select, [role=combobox]').first(); await sel.click(); await page.waitForTimeout(500); await shoot(page, 'p29_dispute_reasons');
const opt = page.locator('[role=option], select option').first();
console.log('options:', await page.evaluate(() => [...document.querySelectorAll('[role=option]')].map(o => o.innerText.trim()).join(' | ')));
await page.locator('[role=option]').first().click().catch(async () => { await sel.selectOption({ index: 1 }); });
await page.waitForTimeout(400);
await dl.locator('textarea').first().fill('The apartment was only half cleaned: kitchen untouched, bathroom mirrors streaked. I have photos from right after she left.');
await shoot(page, 'p29_dispute_filled');
await dl.locator('button', { hasText: /Submit Dispute/ }).click(); await page.waitForTimeout(3500);
await shoot(page, 'p29_dispute_after', true);
console.log('after:', (await page.locator('main').innerText()).replace(/\s+/g,' ').slice(0, 500));
console.log('toast:', await page.evaluate(() => document.querySelector('[data-sonner-toaster]')?.innerText?.replace(/\s+/g,' ')));
await b.close();
