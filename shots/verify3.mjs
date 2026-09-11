import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
await goto(page, '/my-posts', 1500);
await page.locator('text=[sweep-poster] Applicants two').first().click(); await page.waitForTimeout(800);
await page.locator('main button', { hasText: /Applicants \(2\)/ }).first().click();
// poll: the FIRST time any applicant name shows, record order + badge
for (let i = 0; i < 60; i++) { await page.waitForTimeout(250); const names = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Select "]')].map(b => b.getAttribute('aria-label'))); if (names.length) { const rec = await page.evaluate(() => { const badge = [...document.querySelectorAll('span')].find(s => /Helpr Recommended/i.test(s.textContent)); const card = badge?.closest('div')?.parentElement; return card?.innerText.replace(/\s+/g,' ').slice(0, 60); }); console.log('first paint at ~' + (i*250) + 'ms:', names, '| recommended card:', rec); await shoot(page, 'v3_applicants_firstpaint'); break; } }
await b.close();
