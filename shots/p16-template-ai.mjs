import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/post-job', 1200);
  await page.locator('main button', { hasText: 'Use a Template' }).first().click(); await page.waitForTimeout(500);
  await page.locator('main button', { hasText: 'Show All' }).first().click().catch(()=>{}); await page.waitForTimeout(500);
  await shoot(page, 'p16_templates_all', true);
  await page.locator('button[aria-label^="Use template"]').first().click(); await page.waitForTimeout(1000);
  await shoot(page, 'p16_template_form', true);
  console.log(vp, 'template title:', await page.locator('#title').inputValue(), '| submit:', await page.locator('main button[type=submit]').last().innerText());
  // Repost
  await goto(page, '/post-job', 1200);
  await page.locator('main button', { hasText: 'Repost a Recent Job' }).first().click(); await page.waitForTimeout(500);
  const rp = page.locator('button[aria-label^="Repost"]').first();
  if (await rp.count()) { await rp.click(); await page.waitForTimeout(1000); await shoot(page, 'p16_repost_form', true); console.log(vp, 'repost title:', await page.locator('#title').inputValue(), '| desc len', (await page.locator('#description').inputValue()).length, '| submit:', await page.locator('main button[type=submit]').last().innerText()); }
  // AI builder
  await goto(page, '/post-job', 1200);
  await page.locator('main button', { hasText: 'Try the AI Job Builder' }).first().click(); await page.waitForTimeout(500);
  await page.locator('main textarea').first().fill('I need someone to pressure wash my driveway and back patio in Baton Rouge this Saturday morning, around 2 hours, I have the washer.');
  await page.locator('main button', { hasText: 'Generate Job Posting' }).click();
  await page.waitForTimeout(1500); await shoot(page, 'p16_ai_generating');
  await page.waitForTimeout(12000); await shoot(page, 'p16_ai_result', true);
  console.log(vp, 'ai title:', await page.locator('#title').inputValue().catch(()=>'(no form)'), (await page.locator('main').innerText()).replace(/\s+/g,' ').slice(0, 300));
});
await b.close();
