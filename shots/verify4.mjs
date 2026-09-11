import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
page.on('response', r => { if (r.status() >= 400 && /messages\?/.test(r.url())) console.log('HTTP', r.status(), r.url().slice(0, 120)); });
// 1. Escalate confirm
await goto(page, '/my-posts', 2000);
await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(900);
await page.locator('main button', { hasText: /Escalate/ }).first().click(); await page.waitForTimeout(1200);
await shoot(page, 'v4_escalate_confirm');
console.log('escalate dialog:', (await page.locator('[role=dialog]').last().innerText().catch(()=>'(none)')).replace(/\s+/g,' ').slice(0, 300));
await page.locator('[role=dialog] button', { hasText: /Cancel/ }).click(); await page.waitForTimeout(500);
await page.locator('main button', { hasText: /Resolve & Pay/ }).first().click(); await page.waitForTimeout(1000);
console.log('release copy:', (await page.locator('[role=dialog]').last().innerText()).replace(/\s+/g,' ').match(/to [^.]+\.+ You/)?.[0]);
await page.locator('[role=dialog] button', { hasText: /Cancel/ }).click();
// 2. Review title: use Applicants two after finishing revision? use the completed 'Applicants waiting' — it's disputed now. Set a1f7c4c9 aside; check title on 151252c1 later.
// 3. messages mark read
await goto(page, '/messages', 2500);
await page.locator('main button', { hasText: /Hallie/ }).first().click(); await page.waitForTimeout(4000);
console.log('unread after open (via DB check below)');
await b.close();
