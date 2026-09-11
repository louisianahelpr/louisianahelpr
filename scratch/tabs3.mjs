import { launch, persona, shot, BASE, log } from "./lib.mjs";
const b=await launch(); const {page}=await persona(b,"poster");
await page.goto(`${BASE}/my-posts`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(11000);
const nn=page.getByRole("button",{name:/^Not now$/i}); if(await nn.count()){await nn.click();await page.waitForTimeout(2000);}
await page.getByRole("button",{name:/Show Waiting/}).click();
await page.waitForTimeout(3000);
await shot(page,"TABS3-after-waiting");
log("controls after tapping Show Waiting:", await page.evaluate(()=>[...document.querySelectorAll("button,[role=tab],a")].filter(n=>n.offsetParent).map(n=>(n.innerText||"").replace(/\s+/g," ").trim()).filter(Boolean)));
const sch=page.getByRole("button",{name:/^Scheduled/});
log("Scheduled tab now present:", await sch.count());
if (await sch.count()) { await sch.click(); await page.waitForTimeout(3000); await shot(page,"TABS3-scheduled");
  log("SCHEDULED VIEW:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,600)); }
await b.close();
