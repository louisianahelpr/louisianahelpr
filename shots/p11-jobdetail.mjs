import { launch, all4, goto, shoot } from './lib.mjs';
const b = await launch(false);
await all4(b, async (page, vp) => {
  for (const [name, id] of [['open_urgent', 'b4d8f5d2-7f29-4083-a56c-05bf58714dc4'], ['offered', 'a1f7c4c9-0575-44eb-8cd3-3afef1a3b0ad'], ['scheduled_seed', '4a2db89b-7473-4d23-8b24-a7142b2e2088'], ['cancelled_seed', '5979d626-15de-4b5d-beb0-51973338b101']]) {
    await goto(page, '/jobs/' + id, 2500);
    await shoot(page, 'p11_job_' + name, true);
    console.log(vp, name, (await page.locator('main').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0, 500));
    console.log(vp, 'btns:', await page.evaluate(() => [...document.querySelectorAll('main button, main a')].map(b => (b.innerText.replace(/\s+/g,' ').trim() || '[' + b.getAttribute('aria-label') + ']')).join(' | ')));
  }
});
await b.close();
