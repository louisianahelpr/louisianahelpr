import { launch, ctx, goto, shoot } from './lib.mjs';
const b = await launch(false); const page = await ctx(b, 'm', 'dark');
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('C', m.type(), m.text().slice(0, 250)); });
page.on('response', r => { if (r.status() >= 400 && !/vercel|placeholder/.test(r.url())) console.log('HTTP', r.status(), r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 160)); });
await page.goto('http://localhost:4202/messages');
for (let i = 1; i <= 10; i++) { await page.waitForTimeout(1000); const t = (await page.locator('main').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0, 120); console.log('t+' + i, t); if (/Hallie/.test(t)) break; }
await shoot(page, 'p20_messages_m');
await b.close();
