import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/my-posts?filter=done', 2000); await shoot(page, 'p22_done_list', true);
  await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(1000);
  await shoot(page, 'p22_done_card', true);
  const names = await page.evaluate(() => [...document.querySelectorAll('main button')].map(b => (b.innerText.replace(/\s+/g,' ').trim() || '[' + b.getAttribute('aria-label') + ']')));
  console.log(vp, 'buttons:', names.join(' | '));
  for (const act of ['Review', 'Tip', 'Dispute', 'Rebook', 'Report']) {
    const btn = page.locator('main button', { hasText: new RegExp('^\\s*' + act) }).first();
    if (!(await btn.count())) { console.log(vp, 'no', act); continue; }
    await btn.click(); await page.waitForTimeout(1500);
    await shoot(page, 'p22_' + act.toLowerCase());
    const dl = page.locator('[role=dialog]').last();
    console.log(vp, act, '->', (await dl.innerText().catch(()=>'(none)')).replace(/\s+/g,' ').slice(0, 500));
    await dl.evaluate(el => { el.scrollTop = 99999; for (const sc of el.querySelectorAll('*')) if (sc.scrollHeight > sc.clientHeight + 4) sc.scrollTop = 99999; }).catch(()=>{});
    await page.waitForTimeout(300); await shoot(page, 'p22_' + act.toLowerCase() + '_bottom');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    if (await page.locator('[role=dialog]').count()) { await page.locator('[role=dialog] button', { hasText: /Cancel|Close|Not now/ }).first().click().catch(()=>{}); await page.waitForTimeout(400); }
  }
});
await b.close();
