import { launch, persona, shot, BASE, log } from "./lib.mjs";
const b=await launch(); const {page}=await persona(b,"poster");
await page.goto(`${BASE}/my-posts`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(11000);
await page.evaluate(()=>window.scrollTo(0,0));
await shot(page,"TABS-empty");
log("scrollHeight/clientHeight:", await page.evaluate(()=>[document.documentElement.scrollHeight, document.documentElement.clientHeight]));
const all = await page.evaluate(()=>[...document.querySelectorAll("button,[role=tab],a")].map(n=>({
  role:n.getAttribute("role"), tag:n.tagName, txt:(n.innerText||"").replace(/\s+/g," ").trim().slice(0,30),
  vis: !!n.offsetParent, rect: n.getBoundingClientRect().height })));
log("ALL controls:", JSON.stringify(all.filter(x=>x.txt), null, 0));
log("text has Scheduled:", (await page.innerText("body")).includes("Scheduled"));
// now with ?filter=
for (const f of ["scheduled","active"]) {
  await page.goto(`${BASE}/my-posts?filter=${f}`, { waitUntil:"domcontentloaded" });
  await page.waitForTimeout(7000);
  const t=(await page.innerText("body")).replace(/\s+/g," ");
  log(`?filter=${f} ->`, t.slice(0,300));
  await shot(page,`TABS-${f}`);
}
await b.close();
