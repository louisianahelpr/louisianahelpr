import { launch, all4, goto, shoot } from './lib.mjs';
const JOB = '[sweep-poster] Applicants waiting';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/my-posts', 1500);
  await page.locator(`text=${JOB}`).first().click(); await page.waitForTimeout(900);
  await shoot(page, 'p4_card_expanded', true);
  const names = await page.evaluate(() => [...document.querySelectorAll('main button')].map(b => (b.innerText.replace(/\s+/g,' ').trim() || '[' + b.getAttribute('aria-label') + ']')));
  console.log(vp, 'buttons:', names.join(' | '));
  for (const act of ['Applicants', 'Share', 'Boost', 'Edit', 'Cancel']) {
    await goto(page, '/my-posts', 1200);
    await page.locator(`text=${JOB}`).first().click(); await page.waitForTimeout(800);
    const btn = page.locator('main button', { hasText: new RegExp('^\\s*' + act + '\\s*$') }).first();
    if (!(await btn.count())) { console.log(vp, 'no button', act); continue; }
    await btn.click(); await page.waitForTimeout(1500);
    await shoot(page, 'p4_' + act.toLowerCase());
    const dlg = page.locator('[role=dialog]');
    if (await dlg.count()) {
      const txt = (await dlg.last().innerText()).replace(/\s+/g, ' ').slice(0, 400);
      console.log(vp, act, '->', txt);
      await dlg.last().evaluate(el => { for (const sc of el.querySelectorAll('*')) { if (sc.scrollHeight > sc.clientHeight + 4) sc.scrollTop = 99999; } });
      await page.waitForTimeout(300); await shoot(page, 'p4_' + act.toLowerCase() + '_bottom');
      await page.keyboard.press('Escape');
    } else { console.log(vp, act, 'no dialog; url', page.url()); await shoot(page, 'p4_' + act.toLowerCase() + '_page', true); }
  }
});
await b.close();
