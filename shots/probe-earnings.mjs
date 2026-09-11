import { launch, VP, goto, shoot } from "./lib.mjs";
const { browser, page, errors } = await launch({ who: "helper", headless: true });
await goto(page, "/profile?tab=earnings", { wait: 7000 });
await shoot(page, "probe-earnings-7s");
const html = await page.evaluate(() => { const m = document.querySelector("main") || document.body; const c = m.querySelector('[class*="liquid-glass"], [class*="card"]'); return c ? c.outerHTML.slice(0, 1500) : "none"; });
console.log(html); console.log(errors.filter(e=>!/_vercel|placeholder|Failed/.test(e)));
await browser.close();
