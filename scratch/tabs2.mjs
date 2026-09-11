import { launch, persona, shot, BASE, log } from "./lib.mjs";
const b=await launch(); const {page}=await persona(b,"poster");
await page.goto(`${BASE}/my-posts`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(11000);
// dismiss the push prompt
const nn=page.getByRole("button",{name:/^Not now$/i});
if (await nn.count()) { await nn.click(); log("dismissed push prompt"); await page.waitForTimeout(2500); }
await shot(page,"TABS2-empty");
log("URL:", page.url());
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,700));
log("controls:", await page.evaluate(()=>[...document.querySelectorAll("button,[role=tab],a,[role=tablist] *")].filter(n=>n.offsetParent).map(n=>(n.innerText||"").replace(/\s+/g," ").trim()).filter(Boolean)));
log("any element containing 'Scheduled':", await page.evaluate(()=>[...document.querySelectorAll("*")].filter(n=>n.children.length===0 && /Scheduled/.test(n.textContent||"")).map(n=>({tag:n.tagName,txt:n.textContent.trim().slice(0,60),clickable:!!n.closest("button,[role=tab],a")}))));
log("scroll:", await page.evaluate(()=>[document.documentElement.scrollHeight, document.documentElement.clientHeight]));
await b.close();
