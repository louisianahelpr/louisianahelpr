import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/my-posts', 2000);
  await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(900);
  await shoot(page, 'p31_disputed_card', true);
  console.log(vp, 'btns:', await page.evaluate(() => [...document.querySelectorAll('main button')].map(b => (b.innerText.replace(/\s+/g,' ').trim() || '[' + b.getAttribute('aria-label') + ']')).join(' | ')));
  const v = page.locator('main button', { hasText: /View Dispute|Dispute/ }).first();
  if (await v.count()) { await v.click(); await page.waitForTimeout(1500); await shoot(page, 'p31_view_dispute'); console.log(vp, 'view:', (await page.locator('[role=dialog]').last().innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0, 500)); const dl = page.locator('[role=dialog]').last(); await dl.evaluate(el => { el.scrollTop = 99999; for (const sc of el.querySelectorAll('*')) if (sc.scrollHeight > sc.clientHeight + 4) sc.scrollTop = 99999; }).catch(()=>{}); await page.waitForTimeout(300); await shoot(page, 'p31_view_dispute_bottom'); }
});
await b.close();
