import { launch, ctx, goto, shoot } from './lib.mjs';
import { fillForm } from './p14-fill.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
page.on('response', r => { const u = r.url(); if (/functions\/v1|checkout|stripe/.test(u)) console.log(r.status(), u.slice(0, 140)); });
await fillForm(page, 'm');
await page.locator('main button[type=submit]').last().click(); await page.waitForTimeout(1500);
await shoot(page, 'p15_checkout_top', true);
// toggles + checkbox
await page.locator('main [role=checkbox], main input[type=checkbox]').last().click(); await page.waitForTimeout(400);
await shoot(page, 'p15_checkout_confirmed');
const btn = page.locator('main button', { hasText: /Pay|Continue|Confirm/ }).last();
console.log('btn:', await btn.innerText());
await btn.click(); 
for (let i = 0; i < 12; i++) { await page.waitForTimeout(1000); const u = page.url(); if (!/localhost/.test(u)) { console.log('navigated to', u.slice(0, 80)); break; } if (i === 2) await shoot(page, 'p15_redirecting'); }
console.log('final url', page.url().slice(0, 100));
await shoot(page, 'p15_stripe');
await b.close();
