import { launch, persona, shot, grabToasts, BASE, log } from "./lib.mjs";
const b = await launch();
const { page } = await persona(b, "poster");
await page.goto(`${BASE}/post-job`, { waitUntil: "domcontentloaded" });
await page.getByText("Start Fresh").waitFor({ timeout: 30000 });
await shot(page, "P2-entry");
await page.getByText("Start Fresh").click();
await page.waitForTimeout(2500);
await shot(page, "P2-form-details");
const dump = async (label) => {
  const fields = await page.$$eval("input,textarea,select,button", ns => ns.map(n => ({
    tag: n.tagName, id: n.id, name: n.name||"", type: n.type||"", ph: n.placeholder||"",
    txt: (n.innerText||"").replace(/\s+/g," ").trim().slice(0,40), vis: n.offsetParent !== null,
  })).filter(f => f.vis));
  log(`--- ${label} ---`); fields.forEach(f => log("  ", JSON.stringify(f)));
  log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,600));
};
await dump("details step");
await b.close();
