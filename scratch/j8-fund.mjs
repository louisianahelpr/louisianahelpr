import { launch, persona, shot, BASE, log, restQ, ANON, SB } from "./lib.mjs";
const JOB = "e6979a12-ee25-46c9-98f5-c088189849e5";
const b = await launch();
const { page } = await persona(b, "poster");
await page.goto(`${BASE}/my-posts`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const res = await page.evaluate(async ([jobId, sb, anon]) => {
  const k = Object.keys(localStorage).find(x => x.includes("auth-token"));
  const tok = JSON.parse(localStorage.getItem(k)).access_token;
  const r = await fetch(`${sb}/functions/v1/create-payment`, { method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ action: "escrow", jobId }) });
  return { status: r.status, body: await r.text() };
}, [JOB, SB, ANON]);
log("create-payment:", res.status, res.body.slice(0,180));
const cu = JSON.parse(res.body).url;
if (!/\/cs_test_/.test(cu)) { log("!!! NOT TEST MODE"); await b.close(); process.exit(1); }
log("TEST MODE confirmed");
await page.goto(cu, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await shot(page, "F-stripe");
await page.getByTestId("card-accordion-item-button").click().catch(()=>{});
await page.waitForTimeout(2500);
await shot(page, "F-card-selected");
await page.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
await page.getByPlaceholder("MM / YY").fill("12 / 34");
await page.getByPlaceholder("CVC").fill("123");
for (const [ph,v] of [["12345","70801"],["Full name on card","Perry Poster"]]) { const l=page.getByPlaceholder(ph); if(await l.count()) await l.fill(v); }
await shot(page, "F-card");
await page.getByTestId("hosted-payment-submit-button").click();
await page.waitForURL(/localhost:8347/, { timeout: 180000 });
await page.waitForTimeout(6000);
log("landed:", page.url());
await shot(page, "F-success");
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,700));
for (let i=0;i<20;i++){ const j=(await restQ(`jobs?id=eq.${JOB}&select=status,payment_status`))[0];
  log(`  poll +${i*3}s`, JSON.stringify(j)); if(j.payment_status==="escrow") break; await page.waitForTimeout(3000); }
await b.close();
