#!/usr/bin/env node
/**
 * Writes LAB.md (the Cowork follow-up audit's map of the test lab) from a
 * `seed-test-lab.mjs --verify --json=<file>` result.
 *
 *   node scripts/test-lab/write-lab-md.mjs <verify.json> <out LAB.md> [gallery path]
 *
 * No emails and no passwords go in it: the owner gives the logins.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { JOBS, ITEMS, ORDERS } from "./seed-test-lab.mjs";

const [verifyPath, outPath, gallery = "~/Desktop/Helpr-test-lab/gallery/index.html"] = process.argv.slice(2);
if (!verifyPath || !outPath) { console.error("Usage: node scripts/test-lab/write-lab-md.mjs <verify.json> <LAB.md> [gallery]"); process.exit(2); }
const rows = JSON.parse(readFileSync(verifyPath, "utf8"));
const WWW = "https://www.louisianahelpr.com";
const by = (kind, key) => rows.find((r) => r.kind === kind && r.key === key);
const acct = (a) => (a === "P" ? "**P**" : a === "H" ? "**H**" : "-");
const stamp = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });

const L = [];
L.push(`# Helpr test lab`, ``, `Updated ${stamp} (Central). Built by Claude Code (Builder 7) for the follow-up audit.`, ``);
L.push(`Everything below is TEST data on the two shared test accounts. It is hidden from real members and from the owner's dashboards, daily/weekly emails and alerts (checked: owner_daily_summary_stats and the alert ledger did not change after the build; every email it caused went to the test inboxes and was suppressed). No real money moved: nothing here has a Stripe payment behind it, and Stripe is LIVE, so never enter a card.`, ``);
L.push(`## The two accounts (Lexi gives you the logins)`, ``);
L.push(`| Account | Jobs role | Declutter role | Shows as |`, `|---|---|---|---|`);
L.push(`| **P** ("E2E poster" test account) | Poster of the hired-and-later jobs; the Helpr who applied to H's open job | Seller of every lab listing and order | "E2E P." |`);
L.push(`| **H** ("E2E helper" test account) | The hired Helpr on P's jobs; poster of the two OPEN jobs | Buyer on every order, offer and trade (has a saved TEST card) | "Hallie H." |`, ``);
L.push(`Why H posts the open jobs: P already holds 4 of its 5 open paid job slots (the nightly tests need them), so the open jobs sit on H. For "Apply as the test Helpr", use **P** on the TEST open job.`, ``);
L.push(`Every lab title starts with "SEED TEST". Use only the items listed here.`, ``);

L.push(`## Safe to act on`, ``);
const tj = JOBS.find((j) => j.key === "open-test");
L.push(`- **TEST open job**: [${tj.title}](${WWW}/jobs/${by("job", "open-test")?.id}) (posted by H). ${tj.safe}`);
for (const k of ["test-listing", "test-free"]) {
  const it = ITEMS.find((i) => i.key === k);
  L.push(`- **${it.label}**: [${it.title}](${WWW}/declutter/item/${by("item", k)?.id}) (seller P). ${it.safe}`);
}
L.push(`- Anything you create yourself: title it "TEST - please ignore" and delete or withdraw it before you finish.`);
L.push(`- Everything else in this file: LOOK ONLY (open screens, sheets and chats; do not press the final button), unless its row says otherwise.`, ``);

L.push(`## Jobs in every state`, ``, `Open each link signed in as the poster, then as the Helpr.`, ``);
L.push(`| State | Job | Poster | Helpr | Live state | What you may do |`, `|---|---|---|---|---|---|`);
for (const j of JOBS) {
  const r = by("job", j.key);
  L.push(`| ${j.label} | [${j.title.replace("SEED TEST ", "")}](${WWW}/jobs/${r?.id}) | ${acct(j.poster.key)} | ${acct(j.helper?.key)} | ${r?.ok ? r.state : "NOT SEEDED"} | ${j.safe} |`);
}
L.push(``, `The job chat for every hired job has 3 messages (both sides). Each job's cancel sheet opens from the job page; stop before confirming.`, ``);

L.push(`## Declutter orders in every state`, ``, `Buyer is H, seller is P. The buyer link opens Buying, the seller link opens Selling, each with that order open.`, ``);
L.push(`| State | Item | Live state | Buyer view (H) | Seller view (P) |`, `|---|---|---|---|---|`);
for (const o of ORDERS) {
  const r = by("order", o.key);
  L.push(`| ${o.label} | ${o.title.replace("SEED TEST ", "")} ($${(o.price / 100).toFixed(2)}) | ${r?.ok ? r.state : "NOT SEEDED"} | [open](${WWW}/declutter?tab=buying&order=${r?.id}) | [open](${WWW}/declutter?tab=selling&order=${r?.id}) |`);
}
L.push(``, `Order chats: each open order has a 2-line chat (one line from each side); open it from the order card, or with [buyer](${WWW}/declutter?tab=buying&order_talk=${by("order", "o-booked")?.id}) / [seller](${WWW}/declutter?tab=selling&order_talk=${by("order", "o-booked")?.id}) for the booked order. The completed sale's chat is closed (the app ends it after the sale).`, ``);

L.push(`## Offers`, ``, `Buyer H, seller P.`, ``);
L.push(`| State | Item | Live state | Buyer view (H) | Seller view (P) |`, `|---|---|---|---|---|`);
for (const k of ["offer-open", "offer-countered", "offer-accepted", "offer-declined", "offer-expired"]) {
  const it = ITEMS.find((i) => i.key === k);
  const off = by("offer", k);
  const item = by("item", k);
  L.push(`| ${it.label} | [${it.title.replace("SEED TEST ", "")}](${WWW}/declutter/item/${item?.id}) | ${off ? off.state : "NOT SEEDED"} | [open](${WWW}/declutter?tab=buying&offer=${off?.id}) | [open](${WWW}/declutter?tab=selling&offer=${off?.id}) |`);
}
L.push(``, `The accepted offer sits in H's cart (Buying > cart) until checkout; open checkout up to the Stripe page only.`, ``);

L.push(`## Trades`, ``, `H offered one of its own items for one of P's.`, ``);
L.push(`| State | P's item (wanted) | H's item (offered) | Live state |`, `|---|---|---|---|`);
for (const [want, give] of [["trade-want", "trade-give-1"], ["trade-accepted-want", "trade-give-2"], ["trade-lapsed-want", "trade-give-3"]]) {
  const t = by("trade", want);
  const w = ITEMS.find((i) => i.key === want);
  const g = ITEMS.find((i) => i.key === give);
  L.push(`| ${t?.state ?? "NOT SEEDED"} | [${w.title.replace("SEED TEST ", "")}](${WWW}/declutter/item/${by("item", want)?.id}) | [${g.title.replace("SEED TEST ", "")}](${WWW}/declutter/item/${by("item", give)?.id}) | ${t?.state ?? "-"} |`);
}
L.push(``, `Trades show on Selling (P) and Buying (H): ${WWW}/declutter?tab=selling and ${WWW}/declutter?tab=buying.`, ``);

L.push(`## Notifications`, ``);
for (const k of ["P", "H"]) {
  const n = by("notifications", k);
  L.push(`- **${k}**: ${n?.state}. Kinds: ${(n?.types ?? []).join("; ")}.`);
}
L.push(`- The bell at the top of Home, Jobs and Declutter opens the list. Almost all are unread; tap a few of each kind to check where each one goes.`, ``);

L.push(`## Not seeded (and why)`, ``);
const missing = rows.filter((r) => !r.ok);
if (missing.length) for (const r of missing) L.push(`- ${r.kind} ${r.key}: ${r.why ?? r.state}`);
L.push(`- Job "no-show" (poster reports the Helpr never came): not built. The report runs report_helper_no_show, which starts a refund path; no safe way without a payment behind it.`);
L.push(`- Real money states (a real Stripe charge, refund or transfer): never. Paid, refunded and paid-out rows here are database-only. The finished sale's payout shows as settled outside Stripe (marked TEST-LAB-NO-STRIPE).`);
L.push(`- Declutter "Helpr delivery" (a Helpr job created to deliver an order): not built; it would post a real delivery task job. Seller delivery is built instead.`, ``);

L.push(`## Message gallery`, ``, `Every email, text and push wording: ${gallery} (the lead publishes it and adds the link here).`, ``);

L.push(`## Cleanup (one command)`, ``);
L.push("```", "bash ~/Desktop/Helpr-test-lab/cleanup-lab.sh --dry-run   # lists every lab row it would delete", "bash ~/Desktop/Helpr-test-lab/cleanup-lab.sh             # deletes them, then proves 0 lab jobs, listings and orders remain", "```", "");
L.push(`It runs scripts/test-lab/seed-test-lab.mjs --teardown from branch ready/b7-test-lab. It deletes only lab ids (fixed UUIDs), the notices they caused, and the listing/handover photos it uploaded. To rebuild the lab later: the same script with --apply.`, ``);
L.push(`Deadlines in the lab (open offers, the cart line, refund answers, the problem, bookings) are set about 5 to 6 days out, so nothing lapses into a refund attempt or a strike before cleanup. Run cleanup within 5 days, or rebuild.`);

writeFileSync(outPath, L.join("\n") + "\n");
console.log(`wrote ${outPath}`);
