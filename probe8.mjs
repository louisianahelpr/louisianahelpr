import { chromium } from "playwright";
const BASE="http://localhost:4201"; const b=await chromium.launch();
for (const w of [375,1440]) {
const c=await b.newContext({viewport:{width:w,height:w===375?812:900}}); const p=await c.newPage();
await p.goto(BASE+"/browse?job=69f25bbb-cc38-425b-a8fd-104c96fb40f4",{waitUntil:"networkidle"}); await p.waitForTimeout(1500);
console.log(w, await p.evaluate(()=>{const d=document.querySelector('[role=dialog]'); const r=d.getBoundingClientRect(); const kids=[...d.querySelectorAll('*')].map(e=>e.getBoundingClientRect().bottom).filter(Boolean); const cs=getComputedStyle(d); return JSON.stringify({top:Math.round(r.top),h:Math.round(r.height),contentBottom:Math.round(Math.max(...kids)), cls:d.className.slice(0,200), height:cs.height, minH:cs.minHeight, maxH:cs.maxHeight});}));
await p.screenshot({path:`shots/op-browse-deeplink-${w}.png`});
await c.close();}
await b.close();
