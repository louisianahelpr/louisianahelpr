import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/gift-card', 2000);
  console.log(vp, 'gift controls:', await page.evaluate(() => [...document.querySelectorAll('main input, main button, main [role=radio]')].map(e => (e.tagName + ' ' + (e.getAttribute('aria-label') || e.placeholder || e.innerText || '').replace(/\s+/g,' ').trim().slice(0,30))).join(' | ')));
  const sendBtn = page.locator('main button', { hasText: /Send|Continue|Pay|Buy|Checkout/ }).last();
  console.log(vp, 'gift CTA:', await sendBtn.innerText().catch(()=>'?'), 'disabled', await sendBtn.isDisabled().catch(()=>'?'));
  await sendBtn.click({ force: true }).catch(()=>{}); await page.waitForTimeout(800); await shoot(page, 'p27_gift_submit_empty', true);
  const rec = page.locator('main input').first(); await rec.fill('not-an-email'); await page.waitForTimeout(300);
  const amt = page.locator('main input[inputmode=decimal], main input[aria-label*="mount"]').first(); if (await amt.count()) { await amt.fill('1'); }
  await sendBtn.click({ force: true }).catch(()=>{}); await page.waitForTimeout(800); await shoot(page, 'p27_gift_invalid', true);
  console.log(vp, 'gift invalid text:', (await page.locator('main').innerText()).replace(/\s+/g,' ').slice(0, 500));
  // subscription tab
  await goto(page, '/profile?tab=subscription', 2000);
  await shoot(page, 'p27_sub_top');
  for (const t of ['Once', 'Annual']) { const tb = page.locator('main button', { hasText: new RegExp('^' + t + '$') }).first(); if (await tb.count()) { await tb.click(); await page.waitForTimeout(600); await shoot(page, 'p27_sub_' + t.toLowerCase(), true); } }
  const change = page.locator('main button', { hasText: /Change|Upgrade|Choose|Select/ }).first();
  if (await change.count()) { await change.click(); await page.waitForTimeout(1500); await shoot(page, 'p27_sub_change'); console.log(vp, 'sub change ->', page.url(), (await page.locator('[role=dialog]').last().innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0, 300)); await page.keyboard.press('Escape'); }
});
await b.close();
