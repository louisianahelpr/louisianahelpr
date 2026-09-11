import { launch, persona, shot, BASE, log, restQ, ANON, SB } from "./lib.mjs";
const JOB = process.argv[2];
const CARD = process.argv[3] || "4242424242424242";
const b = await launch();
const { page } = await persona(b, "poster", { width: 1280, height: 900 });
await page.goto(`${BASE}/my-posts`); await page.waitForTimeout(5000);
const res = await page.evaluate(async ([j,sb,a]) => { const k=Object.keys(localStorage).find(x=>x.includes("auth-token"));
  const t=JSON.parse(localStorage.getItem(k)).access_token;
  const r=await fetch(`${sb}/functions/v1/create-payment`,{method:"POST",headers:{Authorization:`Bearer ${t}`,"Content-Type":"application/json",apikey:a},body:JSON.stringify({action:"escrow",jobId:j})});
  return {s:r.status,b:await r.text()}; }, [JOB,SB,ANON]);
log("create-payment:", res.s, res.b.slice(0,120));
const cu = JSON.parse(res.b).url;
if (!/\/cs_test_/.test(cu)) { log("!!! NOT TEST MODE — ABORT"); await b.close(); process.exit(1); }
log("TEST MODE confirmed (cs_test_)");
await page.goto(cu, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("radio").first().click({ force: true });
await page.waitForTimeout(3000);
await page.locator("#cardNumber").fill(CARD);
await page.locator("#cardExpiry").fill("12 / 34");
await page.locator("#cardCvc").fill("123");
for (const [id,v] of [["#billingName","Perry Poster"],["#billingPostalCode","70801"],["#billingAddressLine1","100 Audit Way"],["#billingLocality","Baton Rouge"]]) {
  const l = page.locator(id); if (await l.count() && await l.isVisible().catch(()=>false)) await l.fill(v).catch(()=>{});
}
await page.keyboard.press("Escape");
const sp = page.locator("#enableStripePass");
if (await sp.count() && await sp.isChecked().catch(()=>false)) { await sp.uncheck({ force: true }).catch(()=>{}); log("unchecked Link save"); }
await page.waitForTimeout(1200);
await shot(page, `PAY-${CARD.slice(-4)}-filled`);
await page.getByTestId("hosted-payment-submit-button").click();
await page.waitForTimeout(9000);
await shot(page, `PAY-${CARD.slice(-4)}-result`);
log("URL:", page.url().slice(0,110));
log("page text:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,500));
if (/localhost:8347/.test(page.url())) {
  await page.waitForTimeout(4000); await shot(page, `PAY-${CARD.slice(-4)}-app`);
  log("APP:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,600));
}
for (let i=0;i<15;i++){ const j=(await restQ(`jobs?id=eq.${JOB}&select=status,payment_status`))[0];
  log(`  poll +${i*3}s`, JSON.stringify(j)); if(j.payment_status!=="unpaid") break; await page.waitForTimeout(3000); }
await b.close();
