import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/my-posts');
  const filt = page.getByRole('button', { name: 'Filter by status' });
  if (await filt.count()) { await filt.first().click(); await page.waitForTimeout(500); }
  await shoot(page, 'p2_myposts_filters');
  const tabs = page.locator('#activity-status-tabs button, [role=tablist] button, #activity-status-tabs [role=tab]');
  const n = await tabs.count();
  const names = [];
  for (let i = 0; i < n; i++) names.push((await tabs.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  console.log(vp, 'tabs:', names);
  for (let i = 0; i < n; i++) {
    const t = page.locator('#activity-status-tabs button, [role=tablist] button, #activity-status-tabs [role=tab]').nth(i);
    if (!(await t.isVisible())) { const f = page.getByRole('button', { name: 'Filter by status' }); if (await f.count()) await f.first().click(); await page.waitForTimeout(300); }
    await t.click(); await page.waitForTimeout(900);
    await shoot(page, 'p2_myposts_bucket' + i + '_' + names[i].replace(/[^a-z]/gi, '').slice(0, 10), true);
  }
  // search
  const s = page.getByRole('button', { name: 'Search jobs' });
  if (await s.count()) { await s.first().click(); await page.waitForTimeout(300); await page.keyboard.type('zzz-nomatch'); await page.waitForTimeout(800); await shoot(page, 'p2_myposts_search_nomatch'); }
});
await b.close();
