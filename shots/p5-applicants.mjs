import { launch, all4, goto, shoot } from './lib.mjs';
const JOB = '[sweep-poster] Applicants waiting';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/my-posts', 1500);
  await page.locator(`text=${JOB}`).first().click(); await page.waitForTimeout(800);
  await page.locator('main button', { hasText: /Applicants \(2\)/ }).first().click(); await page.waitForTimeout(2000);
  await shoot(page, 'p5_applicants', true);
  const names = await page.evaluate(() => [...document.querySelectorAll('main button, [role=dialog] button')].map(b => (b.innerText.replace(/\s+/g,' ').trim() || '[' + b.getAttribute('aria-label') + ']')));
  console.log(vp, 'buttons:', names.join(' | '));
  console.log(vp, 'text:', (await page.locator('main').innerText()).replace(/\s+/g,' ').slice(0, 900));
});
await b.close();
