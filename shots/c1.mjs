import { launch, all4, goto, shoot } from './lib.mjs';
import { checklist } from './checklist.mjs';
import fs from 'node:fs';
const routes = ['/dashboard','/my-posts','/my-posts?filter=waiting','/my-posts?filter=done','/messages','/profile','/profile?tab=profile','/profile?tab=earnings','/profile?tab=subscription','/profile?tab=notifications','/profile?tab=support','/profile?tab=legal','/gift-card','/post-job','/payment-success'];
const b = await launch(false); const log = [];
await all4(b, async (page, vp, theme) => {
  for (const r of routes) {
    await goto(page, r, 1800);
    const name = 'c1' + r.replace(/[\/?=]/g, '_');
    await shoot(page, name);
    const c = await checklist(page);
    log.push({ route: r, vp, theme, ...c });
  }
});
fs.writeFileSync(process.env.HOME + '/.lh-sweep/poster/shots/c1.json', JSON.stringify(log, null, 1));
await b.close();
