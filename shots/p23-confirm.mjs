import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/my-posts', 2000); await shoot(page, 'p24_needsyou_list', true);
  const card = page.locator('text=[sweep-poster] Applicants two').first();
  if (!(await card.count())) { console.log(vp, 'card not in default bucket; url', page.url()); await goto(page, '/my-posts?filter=done', 1500); }
  await page.locator('text=[sweep-poster] Applicants two').first().click(); await page.waitForTimeout(1000);
  await shoot(page, 'p24_confirm_card', true);
  const names = await page.evaluate(() => [...document.querySelectorAll('main button')].map(b => (b.innerText.replace(/\s+/g,' ').trim() || '[' + b.getAttribute('aria-label') + ']')));
  console.log(vp, 'buttons:', names.join(' | '));
  for (const act of ['Approve', 'Release', 'Confirm', 'Revision', 'Not done', 'Dispute']) {
    const btn = page.locator('main button', { hasText: new RegExp(act) }).first();
    if (!(await btn.count())) { console.log(vp, 'no', act); continue; }
    await btn.click(); await page.waitForTimeout(1500);
    await shoot(page, 'p24_' + act.toLowerCase());
    const dl = page.locator('[role=dialog]').last();
    console.log(vp, act, '->', (await dl.innerText().catch(()=>'(none)')).replace(/\s+/g,' ').slice(0, 600));
    await dl.evaluate(el => { el.scrollTop = 99999; for (const sc of el.querySelectorAll('*')) if (sc.scrollHeight > sc.clientHeight + 4) sc.scrollTop = 99999; }).catch(()=>{});
    await page.waitForTimeout(300); await shoot(page, 'p24_' + act.toLowerCase() + '_bottom');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    if (await page.locator('[role=dialog]').count()) { await page.locator('[role=dialog] button', { hasText: /Cancel|Close|Not now|Back/ }).first().click().catch(()=>{}); await page.waitForTimeout(400); }
  }
});
await b.close();
