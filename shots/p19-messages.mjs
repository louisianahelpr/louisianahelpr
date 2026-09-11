import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/messages', 2500);
  await page.locator('main button', { hasText: /Hallie/ }).first().waitFor({ timeout: 20000 });
  await shoot(page, 'p19_list');
  await page.locator('main button', { hasText: /Hallie/ }).first().click();
  await page.locator('text=Perfect, see you then').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
  await shoot(page, 'p19_thread');
  const ta = page.getByPlaceholder(/Type a message/).first();
  await ta.click(); await ta.fill('Line one\nline two\nline three\nline four\nline five — a long message to see how the composer grows and whether the send button stays reachable.');
  await page.waitForTimeout(500); await shoot(page, 'p19_composer_long');
  await page.locator('button[aria-label="Add photo, file, or location"]').click(); await page.waitForTimeout(700); await shoot(page, 'p19_attach_menu');
  console.log(vp, 'attach menu:', await page.evaluate(() => [...document.querySelectorAll('[role=menu] *, [role=dialog] button')].map(e => e.innerText?.trim()).filter(Boolean).slice(0, 12).join(' | ')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.locator('button[aria-label="Conversation options"]').click(); await page.waitForTimeout(700); await shoot(page, 'p19_thread_menu');
  console.log(vp, 'conv options:', await page.evaluate(() => [...document.querySelectorAll('[role=menu] [role=menuitem], [role=dialog] button')].map(e => e.innerText?.trim()).filter(Boolean).slice(0, 12).join(' | ')));
  await page.keyboard.press('Escape');
  // send a real message
  await ta.fill('Sweep test message — thanks!'); await page.locator('button[aria-label="Send message"]').click(); await page.waitForTimeout(2500); await shoot(page, 'p19_after_send');
});
await b.close();
