import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
await goto(page, '/post-job', 1200);
await page.locator('main button', { hasText: 'Start Fresh' }).first().click(); await page.waitForTimeout(1000);
console.log(await page.evaluate(() => [...document.querySelectorAll('main input, main textarea, main select, main button, main [role=combobox], main [role=radio], main [role=switch]')].map(e => `${e.tagName}#${e.id}[${e.type||e.getAttribute('role')||''}] "${(e.getAttribute('aria-label')||e.placeholder||e.innerText||'').replace(/\s+/g,' ').slice(0,40)}"`).join('\n')));
await b.close();
