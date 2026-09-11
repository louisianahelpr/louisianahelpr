import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(true); const page = await ctx(b, 'm', 'light');
await goto(page, '/my-posts');
await page.getByRole('button', { name: 'Search jobs' }).click(); await page.keyboard.type('zzz-nomatch'); await page.waitForTimeout(800);
await page.getByRole('button', { name: /^Show / }).click(); await page.waitForTimeout(900);
await shoot(page, 'p2_search_then_show');
console.log(await page.evaluate(() => document.querySelector('main')?.innerText.slice(0, 400)));
await b.close();
