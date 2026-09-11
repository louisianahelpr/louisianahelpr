import { launch, all4, goto, shoot } from './lib.mjs';
const routes = ['/dashboard','/my-posts','/messages','/activity','/profile','/subscription','/gift-card','/pay-it-forward','/post-job','/payment-success'];
const b = await launch(false);
await all4(b, async (page) => {
  for (const r of routes) { await goto(page, r); await shoot(page, 'p1' + r.replace(/\//g,'_')); }
});
await b.close();
