import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
page.on('request', r => { if (r.method() === 'POST' || r.method() === 'PATCH') console.log('REQ', r.method(), r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 100), (r.postData()||'').slice(0, 200)); });
page.on('response', async r => { if ((r.request().method() === 'POST' || r.request().method() === 'PATCH') && r.status() >= 300) console.log('RES', r.status(), r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 100), (await r.text().catch(()=>'')).slice(0, 300)); });
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await goto(page, '/my-posts?filter=done', 2000);
await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(900);
await page.locator('main button', { hasText: /^\s*Dispute/ }).first().click(); await page.waitForTimeout(1200);
const dl = page.locator('[role=dialog]').last();
await dl.locator('select, [role=combobox]').first().click(); await page.waitForTimeout(400); await page.locator('[role=option]').nth(1).click(); await page.waitForTimeout(300);
await dl.locator('textarea').first().fill('The apartment was only half cleaned: kitchen untouched, bathroom mirrors streaked.');
console.log('--- submit');
await dl.locator('button', { hasText: /Submit Dispute/ }).click();
for (let i = 0; i < 8; i++) { await page.waitForTimeout(1000); const open = await page.locator('[role=dialog]').count(); const t = await page.evaluate(() => document.querySelector('[data-sonner-toaster]')?.innerText?.replace(/\s+/g,' ') || ''); console.log('t+' + (i+1), 'dialogs', open, 'toast:', t.slice(0, 120)); }
await shoot(page, 'p30_after_submit');
await b.close();
