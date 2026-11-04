#!/usr/bin/env node
// Throwaway (Builder 87, 11-03): which Stripe tax codes for cleaning carpets/rugs/furniture does Stripe tax in
// Louisiana? Lists every tax code whose name or description mentions cleaning, then prices $100 at 70112 and
// 70501 in TEST mode. Refuses a non-test key; never prints it.
const key = process.env.STRIPE_TEST_SECRET_KEY || "";
if (!/^(sk|rk)_test_/.test(key)) { console.error("::error::not a test-mode key"); process.exit(1); }
const API = "https://api.stripe.com/v1";
const H = { Authorization: `Bearer ${key}`, "Stripe-Version": "2025-08-27.basil", "Content-Type": "application/x-www-form-urlencoded" };
const codes = [];
let after = null;
for (;;) {
  const r = await fetch(`${API}/tax_codes?limit=100${after ? `&starting_after=${after}` : ""}`, { headers: H });
  const j = await r.json();
  if (j.livemode === true) process.exit(1);
  for (const c of j.data ?? []) codes.push(c);
  if (!j.has_more || !(j.data ?? []).length) break;
  after = j.data[j.data.length - 1].id;
}
console.log(`tax codes listed: ${codes.length}`);
const want = codes.filter((c) => /clean|carpet|rug\b|upholster|furniture|janitor|laundr/i.test(`${c.name} ${c.description}`));
for (const c of want) {
  const out = [];
  for (const zip of ["70112", "70501"]) {
    const body = new URLSearchParams({
      currency: "usd", "line_items[0][amount]": "10000", "line_items[0][reference]": "labor", "line_items[0][tax_behavior]": "exclusive",
      "line_items[0][tax_code]": c.id, "customer_details[address][postal_code]": zip, "customer_details[address][state]": "LA",
      "customer_details[address][country]": "US", "customer_details[address_source]": "billing",
    });
    const r = await fetch(`${API}/tax/calculations`, { method: "POST", headers: H, body });
    const j = await r.json();
    out.push(`${zip}=${j.tax_amount_exclusive ?? "ERR " + (j.error?.message ?? r.status)}`);
  }
  console.log(`CODE ${c.id} | ${c.name} | ${out.join(" ")} | ${String(c.description).slice(0, 220).replace(/\s+/g, " ")}`);
}
