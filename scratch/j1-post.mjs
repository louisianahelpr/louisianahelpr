import { launch, persona, shot, grabToasts, restQ, BASE, log } from "./lib.mjs";

const b = await launch();
const P = await persona(b, "poster");
const { page } = P;

await page.goto(`${BASE}/post-job`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await shot(page, "P1-postjob-entry");
log("URL:", page.url());
log("entry cards:", await page.$$eval("button, [role=button]", ns => ns.map(n => n.innerText.replace(/\s+/g," ").trim()).filter(t=>t&&t.length<60)));
await b.close();
