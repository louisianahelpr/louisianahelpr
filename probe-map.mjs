import { chromium } from "playwright";
const BASE="http://localhost:4201"; const b=await chromium.launch();
for (const w of [375,1440]) {
const c=await b.newContext({viewport:{width:w,height:w===375?812:900}}); const p=await c.newPage();
p.on("console",m=>{if(m.type()==="error"&&!/404/.test(m.text()))console.log("CONSOLE",m.text().slice(0,200))});
await p.goto(BASE+"/browse",{waitUntil:"networkidle"}); await p.waitForTimeout(800);
await p.click('button[aria-label="Filters"]'); await p.waitForTimeout(600); await p.click('[role=dialog] button:has-text("Map")');
await p.waitForTimeout(12000); await p.screenshot({path:`shots/op-browse-map-${w}-12s.png`});
const info = await p.evaluate(()=>({ann:document.querySelectorAll(".mk-annotation-container, .mk-annotation, [class*=annotation]").length, canvases:document.querySelectorAll("canvas").length, text:document.body.innerText.replace(/\n+/g," | ").slice(0,200)}));
console.log(w, info);
await c.close();
}
await b.close();
