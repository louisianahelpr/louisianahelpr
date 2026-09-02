import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newContext().then(c=>c.newPage());
await p.setViewportSize({width:393,height:852});
await p.goto("http://localhost:8090/browse", { waitUntil:"networkidle" }).catch(()=>{});
await p.waitForTimeout(2500);
const cards = await p.$$('div.group.relative.h-full');
console.log("cards found:", cards.length);
if (cards.length) {
  await cards[0].click({ force: true }).catch(e=>console.log("click err", e.message.slice(0,60)));
  await p.waitForTimeout(2500);
  console.log("after card click ->", p.url());
  console.log("body:", (await p.evaluate(()=>document.body.innerText.replace(/\s+/g," ").slice(0,200))));
}
await b.close();
