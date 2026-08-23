import { chromium } from '@playwright/test';
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ serviceWorkers: 'block' });
await ctx.addInitScript(({key,value}) => { try { localStorage.setItem(key,value); } catch {} }, {key:'x',value:'1'});
const p = await ctx.newPage();
await p.route('https://fncmgoasalhdgfwzhsqa.supabase.co/**', r => r.fulfill({status:200, body:'[]', contentType:'application/json'}));
for (const u of ['http://localhost:8080/dashboard','http://localhost:8080/my-posts']) {
  try {
    const r = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log(u, 'status', r && r.status());
  } catch (e) { console.log(u, 'ERR', e.message.split('\n')[0]); }
  await p.waitForTimeout(1500);
  console.log('  url', p.url(), '| html', await p.evaluate(()=>document.documentElement.className));
}
await b.close();
