import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  for (const [n, q] of [['escrow', '?job_id=b4d8f5d2-7f29-4083-a56c-05bf58714dc4'], ['released', '?job_id=a1f7c4c9-0575-44eb-8cd3-3afef1a3b0ad'], ['nojob', ''], ['bogus', '?job_id=00000000-0000-0000-0000-000000000001']]) {
    await goto(page, '/payment-success' + q, 3000); await shoot(page, 'p28_' + n, true);
    console.log(vp, n, (await page.locator('main').innerText()).replace(/\s+/g,' ').slice(0, 260));
  }
});
await b.close();
