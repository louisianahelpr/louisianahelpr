import { launch, all4, goto, shoot } from './lib.mjs';
export async function fillForm(page, vp) {
  await goto(page, '/post-job', 1200);
  await page.locator('main button', { hasText: 'Start Fresh' }).first().click(); await page.waitForTimeout(800);
  await page.locator('main button', { hasText: /^Cleaning$/ }).click();
  await page.locator('#title').fill('Sweep test — deep clean kitchen');
  await page.locator('#description').fill('Kitchen deep clean before a family visit: oven, fridge, cabinet fronts, floors. Supplies provided. https://example.com/photos/kitchen-before-and-after-very-long-link-no-spaces');
  await page.locator('#streetAddress').fill('4000 Perkins Rd'); await page.locator('#city').fill('Baton Rouge'); await page.locator('#zipCode').fill('70808');
  await page.locator('#date').click(); await page.waitForTimeout(700); await shoot(page, 'p14_datepicker');
  // pick a date ~ 10 days out
  const dayBtn = page.locator('[role=dialog] button, [role=grid] button, .rdp-day, button[name=day]').filter({ hasText: /^17$/ }).first();
  if (await dayBtn.count()) await dayBtn.click(); else console.log(vp, 'no day button');
  await page.waitForTimeout(500);
  console.log(vp, 'date now:', await page.locator('#date').innerText());
  // time: phone = wheels (role=option), desktop = <input type=time>
  const timeInput = page.locator('#start-time input[type=time]');
  if (await timeInput.count() && await timeInput.isVisible()) { await timeInput.fill('09:30'); }
  else {
    const opts = page.locator('#start-time [role=option]');
    await opts.filter({ hasText: /^9$/ }).first().click(); await opts.filter({ hasText: /^30$/ }).first().click(); await page.locator('#start-time button', { hasText: /^AM$/ }).click();
  }
  await page.waitForTimeout(300);
  await page.locator('#budget').fill('85'); await page.locator('#budget').blur();
  await page.waitForTimeout(400);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const b = await launch(false);
  await all4(b, async (page, vp) => {
    await fillForm(page, vp);
    await shoot(page, 'p14_form_filled_top');
    const submit = page.locator('main button[type=submit]').last();
    console.log(vp, 'submit label:', await submit.innerText());
    await submit.scrollIntoViewIfNeeded(); await shoot(page, 'p14_form_filled_bottom');
    await submit.click(); await page.waitForTimeout(1500); await shoot(page, 'p14_after_submit', true);
    console.log(vp, 'url', page.url(), (await page.locator('main').innerText()).replace(/\s+/g,' ').slice(0, 300));
  });
  await b.close();
}
