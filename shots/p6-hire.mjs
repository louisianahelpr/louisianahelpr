import { launch, all4, goto, shoot } from './lib.mjs';
const JOB = '[sweep-poster] Applicants waiting';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/my-posts', 1500);
  await page.locator(`text=${JOB}`).first().click(); await page.waitForTimeout(800);
  await page.locator('main button', { hasText: /Applicants \(2\)/ }).first().click();
  await page.locator('text=Hallie H.').waitFor({ timeout: 15000 }); await page.waitForTimeout(600);
  await shoot(page, 'p6_applicants');
  // Hire Hallie
  const hallieCard = page.locator('text=Hallie H.').locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
  await page.locator('button', { hasText: /^Hire$/ }).nth(1).click(); await page.waitForTimeout(1500);
  await shoot(page, 'p6_hire_dialog');
  const dl = page.locator('[role=dialog]').last();
  console.log(vp, 'hire dialog:', (await dl.innerText().catch(()=>'(none)')).replace(/\s+/g,' ').slice(0, 700));
  await dl.evaluate(el => { el.scrollTop = 99999; for (const sc of el.querySelectorAll('*')) if (sc.scrollHeight > sc.clientHeight + 4) sc.scrollTop = 99999; }).catch(()=>{});
  await page.waitForTimeout(300); await shoot(page, 'p6_hire_dialog_bottom');
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  // Hire Eli (no payout)
  await page.locator('button', { hasText: /^Hire$/ }).nth(0).click(); await page.waitForTimeout(1500);
  await shoot(page, 'p6_hire_nopayout');
  console.log(vp, 'hire nopayout:', (await page.locator('[role=dialog]').last().innerText().catch(()=>'(none)')).replace(/\s+/g,' ').slice(0, 500));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  // Decline Eli
  const x = page.locator('[role=dialog] button[aria-label], main button[aria-label]').filter({ hasNot: page.locator('svg.hidden') });
  const labels = await page.evaluate(() => [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')));
  console.log(vp, 'aria buttons:', labels.join(' | '));
  const decl = page.locator('button[aria-label*="ecline"], button[aria-label*="Pass"], button[aria-label*="Dismiss Eli"], button[aria-label*="Not now"]').first();
  if (await decl.count()) { await decl.click(); await page.waitForTimeout(1500); await shoot(page, 'p6_decline_sheet'); console.log(vp, 'decline:', (await page.locator('[role=dialog]').last().innerText().catch(()=>'(none)')).replace(/\s+/g,' ').slice(0, 500)); await page.keyboard.press('Escape'); }
  // Add private note
  await page.locator('button', { hasText: /Add Private Note/ }).first().click(); await page.waitForTimeout(800); await shoot(page, 'p6_private_note');
});
await b.close();
