import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/my-posts');
  await page.locator('text=[polish-seed] Overdue open').first().click(); await page.waitForTimeout(1200);
  await shoot(page, 'p3_card_open');
  const dlg = page.locator('[role=dialog]').last();
  const btns = dlg.locator('button, a');
  const names = []; for (let i = 0; i < await btns.count(); i++) { const t = (await btns.nth(i).innerText().catch(()=>'')).replace(/\s+/g,' ').trim(); const al = await btns.nth(i).getAttribute('aria-label'); names.push(t || `[${al}]`); }
  console.log(vp, 'dialog controls:', names.join(' | '));
  // scroll dialog to bottom
  await dlg.evaluate(el => { const sc = el.querySelector('[class*=overflow-y]') || el; sc.scrollTop = 99999; });
  await page.waitForTimeout(400); await shoot(page, 'p3_card_open_bottom');
});
await b.close();
