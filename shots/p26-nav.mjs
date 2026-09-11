import { launch, all4, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/dashboard', 2000);
  // notifications bell
  const bell = page.locator('button[aria-label*="otification"]').first();
  if (await bell.count()) { await bell.click(); await page.waitForTimeout(1500); await shoot(page, 'p26_notifications', vp === 'm'); console.log(vp, 'notif:', (await page.locator('[role=dialog], [data-state=open]').last().innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0, 400)); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  else console.log(vp, 'no bell');
  if (vp === 'm') {
    // long-press posts tab
    const tab = page.locator('button[aria-label="Posts"]').first();
    const box = await tab.boundingBox();
    await page.touchscreen ? null : null;
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up(); await page.waitForTimeout(800);
    await shoot(page, 'p26_quickmenu_posts');
    console.log(vp, 'quick posts:', (await page.locator('[role=dialog], [role=menu]').last().innerText().catch(()=>'(none)')).replace(/\s+/g,' ').slice(0, 300));
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const mt = page.locator('button[aria-label="Messages"]').first(); const mb = await mt.boundingBox();
    await page.mouse.move(mb.x + mb.width/2, mb.y + mb.height/2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up(); await page.waitForTimeout(1200);
    await shoot(page, 'p26_quickmenu_messages');
    console.log(vp, 'quick msgs:', (await page.locator('[role=dialog], [role=menu]').last().innerText().catch(()=>'(none)')).replace(/\s+/g,' ').slice(0, 300));
    await page.keyboard.press('Escape');
    // plus button
    await page.locator('button[aria-label="Post a new job"]').click(); await page.waitForTimeout(1200); await shoot(page, 'p26_plus'); console.log(vp, 'plus ->', page.url());
  }
});
await b.close();
