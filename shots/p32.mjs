import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'light');
for (const act of ['Resolve & Pay', 'Escalate', 'Timeline & Evidence', 'Contact Admin']) {
  await goto(page, '/my-posts', 2000);
  await page.locator('text=[sweep-poster] Applicants waiting').first().click(); await page.waitForTimeout(900);
  if (act === 'Resolve & Pay') await shoot(page, 'p32_disputed_card_full', true);
  await page.locator('main button', { hasText: act }).first().click(); await page.waitForTimeout(1500);
  const tag = act.replace(/[^a-z]/gi, '').toLowerCase();
  await shoot(page, 'p32_' + tag);
  const dl = page.locator('[role=dialog]').last();
  console.log(act, '->', page.url().replace('http://localhost:4202', ''), '|', (await dl.innerText().catch(()=>'(no dialog)')).replace(/\s+/g,' ').slice(0, 400));
  await dl.evaluate(el => { el.scrollTop = 99999; for (const sc of el.querySelectorAll('*')) if (sc.scrollHeight > sc.clientHeight + 4) sc.scrollTop = 99999; }).catch(()=>{}); await page.waitForTimeout(300); await shoot(page, 'p32_' + tag + '_bottom');
  await page.keyboard.press('Escape');
}
await b.close();
