import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(true); const page = await ctx(b, 'm', 'dark');
await goto(page, '/my-posts', 3000);
await shoot(page, 'probe_myposts_now');
console.log(await page.evaluate(() => document.body.innerText.slice(0, 500)));
await b.close();
