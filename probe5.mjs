import { chromium } from "playwright";
const BASE="http://localhost:4201"; const b=await chromium.launch();
for (const w of [375,1440]) {
const c=await b.newContext({viewport:{width:w,height:900}}); const p=await c.newPage();
for (const r of ["/login","/signup","/forgot-password","/reset-password","/signup-pending","/support","/help","/legal"]) {
  await p.goto(BASE+r,{waitUntil:"networkidle"}); await p.waitForTimeout(500);
  const m = await p.evaluate(()=>{const card=document.querySelector('main .liquid-glass, main [class*="glass"], main form, main [class*="card"]'); const cs=card&&getComputedStyle(card); const h1=document.querySelector('h1'); const hs=h1&&getComputedStyle(h1); const nav=document.querySelector('nav, header'); return {card: card? card.className.split(' ').slice(0,3).join(' '):null, pad: cs&&[cs.paddingTop,cs.paddingLeft].join('/'), radius: cs&&cs.borderRadius, bg: cs&&cs.backgroundColor, border: cs&&cs.borderColor, h1: hs&&[hs.fontFamily.split(',')[0],hs.fontStyle,hs.fontSize].join(' '), hasNav: !!document.querySelector('a[href="/signup"]:not(main a)'), footer: !!document.querySelector('footer')};});
  console.log(w, r, JSON.stringify(m));
}
await c.close();}
await b.close();
