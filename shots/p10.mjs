import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/my-posts?filter=waiting', 2000);
  await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(1000);
  await shoot(page, 'p10_offered_card', true);
  console.log(vp, await page.evaluate(() => [...document.querySelectorAll('main button')].map(b => (b.innerText.replace(/\s+/g,' ').trim() || '[' + b.getAttribute('aria-label') + ']')).join(' | ')));
  await goto(page, '/my-posts?filter=waiting', 1500);
  await page.locator('text=[sweep-poster] Urgent long desc').first().click(); await page.waitForTimeout(1000);
  await shoot(page, 'p10_urgent_longdesc_card', true);
  await goto(page, '/my-posts?filter=waiting', 1500);
  await page.locator('text=[sweep-poster] Long title').first().click(); await page.waitForTimeout(1000);
  await shoot(page, 'p10_longtitle_card', true);
});
await b.close();
