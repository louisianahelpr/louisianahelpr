import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'd', 'light');
await goto(page, '/my-posts', 1500);
await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(800);
await page.locator('main button', { hasText: /Applicants \(2\)/ }).first().click(); await page.waitForTimeout(4000);
await shoot(page, 'p7_applicants_desktop');
console.log(await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0,1500)));
await b.close();
