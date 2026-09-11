import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
const JOB = "e6979a12-ee25-46c9-98f5-c088189849e5";
const b = await launch();
const { page } = await persona(b, "poster");
const fn = [];
page.on("response", r => { const u=r.url(); if(u.includes("/functions/v1/")) fn.push(`${r.status()} ${u.split("/functions/v1/")[1].slice(0,40)}`); });

// Re-enter checkout from the app: Edit -> re-submit? Simpler: the app's own
// create-payment escrow action, invoked the way the page does, then drive the
// hosted page. This is the same call the Continue-to-Payment button makes.
const url = await page.evaluate(async ([jobId]) => {
  const raw = localStorage.getItem(Object.keys(localStorage).find(k=>k.includes("auth-token")));
  const tok = JSON.parse(raw).access_token;
  const r = await fetch("https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/create-payment", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", apikey: "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP" },
    body: JSON.stringify({ action: "escrow", jobId }),
  });
  return { status: r.status, body: await r.text() };
}, [JOB]);
log("create-payment:", url.status, url.body.slice(0, 200));
const checkout = JSON.parse(url.body).url;
if (!/\/cs_test_/.test(checkout)) { log("NOT TEST MODE — ABORT"); await b.close(); process.exit(1); }
log("TEST MODE confirmed");

await page.goto(checkout, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await shot(page, "F1-stripe-hosted");
await page.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
await page.getByPlaceholder("MM / YY").fill("12 / 34");
await page.getByPlaceholder("CVC").fill("123");
const zip = page.getByPlaceholder("12345"); if (await zip.count()) await zip.fill("70801");
const nameF = page.getByPlaceholder("Full name on card"); if (await nameF.count()) await nameF.fill("Perry Poster");
await shot(page, "F2-card-filled");
await page.getByTestId("hosted-payment-submit-button").click();
await page.waitForURL(/payment-success|localhost:8347/, { timeout: 120000 });
await page.waitForTimeout(4000);
log("landed:", page.url());
await shot(page, "F3-payment-success");
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,700));
for (let i=0;i<20;i++){ const j=(await restQ(`jobs?id=eq.${JOB}&select=status,payment_status`))[0]; log(`t+${i*3}s`, JSON.stringify(j)); if(j.payment_status==="escrow") break; await page.waitForTimeout(3000);}
log("fn:", fn);
await b.close();
