import { chromium } from "playwright";
const BASE="http://localhost:4201"; const b=await chromium.launch();
const mk=async(w,theme="light")=>{const c=await b.newContext({viewport:{width:w,height:w===375?812:900},colorScheme:theme});return [c,await c.newPage()]};
// browse filters fresh
for (const w of [375,1440]) for (const theme of ["light","dark"]) {
  const [c,p]=await mk(w,theme); await p.goto(BASE+"/browse",{waitUntil:"networkidle"}); await p.waitForTimeout(800);
  await p.click('button[aria-label="Filters"]'); await p.waitForTimeout(900);
  await p.screenshot({path:`shots/op-browse-filters-${w}-${theme}.png`});
  const dlg = await p.$('[role=dialog]');
  const clipped = await p.$$eval('[role=dialog] button, [role=dialog] span, [role=dialog] label', els=>els.filter(e=>e.scrollWidth>e.clientWidth+1&&/hidden|clip/.test(getComputedStyle(e).overflow+getComputedStyle(e).overflowX)&&!/sr-only/.test(e.className)).map(e=>e.textContent.trim().slice(0,30)+" "+e.scrollWidth+">"+e.clientWidth));
  const sel = await p.$$eval('[role=dialog] [aria-pressed="true"], [role=dialog] [data-state="on"], [role=dialog] [aria-checked="true"], [role=dialog] [data-state="checked"]', els=>els.map(e=>[e.textContent.trim().slice(0,20), getComputedStyle(e).backgroundImage.slice(0,30)]));
  console.log(w,theme,"filters dialog",!!dlg,"clipped",clipped,"selected",sel);
  await p.click('[role=dialog] button:has-text("Map")'); await p.waitForTimeout(400);
  const closeBtn = await p.$('[role=dialog] button[aria-label*="lose"]'); if(closeBtn) await closeBtn.click(); else await p.keyboard.press("Escape");
  await p.waitForTimeout(3500); await p.screenshot({path:`shots/op-browse-map-${w}-${theme}.png`});
  console.log(w,theme,"map text", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,200));
  // pin tap
  const pin = await p.$('[class*="marker"], .mk-marker, button[aria-label*="job" i]'); console.log(w,theme,"pin",!!pin);
  if(pin){await pin.click().catch(()=>{}); await p.waitForTimeout(800); await p.screenshot({path:`shots/op-browse-map-pin-${w}-${theme}.png`}); console.log("after pin →",p.url().replace(BASE,""));}
  // category chip
  await p.goto(BASE+"/browse",{waitUntil:"networkidle"}); await p.click('button[aria-label="Filters"]'); await p.waitForTimeout(600); await p.click('[role=dialog] button:has-text("Pet Care")'); await p.waitForTimeout(300);
  const closeBtn2 = await p.$('[role=dialog] button[aria-label*="lose"]'); if(closeBtn2) await closeBtn2.click(); else await p.keyboard.press("Escape"); await p.waitForTimeout(900);
  await p.screenshot({path:`shots/op-browse-petcare-${w}-${theme}.png`});
  console.log(w,theme,"petcare cards", await p.$$eval('h3', e=>e.map(x=>x.textContent.trim()).slice(0,6)));
  // card tap
  const card = await p.$('h3'); if(card){await card.click(); await p.waitForTimeout(900); console.log(w,theme,"card tap →",p.url().replace(BASE,"")); await p.screenshot({path:`shots/op-browse-cardtap-${w}-${theme}.png`,fullPage:true});}
  await c.close();
}
// deep-link preview dialog /browse?job=
{
  const [c,p]=await mk(375); await p.goto(BASE+"/browse",{waitUntil:"networkidle"}); await p.waitForTimeout(800);
  // find a job id from the network: read from react query cache is hard; use supabase REST via page's env
  const id = await p.evaluate(async()=>{const u=import.meta?.env; return null;});
  await c.close();
}
// legal search + accordion
{
  const [c,p]=await mk(375); await p.goto(BASE+"/legal",{waitUntil:"networkidle"});
  const btns = await p.$$eval('button', els=>els.map(e=>(e.getAttribute("aria-label")||e.textContent.trim()).slice(0,30)+"|exp="+e.getAttribute("aria-expanded")));
  console.log("legal buttons", btns);
  await p.click('button[aria-label*="earch" i]'); await p.waitForTimeout(600); await p.screenshot({path:"shots/op-legal-search-open-375.png"});
  const inp = await p.$('input'); console.log("legal search input", !!inp, inp && await inp.getAttribute("placeholder"));
  if(inp){await inp.type("fee"); await p.waitForTimeout(900); await p.screenshot({path:"shots/op-legal-search-fee-375.png",fullPage:true}); console.log("legal search results text", (await p.evaluate(()=>document.body.innerText)).slice(0,400).replace(/\n+/g," | "));}
  await p.goto(BASE+"/legal",{waitUntil:"networkidle"});
  const acc = await p.$('button:has-text("Eligibility")'); await acc.click(); await p.waitForTimeout(600); console.log("accordion", await acc.getAttribute("aria-expanded"), await acc.getAttribute("data-state")); await p.screenshot({path:"shots/op-legal-accordion-375.png",fullPage:true});
  await c.close();
}
await b.close();
