import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/post-job', 1500);
  await shoot(page, 'p13_entry', true);
  // expand template + repost sections
  for (const t of ['Repost a Recent Job', 'Use a Template', 'Try the AI Job Builder']) {
    const btn = page.locator('main button', { hasText: t }).first();
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(700); await shoot(page, 'p13_entry_' + t.split(' ')[0].toLowerCase(), true); }
  }
  // Start fresh
  await goto(page, '/post-job', 1200);
  await page.locator('main button', { hasText: 'Start Fresh' }).first().click(); await page.waitForTimeout(1000);
  await shoot(page, 'p13_form_empty', true);
  // Try submitting empty
  const submit = page.locator('main button[type=submit], main button', { hasText: /Continue|Review/ }).last();
  console.log(vp, 'submit label empty:', await submit.innerText().catch(()=>'?'));
  await submit.click({ force: true }).catch(()=>{}); await page.waitForTimeout(800);
  await shoot(page, 'p13_form_submit_empty', true);
  // Fill title too long / boundary
  await page.locator('#title').fill('A'.repeat(40)); await page.waitForTimeout(300);
  await shoot(page, 'p13_form_title_toolong');
  console.log(vp, 'title value len:', (await page.locator('#title').inputValue()).length, 'error:', await page.locator('#title-too-long').innerText().catch(()=>'(none)'));
});
await b.close();
