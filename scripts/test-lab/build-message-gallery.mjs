#!/usr/bin/env node
/**
 * Message gallery, part 3: screenshots every rendered email (render-email-gallery.tsx) at phone (375) and
 * desktop (1440) width, light and dark, and builds ONE private review page (index.html) with the emails,
 * every SMS text and every notice/push wording (extract-notice-strings.mjs). Sends nothing.
 *
 *   node scripts/test-lab/build-message-gallery.mjs <emails-dir> <notices.json> <out-dir>
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const [emailsDir, noticesPath, outDir] = process.argv.slice(2);
if (!outDir) { console.error("Usage: build-message-gallery.mjs <emails-dir> <notices.json> <out-dir>"); process.exit(2); }
mkdirSync(join(outDir, "png"), { recursive: true });
mkdirSync(join(outDir, "html"), { recursive: true });
const manifest = JSON.parse(readFileSync(join(emailsDir, "manifest.json"), "utf8"));
const notices = JSON.parse(readFileSync(noticesPath, "utf8"));

// ── screenshots ───────────────────────────────────────────────────────────
const shots = process.argv.includes("--no-shots") ? null : await (async () => {
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    for (const width of [375, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: width === 375 ? 2 : 1 });
      // Nothing leaves the machine: remote images (the logo) load, every navigation/form is blocked.
      await ctx.route("**/*", (route) => (route.request().resourceType() === "document" && !route.request().url().startsWith("file:") ? route.abort() : route.continue()));
      const page = await ctx.newPage();
      for (const m of manifest) {
        await page.goto(`file://${join(emailsDir, `${m.id}.html`)}`, { waitUntil: "load" });
        await page.waitForTimeout(150);
        await page.screenshot({ path: join(outDir, "png", `${m.id}-${width}-${scheme}.png`), fullPage: true });
      }
      await ctx.close();
    }
  }
  await browser.close();
  return true;
})();
for (const m of manifest) {
  copyFileSync(join(emailsDir, `${m.id}.html`), join(outDir, "html", `${m.id}.html`));
  copyFileSync(join(emailsDir, `${m.id}.txt`), join(outDir, "html", `${m.id}.txt`));
}

// ── SMS (supabase/functions/_shared/smsPolicy.ts + public.sms_kind_for, read 2026-11-09) ──
const APP = "https://www.louisianahelpr.com";
const SMS = [
  ["message", "You have a new message.", "/messages", "Any notice of type message."],
  ["job_offer", "New job offer. Answer before it expires.", "/jobs?job=<id>", "new_offers: 'You got a direct job offer!', 'New job offer', '📋 New job offer!' (and info '📋 New job offer!')."],
  ["application", "Someone applied to your job.", "/jobs?job=<id>", "application: 'New application'."],
  ["starting_soon", "Your job starts soon.", "/jobs?job=<id>", "job_update: 'Starting soon', 'Your job starts in 2 hours', 'Time to head out'."],
  ["reschedule", "A new date or time was requested on a job.", "/jobs?job=<id>", "job_updates: 'New date or time requested'."],
  ["dispute", "A problem was reported on one of your jobs.", "/jobs?job=<id>", "warning/job_updates: 'A dispute was opened', 'Job disputed'."],
  ["job_cancelled", "One of your jobs was cancelled.", "/jobs?job=<id>", "payment/warning: 'Job cancelled', 'Job cancelled — you'll be compensated'; 'Your Helpr cancelled'; 'Job auto-cancelled'."],
  ["money_problem", "There is a problem with a payment or payout. Please check your account.", "/profile?tab=earnings", "Payout/payment failures ('Your payout didn't go through', 'Payment failed', 'A refund didn't go through', 'We couldn't send your payout', ...)."],
  ["job_update", "There is an update on one of your jobs.", "/jobs?job=<id>", "Any other job_updates / job_update / work_status / expired / info / success notice about a job."],
  ["needs_you", "Something needs you before a deadline.", "/jobs?job=<id> or /declutter", "'Please review the work'; checkout 24 h / 2 h; pickup in 1 hour; answer the offer / refund request / refund offer."],
].map(([kind, phrase, path, trigger]) => {
  const first = `Louisiana Helpr: ${phrase} ${APP}${path.replace("<id>", "00000000-0000-4000-8000-000000000000")} Reply STOP to stop.`;
  const later = `Louisiana Helpr: ${phrase} ${APP}${path.replace("<id>", "00000000-0000-4000-8000-000000000000")}`;
  return { kind, trigger, texts: [["First text after opt-in", first], ["Every later text", later]] };
});
const SMS_FIXED = [
  ["Opt-in confirmation (double opt-in)", "Louisiana Helpr: Reply YES 4821 to get alerts about your jobs and messages. Msg frequency varies. Msg&data rates may apply. HELP for help, STOP to cancel.", "Member ticks the text alerts box in Settings."],
  ["Reply to YES without the code", "Louisiana Helpr: to turn on alerts, reply YES and the 4-digit code from our text, like YES 1234. Reply STOP to cancel.", "Inbound YES with no code (twilio-inbound)."],
  ["Opt-in confirmed", "Louisiana Helpr: You're now signed up for job alert texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.", "Inbound YES <code> accepted."],
  ["HELP reply", "Louisiana Helpr alerts: help at louisianahelpr.com/support or admin@louisianahelpr.com. Msg & data rates may apply. Reply STOP to cancel.", "Inbound HELP / INFO."],
  ["Owner: new support message", `New Helpr support message ${APP}/admin?view=support`, "Anyone writes to support (to the owner's phone)."],
];

// JS port of public.sms_kind_for for literal titles (read 2026-11-09).
function smsKind(type, title) {
  const t = title;
  if (type === "job_match") return "";
  if (type === "message") return "message";
  if (type === "warning" && t === "Please review the work") return "needs_you";
  if (type === "payment" && ["Check out within 24 hours", "2 hours left to check out"].includes(t)) return "needs_you";
  if (type === "declutter_pickups" && (["Porch pickup in 1 hour", "Pickup in 1 hour"].includes(t) || t.startsWith("Porch pickup at ") || t.startsWith("Pickup at "))) return "needs_you";
  if (type === "declutter_offers" && ["Answer the offer", "Offer closes soon"].includes(t)) return "needs_you";
  if (type === "declutter_refunds" && ["Answer the refund request", "Refund request closes soon", "Answer the refund offer", "Refund offer closes soon"].includes(t)) return "needs_you";
  if (type === "new_offers" && ["You got a direct job offer!", "New job offer", "📋 New job offer!"].includes(t)) return "job_offer";
  if (type === "info" && t === "📋 New job offer!") return "job_offer";
  if (type === "application" && t === "New application") return "application";
  if (type === "job_update" && ["Starting soon", "Your job starts in 2 hours", "Time to head out"].includes(t)) return "starting_soon";
  if (type === "job_updates" && t === "New date or time requested") return "reschedule";
  if (["warning", "job_updates"].includes(type) && ["A dispute was opened", "Job disputed"].includes(t)) return "dispute";
  if (["payment", "warning"].includes(type) && ["Job cancelled", "Job cancelled — you'll be compensated"].includes(t)) return "job_cancelled";
  if (["warning", "job_updates"].includes(type) && t === "Your Helpr cancelled") return "job_cancelled";
  if (type === "job_updates" && t === "Job auto-cancelled") return "job_cancelled";
  if (type === "warning" && ["Your payout didn't go through", "Payout account needs attention", "Payment failed", "Your bank payment failed", "Job payment failed"].includes(t)) return "money_problem";
  if (type === "payment" && t === "A refund didn't go through") return "money_problem";
  if (type === "financial_alerts" && ["Payout account required", "We couldn't send your payout"].includes(t)) return "money_problem";
  if (type === "job_updates" && ["Offer declined", "Offer expired", "Your Helpr didn't confirm", "Your Helpr hasn't confirmed yet", "A Helpr on your crew hasn't confirmed yet"].includes(t)) return "";
  if (["job_updates", "job_update", "work_status", "expired", "info", "success"].includes(type)) return "job_update (if about a job)";
  return "";
}

// ── page ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const groups = [...new Set(manifest.map((m) => m.group))];
const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅå_^{}\\[~\]|€ÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà]*$/;
const emailCards = groups.map((g) => `
  <section class="group" id="g-${esc(g.replace(/\W+/g, "-"))}">
    <h2>${esc(g)} <span class="count">${manifest.filter((m) => m.group === g).length}</span></h2>
    ${manifest.filter((m) => m.group === g).map((m) => `
    <article class="email" id="${m.id}">
      <header>
        <h3>${esc(m.name)}</h3>
        <dl><dt>Subject</dt><dd>${esc(m.subject)}</dd><dt>When</dt><dd>${esc(m.trigger)}</dd><dt>Sender</dt><dd><code>${esc(m.sender)}</code></dd></dl>
        <p class="links"><a href="html/${m.id}.html" target="_blank" rel="noopener">Open HTML</a> · <a href="html/${m.id}.txt" target="_blank" rel="noopener">Plain-text part</a></p>
      </header>
      <div class="shots">
        ${[["375", "light", "Phone, light"], ["375", "dark", "Phone, dark"], ["1440", "light", "Desktop, light"], ["1440", "dark", "Desktop, dark"]].map(([w, s, label]) => `
        <figure class="w${w}"><a href="png/${m.id}-${w}-${s}.png" target="_blank" rel="noopener"><img loading="lazy" src="png/${m.id}-${w}-${s}.png" alt="${esc(m.name)}: ${label}"></a><figcaption>${label}</figcaption></figure>`).join("")}
      </div>
    </article>`).join("")}
  </section>`).join("");

const smsRows = SMS.flatMap((s) => s.texts.map(([when, text]) => `<tr><td><code>${s.kind}</code></td><td>${esc(when)}</td><td class="msg">${esc(text)}</td><td class="${text.length > 160 ? "warn" : ""}">${text.length}${gsm.test(text) ? "" : " (not GSM-7)"}</td><td>${esc(s.trigger)}</td></tr>`)).join("");
const smsFixedRows = SMS_FIXED.map(([name, text, when]) => `<tr><td colspan="2">${esc(name)}</td><td class="msg">${esc(text)}</td><td class="${text.length > 160 ? "warn" : ""}">${text.length}${gsm.test(text) ? "" : " (not GSM-7)"}</td><td>${esc(when)}</td></tr>`).join("");
const noticeRows = notices.map((n) => {
  const kind = n.type && !n.type.startsWith("{") ? smsKind(n.type, n.title) : "";
  return `<tr data-type="${esc(n.type)}"><td><code>${esc(n.type || "(edge)")}</code></td><td class="t ${n.title.length > 45 ? "warn" : ""}">${esc(n.title)}</td><td class="msg">${esc(n.message)}</td><td><code>${esc(n.link)}</code></td><td>${esc(kind)}</td><td><code>${esc(n.fn)}</code><br><span class="via">${esc(n.via)}</span></td></tr>`;
}).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Helpr Message Gallery</title>
<style>
:root { --bg:#f6f3ee; --card:#fff; --ink:#2b2a24; --muted:#6c6a5f; --line:#e3ddd2; --accent:#5e6544; --warn:#a2432a; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#191916; --card:#24231f; --ink:#ece8df; --muted:#a8a496; --line:#3a3832; --accent:#b9c18f; --warn:#ef8e6f; } }
:root[data-theme="dark"] { --bg:#191916; --card:#24231f; --ink:#ece8df; --muted:#a8a496; --line:#3a3832; --accent:#b9c18f; --warn:#ef8e6f; }
* { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif }
.wrap { max-width:1280px; margin:0 auto; padding:24px 16px 80px }
h1 { font-size:28px; margin:0 0 4px } h2 { font-size:20px; margin:40px 0 12px; border-bottom:1px solid var(--line); padding-bottom:6px } h3 { margin:0 0 6px; font-size:17px }
.count { color:var(--muted); font-weight:400; font-size:14px }
nav { background:var(--bg); padding:10px 0; border-bottom:1px solid var(--line); display:flex; flex-wrap:wrap; gap:8px 14px; z-index:2 }
nav a { color:var(--accent); text-decoration:none; font-size:14px }
.note { color:var(--muted); max-width:860px }
.email { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin:14px 0 }
dl { display:grid; grid-template-columns:70px 1fr; gap:2px 10px; margin:0; font-size:14px } dt { color:var(--muted) } dd { margin:0 }
code { font-size:12.5px; word-break:break-all } .links a { color:var(--accent) }
.shots { display:grid; grid-template-columns:repeat(2, minmax(0,180px)) repeat(2, minmax(0,1fr)); gap:12px; margin-top:12px; align-items:start }
figure { margin:0 } figure img { width:100%; border:1px solid var(--line); border-radius:8px; display:block; max-height:520px; object-fit:cover; object-position:top }
figcaption { font-size:12px; color:var(--muted); margin-top:4px }
@media (max-width:760px) { .shots { grid-template-columns:repeat(2, minmax(0,1fr)) } .shots .w1440 { display:none } }
table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; font-size:13.5px }
th, td { text-align:left; vertical-align:top; padding:8px 10px; border-bottom:1px solid var(--line) } th { background:var(--bg) }
@media (min-width:760px) { nav { position:sticky; top:0 } }
td.msg { max-width:520px } .warn { color:var(--warn); font-weight:600 } .via { color:var(--muted); font-size:12px }
.tablewrap { overflow-x:auto } input[type=search] { width:100%; max-width:420px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--ink); margin:8px 0 }
</style></head>
<body><div class="wrap">
<h1>Helpr message gallery</h1>
<p class="note">Every email the app can send, rendered from the real templates with sample names and amounts, at phone (375) and desktop (1440) width in light and dark; every text message; and every in-app notice wording (each notice is also the push title and body). Built ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })} (Central) from main. Nothing was sent. Dark shots use the browser's dark setting (prefers-color-scheme), which Apple Mail and some others follow; Gmail applies its own inversion, which a browser cannot show.</p>
<nav>${groups.map((g) => `<a href="#g-${esc(g.replace(/\W+/g, "-"))}">${esc(g)}</a>`).join("")}<a href="#sms">Text messages</a><a href="#push">Notices and push</a></nav>
${emailCards}
<section id="sms"><h2>Text messages (SMS) <span class="count">${SMS.length} kinds + ${SMS_FIXED.length} fixed</span></h2>
<p class="note">Privacy rule (owner 10-20): a text never carries a name, job title or address, only a fixed phrase for its kind and a link. A notice becomes a text only when public.sms_kind_for gives it a kind, the member opted in, and the sms_alerts switch is on for them. Texts go out about 3 minutes after the notice. Lengths over 160 are marked.</p>
<div class="tablewrap"><table><thead><tr><th>Kind</th><th>Which text</th><th>Wording</th><th>Chars</th><th>Sent when</th></tr></thead><tbody>${smsRows}${smsFixedRows}</tbody></table></div></section>
<section id="push"><h2>Notices and push <span class="count">${notices.length} wordings</span></h2>
<p class="note">Read from the live database functions and the edge functions. Each row is a bell notice; the same title and message are the push notification (when push is on for that member and notice type), and the row's type picks whether it emails and whether it texts (SMS column). <code>{…}</code> is filled in when sent (a name, title, date or amount); <code>‖</code> separates alternative wordings in one call. Titles over 45 characters are marked (iOS shows about that much on a lock screen).</p>
<input type="search" id="q" placeholder="Filter by any word (type, title, message, function)" aria-label="Filter notices">
<div class="tablewrap"><table id="notices"><thead><tr><th>Type</th><th>Title (push title)</th><th>Message (push body)</th><th>Opens</th><th>SMS kind</th><th>Written by</th></tr></thead><tbody>${noticeRows}</tbody></table></div></section>
</div>
<script>
const q = document.getElementById("q");
q.addEventListener("input", () => { const v = q.value.toLowerCase(); for (const tr of document.querySelectorAll("#notices tbody tr")) tr.style.display = tr.textContent.toLowerCase().includes(v) ? "" : "none"; });
</script>
</body></html>`;
writeFileSync(join(outDir, "index.html"), html);
console.log(`gallery: ${manifest.length} emails${shots ? ` x 4 shots` : ""}, ${SMS.length * 2 + SMS_FIXED.length} texts, ${notices.length} notices -> ${join(outDir, "index.html")}`);
