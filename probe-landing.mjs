import { chromium } from "playwright";
const b=await chromium.launch();const p=await b.newPage({viewport:{width:375,height:812}});
await p.goto("http://localhost:4201/",{waitUntil:"networkidle"});
// scroll through slowly so any in-view animations fire
const h=await p.evaluate(()=>document.documentElement.scrollHeight);
for(let y=0;y<h;y+=400){await p.evaluate(y=>window.scrollTo(0,y),y);await p.waitForTimeout(250);}
await p.waitForTimeout(800);
await p.screenshot({path:"shots/landing-375-light-scrolled.png",fullPage:true});
const info=await p.evaluate(()=>{const s=document.querySelector("#how-it-works, section:nth-of-type(2)");const out=[];for(const el of document.querySelectorAll("section, main > div")){const r=el.getBoundingClientRect();out.push([el.id||el.className.slice(0,40),Math.round(r.top+scrollY),Math.round(r.height),getComputedStyle(el).opacity])}return out;});
console.log(info);await b.close();
