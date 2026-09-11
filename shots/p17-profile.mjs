import { launch, all4, goto, shoot } from './lib.mjs';
const tabs = ['profile','earnings','schedule','availability','payment','security','legal','reviews','referral','subscription','support','notifications','warnings','credentials','saved_helpers','accessibility','pets','work_record','home_history','str_settings','auto_tip','wrapped','analytics'];
const b = await launch(false);
await all4(b, async (page, vp) => {
  await goto(page, '/profile', 2000); await shoot(page, 'p17_landing', true);
  for (const t of tabs) {
    await goto(page, '/profile?tab=' + t, 1800);
    const m = await shoot(page, 'p17_' + t, true);
    const txt = (await page.locator('main').innerText().catch(()=>'')).replace(/\s+/g,' ');
    console.log(vp, t, '|', txt.slice(0, 160));
  }
});
await b.close();
