import { chromium } from "playwright";
const b = await chromium.launch();
for (const route of ["/jobs","/browse"]) {
  const p = await b.newContext().then(c=>c.newPage());
  await p.setViewportSize({width:393,height:852});
  await p.goto("http://localhost:8096"+route, { waitUntil:"networkidle" }).catch(()=>{});
  await p.waitForTimeout(3000);
  const titles = await p.$$('h2, h3');
  let out = { route, url: p.url(), headings: titles.length };
  if (titles.length) {
    await titles[0].click({force:true}).catch(()=>{});
    await p.waitForTimeout(2200);
    out.afterClick = p.url();
    out.dialogOpened = !!(await p.$('[role="dialog"]'));
  }
  console.log(JSON.stringify(out));
  await p.close();
}
await b.close();
