import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
await goto(page, '/my-posts', 1500);
await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(800);
await page.locator('main button', { hasText: /Applicants \(2\)/ }).first().click();
await page.waitForTimeout(1500); await shoot(page, 'p9_applicants_loading');
await b.close();
