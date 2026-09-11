import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
page.on('response', async r => { if (/rpc|functions\/v1/.test(r.url()) && r.request().method() === 'POST' && /release|revision|complete|approve/.test(r.url())) console.log('NET', r.status(), r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 100), (await r.text().catch(()=>'')).slice(0, 200)); });
await goto(page, '/my-posts', 2000);
await page.locator('text=[sweep-poster] Applicants two').first().click(); await page.waitForTimeout(900);
await page.locator('main button', { hasText: /Approve/ }).first().click(); await page.waitForTimeout(1200);
await shoot(page, 'p25_howdiditgo');
await page.locator('[role=dialog] button', { hasText: /Fixed First|Revision/ }).first().click(); await page.waitForTimeout(1200);
await shoot(page, 'p25_revision_dialog');
const dl = page.locator('[role=dialog]').last();
console.log('revision dialog:', (await dl.innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0, 600));
const ta = dl.locator('textarea').first();
if (await ta.count()) { await ta.fill('The oven was not cleaned inside and the fridge shelves are still sticky. Photos attached.'); await page.waitForTimeout(300); await shoot(page, 'p25_revision_filled'); }
const submit = dl.locator('button', { hasText: /Request|Send|Submit/ }).last();
console.log('submit label:', await submit.innerText().catch(()=>'?'));
await submit.click(); await page.waitForTimeout(3000);
await shoot(page, 'p25_after_revision', true);
console.log('toast:', await page.evaluate(() => document.querySelector('[data-sonner-toaster]')?.innerText?.replace(/\s+/g,' ')));
await b.close();
