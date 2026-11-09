// Message gallery, part 1: every email the app can send, rendered with the REAL templates
// (supabase/functions/_shared/email-templates) and realistic sample data, to HTML files.
// Sends nothing: it only calls renderEmail(), never Resend or the queue.
//
//   deno run --allow-read --allow-write --allow-env --allow-net=registry.npmjs.org,esm.sh \
//     scripts/test-lab/render-email-gallery.tsx <out-dir>
//
// Each entry names its sender (file) and trigger. Props are copied from the sender's own
// createElement call; where a sender builds the copy inline (admin-user-actions, admin-support-reply,
// stripe-webhook receipts), the words here are that sender's words with sample names and amounts.
import * as React from "npm:react@18.3.1";
import { renderEmail } from "../../supabase/functions/_shared/email-templates/render.ts";
import { SignupEmail } from "../../supabase/functions/_shared/email-templates/signup.tsx";
import { InviteEmail } from "../../supabase/functions/_shared/email-templates/invite.tsx";
import { MagicLinkEmail } from "../../supabase/functions/_shared/email-templates/magic-link.tsx";
import { RecoveryEmail } from "../../supabase/functions/_shared/email-templates/recovery.tsx";
import { EmailChangeEmail } from "../../supabase/functions/_shared/email-templates/email-change.tsx";
import { ReauthenticationEmail } from "../../supabase/functions/_shared/email-templates/reauthentication.tsx";
import { ConfirmReminderEmail } from "../../supabase/functions/_shared/email-templates/confirmReminder.tsx";
import { ComeBackEmail } from "../../supabase/functions/_shared/email-templates/comeBack.tsx";
import { WelcomeDripStep1Email, WelcomeDripStep2Email, WelcomeDripStep3Email, ReEngagementEmail, SignupLeadReminderEmail } from "../../supabase/functions/_shared/email-templates/drip.tsx";
import { AdminDigestEmail, OwnerDailySummaryEmail } from "../../supabase/functions/_shared/email-templates/lifecycle.tsx";
import { AccountStatusEmail } from "../../supabase/functions/_shared/email-templates/account-status.tsx";
import { AdminActionEmail } from "../../supabase/functions/_shared/email-templates/admin-action.tsx";
import { AdminEmailChangedEmail, SelfEmailChangeNoticeEmail } from "../../supabase/functions/_shared/email-templates/email-changed.tsx";
import { GiftCardEmail } from "../../supabase/functions/_shared/email-templates/gift-card.tsx";
import { MarketingBlastEmail } from "../../supabase/functions/_shared/email-templates/marketing-blast.tsx";
import { SupportRequestEmail } from "../../supabase/functions/_shared/email-templates/support-request.tsx";
import { NotificationEmail } from "../../supabase/functions/_shared/email-templates/notification.tsx";
import { notificationActionLabel } from "../../supabase/functions/_shared/email-templates/notificationAction.ts";
import { CONFIRM_REMINDER_COPY } from "../../supabase/functions/_shared/confirmReminder.ts";
import { COME_BACK_COPY } from "../../supabase/functions/_shared/comeBackEmail.ts";

const out = Deno.args[0];
if (!out) throw new Error("usage: render-email-gallery.tsx <out-dir>");
await Deno.mkdir(out, { recursive: true });

const SITE = "https://www.louisianahelpr.com";
const UNSUB = `${SITE}/unsubscribe?t=sample-signed-token`;
const PREFS = `${SITE}/profile?tab=notifications`;
const HOST = "www.louisianahelpr.com";
const CONFIRM = `${SITE}/auth/confirm?token=sample`;
const h = React.createElement;

type Entry = { id: string; group: string; name: string; subject: string; sender: string; trigger: string; el?: unknown; rawHtml?: string };
const E: Entry[] = [];
const add = (e: Entry) => E.push(e);

// ── Account and sign-in (auth-email-hook: Supabase Auth's send-email hook) ──
const AUTH = "supabase/functions/auth-email-hook/index.ts";
add({ id: "auth-signup", group: "Account and sign-in", name: "Confirm your email (sign-up)", subject: "Confirm your email", sender: AUTH, trigger: "Someone signs up with email.", el: h(SignupEmail, { siteName: "Louisiana Helpr", siteUrl: SITE, recipient: "marie.thibodeaux@example.com", confirmationUrl: CONFIRM }) });
add({ id: "auth-invite", group: "Account and sign-in", name: "Invite", subject: "You've been invited to Helpr", sender: AUTH, trigger: "An admin invites someone from Supabase Auth.", el: h(InviteEmail, { siteName: "Louisiana Helpr", siteUrl: SITE, confirmationUrl: CONFIRM }) });
add({ id: "auth-magic-link", group: "Account and sign-in", name: "Sign-in code", subject: "Your Helpr code", sender: AUTH, trigger: "Member signs in with an emailed code.", el: h(MagicLinkEmail, { token: "482913" }) });
add({ id: "auth-recovery", group: "Account and sign-in", name: "Reset password", subject: "Reset your Helpr password", sender: AUTH, trigger: "Member taps Forgot password.", el: h(RecoveryEmail, { siteName: "Louisiana Helpr", confirmationUrl: CONFIRM }) });
add({ id: "auth-email-change", group: "Account and sign-in", name: "Confirm new email address", subject: "Confirm your new email / Email change requested", sender: AUTH, trigger: "Member changes their email in Profile (sent to the old and the new address).", el: h(EmailChangeEmail, { siteName: "Louisiana Helpr", email: "marie.thibodeaux@example.com", newEmail: "marie.t@example.net", confirmationUrl: CONFIRM }) });
add({ id: "auth-reauth", group: "Account and sign-in", name: "Verification code (re-authenticate)", subject: "Your verification code", sender: AUTH, trigger: "A sensitive change asks the member to prove it is them.", el: h(ReauthenticationEmail, { token: "730155" }) });
add({ id: "notify-email-change", group: "Account and sign-in", name: "Your email is being changed (notice to old address)", subject: "Your Helpr email address is being changed", sender: "supabase/functions/notify-email-change/index.ts", trigger: "Member starts an email change; the old address is told.", el: h(SelfEmailChangeNoticeEmail, { oldEmail: "marie.thibodeaux@example.com", newEmail: "marie.t@example.net" }) });
add({ id: "admin-email-changed", group: "Account and sign-in", name: "Your email was changed by an admin", subject: "Your Helpr email address was changed", sender: "supabase/functions/admin-update-email/index.ts", trigger: "An admin changes a member's email.", el: h(AdminEmailChangedEmail, { oldEmail: "marie.thibodeaux@example.com", newEmail: "marie.t@example.net" }) });
for (const step of [1, 2] as const) {
  add({ id: `confirm-reminder-${step}`, group: "Account and sign-in", name: `Confirm-your-email reminder ${step}`, subject: CONFIRM_REMINDER_COPY[step].subject, sender: "supabase/functions/confirm-reminders/index.ts", trigger: `Sign-up never confirmed (reminder ${step} of 2).`, el: h(ConfirmReminderEmail, { step, confirmationUrl: CONFIRM }) });
}
add({ id: "signup-lead-reminder", group: "Account and sign-in", name: "Finish signing up (lead reminder)", subject: "Finish signing up for Louisiana Helpr", sender: "supabase/functions/signup-lead-reminders/index.ts", trigger: "Someone started sign-up (left an email) and did not finish.", el: h(SignupLeadReminderEmail, { signupUrl: `${SITE}/auth?mode=signup`, unsubscribeUrl: UNSUB }) });
add({ id: "account-verified", group: "Account and sign-in", name: "Identity verified", subject: "Your identity is verified — welcome to Louisiana Helpr", sender: "supabase/functions/send-account-status-email/index.ts", trigger: "ID check passes.", el: h(AccountStatusEmail, { status: "verified", greetingName: "Marie", ctaUrl: `${SITE}/home`, pixelUrl: `${SITE}/px.gif` }) });

// ── Welcome and come-back (marketing: unsubscribe required) ──
const ENG = "supabase/functions/engagement-automations/index.ts";
add({ id: "drip-1", group: "Welcome and come-back (marketing)", name: "Welcome drip, day 1", subject: "You're in. Here's where to start on Louisiana Helpr.", sender: ENG, trigger: "1 day after sign-up.", el: h(WelcomeDripStep1Email, { greetingName: "Marie", dashboardUrl: `${SITE}/home`, unsubscribeUrl: UNSUB }) });
add({ id: "drip-2", group: "Welcome and come-back (marketing)", name: "Welcome drip, day 3", subject: "A quick tour of how Louisiana Helpr works.", sender: ENG, trigger: "3 days after sign-up.", el: h(WelcomeDripStep2Email, { greetingName: "Marie", dashboardUrl: `${SITE}/home`, unsubscribeUrl: UNSUB }) });
add({ id: "drip-3", group: "Welcome and come-back (marketing)", name: "Welcome drip, day 7", subject: "Four things great Helprs do.", sender: ENG, trigger: "7 days after sign-up.", el: h(WelcomeDripStep3Email, { greetingName: "Marie", dashboardUrl: `${SITE}/home`, unsubscribeUrl: UNSUB }) });
add({ id: "re-engagement", group: "Welcome and come-back (marketing)", name: "Re-engagement", subject: "(set in engagement-automations)", sender: ENG, trigger: "Member inactive for a while.", el: h(ReEngagementEmail, { greetingName: "Marie", dashboardUrl: `${SITE}/home`, unsubscribeUrl: UNSUB }) });
for (const step of [1, 2] as const) {
  add({ id: `come-back-${step}`, group: "Welcome and come-back (marketing)", name: `Founder come-back note ${step}`, subject: COME_BACK_COPY[step].subject, sender: "supabase/functions/come-back-emails/index.ts", trigger: `Signed up, never posted or applied (note ${step} of 2). Behind switch come_back_emails.`, el: h(ComeBackEmail, { step, fullName: "Marie Thibodeaux", appUrl: `${SITE}/home`, unsubscribeUrl: UNSUB }) });
}
add({ id: "marketing-blast", group: "Welcome and come-back (marketing)", name: "Marketing blast (sample body)", subject: "(the admin types it)", sender: "supabase/functions/send-marketing-blast/index.ts", trigger: "Admin sends a campaign from Admin > Marketing.", el: h(MarketingBlastEmail, { preheader: "Spring cleaning? Sell what you don't need this weekend.", bodyHtml: "<p>Hi neighbor,</p><p>Declutter is open across Lafayette. Post a photo, set a garage-sale price, and buyers pick it up from your porch.</p><p><a href=\"https://www.louisianahelpr.com/declutter/sell\">Sell something today</a></p>", unsubscribeUrl: UNSUB }) });

// ── Notices (every bell notice that emails goes through NotificationEmail via send_notice_email -> send-notification-email) ──
const NOTICE = "supabase/functions/send-notification-email/index.ts (via public.send_notice_email)";
const notices: Array<[string, string, string, string, string]> = [
  ["job_updates", "Hallie H. accepted your offer", "Hallie H. accepted \"Pressure wash a patio\". You're all set.", "/posts?job=x", "Poster: the Helpr accepts the hire."],
  ["application", "New application", "Marie T. applied to \"Wash two cars\". Next: review and pick a Helpr before it starts Sun, Nov 15 at 10:00 AM.", "/posts?job=x", "Poster: someone applied."],
  ["job_update", "Still on for tomorrow?", "\"Assemble a bookshelf\" starts soon — tap to confirm you're still on so your Helpr knows it's a go.", "/posts?job=x", "Day-before confirm (poster)."],
  ["transit_updates", "Hallie H. is on the way", "Hallie H. is heading to your job: \"Mow a front lawn\". Next: nothing for you to do until they arrive.", "/posts?job=x", "Helpr taps On my way."],
  ["transit_updates", "Hallie H. has arrived", "Hallie H. has arrived for \"Clean out a garage\". Next: nothing for you to do; they mark it done when they finish.", "/posts?job=x", "Helpr arrives (GPS)."],
  ["job_updates", "Your Helpr needs another day", "Hallie asked to finish \"Lay garden pavers\" on Wed 11/11 at 9 AM. Next: confirm the new day.", "/posts?job=x", "Helpr proposes a continue day."],
  ["work_status", "Hallie H. marked the job complete", "Hallie H. has finished \"Haul brush to the curb\". Next: check the work and approve by Tue, Nov 10 at 12:28 PM, or Helpr support steps in.", "/posts?job=x", "Helpr marks done."],
  ["job_updates", "A dispute was opened", "A dispute was opened on \"Regrout a tub surround\". The payment is on hold while it is reviewed — add your side so an admin hears both.", "/jobs?job=x", "Poster opens a dispute (to the Helpr)."],
  ["warning", "Job cancelled", "\"Move a dresser\" was cancelled by the person who posted it.", "/jobs?job=x", "Poster cancels (to the Helpr)."],
  ["financial_alerts", "Payout released", "Your payout for \"Trim the hedges\" has been released to your account.", "/profile?tab=earnings", "Payout sent to the Helpr."],
  ["message", "Unread message", "Hallie H. is waiting on your reply. Next: open the message and reply.", "/messages?jobId=x", "Unread message reminder."],
  ["declutter_offers", "New offer", "You got a $15 offer on \"Table lamp\". Accept, decline or counter within 48 hours.", "/declutter?tab=selling&offer=x", "Seller: a buyer made an offer."],
  ["declutter_offers", "New counteroffer", "You got a $15 counteroffer on \"Throw pillows (pair)\". Accept, decline or counter within 48 hours.", "/declutter?tab=buying&offer=x", "Buyer: the seller countered."],
  ["declutter_sales", "Reserved for you: check out within 24 hours", "Marie T. accepted your $20 offer for \"Picture frame set\". Check out within 24 hours: choose pickup or delivery, pick a day and time, and pay, or it goes back up for sale and you get a strike. Your card is not charged until you check out.", "/declutter?tab=buying", "Buyer: offer accepted."],
  ["declutter_offers", "New trade offer", "Hallie H. offered \"Bluetooth speaker\" in trade for \"Cast iron skillet\". Accept or decline within 48 hours. No money changes hands.", "/declutter?tab=selling", "Seller: a trade was offered."],
  ["declutter_listings", "Your listings are live", "10 listings are live. Buyers can see them now.", "/declutter?tab=selling", "Seller: listings went live."],
];
notices.forEach(([type, title, message, link, trigger], i) => {
  add({ id: `notice-${String(i + 1).padStart(2, "0")}`, group: "Notices (bell notices that also email)", name: title, subject: title, sender: NOTICE, trigger: `${trigger} Type ${type}; emails only if that notice type's email switch is on.`, el: h(NotificationEmail, { title, message, actionUrl: `${SITE}${link}`, actionLabel: notificationActionLabel(link), userName: "Marie", prefsUrl: PREFS, host: HOST }) });
});

// ── Declutter money emails ──
const DEC = "supabase/functions/stripe-webhook/handlers/declutterCheckout.ts";
const decl = (id: string, name: string, subject: string, body: string, path: string, label: string, sender: string, trigger: string) =>
  add({ id, group: "Declutter money emails", name, subject, sender, trigger, el: h(NotificationEmail, { title: subject, message: body, actionUrl: `${SITE}${path}`, actionLabel: label, userName: "Marie", prefsUrl: PREFS, host: HOST }) });
decl("declutter-receipt", "Buyer receipt (porch/pickup)", "Your Declutter receipt", "You paid $15.95 for your Declutter order. The money is held until you have your items; then the seller is paid. Next: pick up your items at the time you chose.", "/declutter?tab=buying", "Open Buying", DEC, "Buyer pays an order.");
decl("declutter-receipt-delivery", "Buyer receipt (seller delivers)", "Your Declutter receipt", "You paid $52.75 for your Declutter order. The money is held until you have your items; then the seller is paid. Next: the seller delivers your items at the time you picked. Tap \"I got it\" in the app when you have them.", "/declutter?tab=buying", "Open Buying", DEC, "Buyer pays a seller-delivery order.");
decl("declutter-ship-hold", "Buyer: shipping hold", "Your Declutter order", "We're holding $24.50 on your card for your Declutter order. You're charged once the shipping label is made; if it can't be made, the hold is released and you pay nothing. You'll get tracking in the app.", "/declutter?tab=buying", "Open Buying", DEC, "Buyer pays a shipped order (card held).");
decl("declutter-refund-webhook", "Buyer refund (card)", "Your Declutter refund", "$15.95 is on its way back to your card. Card refunds usually show up in 5 to 10 business days.", "/declutter?tab=buying", "Open Buying", DEC, "A refund is confirmed by Stripe.");
decl("declutter-sold", "Seller: you sold", "You sold \"Ceramic planter\"", "You sold \"Ceramic planter\" for $12.00. The buyer has paid. Hand it over as planned; you get paid after the handover.", "/declutter?tab=selling", "Open Selling", "supabase/functions/_shared/declutterSellerEmail.ts", "Buyer pays (to the seller).");
decl("declutter-payout", "Seller: payout sent", "Your payout is on its way", "Your $12.00 payout for \"Ceramic planter\" was sent. It lands in your bank on your usual payout schedule.", "/declutter?tab=selling", "Open Selling", "supabase/functions/_shared/declutterSellerEmail.ts", "declutter-money sends the payout.");
add({ id: "declutter-refund-raw", group: "Declutter money emails", name: "Buyer refund from declutter-money (UNBRANDED raw HTML)", subject: "Your Declutter refund", sender: "supabase/functions/declutter-money/index.ts (tellBuyerRefunded)", trigger: "declutter-money executes a refund (seller backed out, no-show, problem decided, etc.).", rawHtml: `<p>$15.95 is on its way back to your card. Card refunds usually show up in 5 to 10 business days.</p><p><a href="${SITE}/declutter?tab=buying">Open your Declutter cart</a></p>` });

// ── Gift cards ──
add({ id: "gift-card", group: "Gift cards", name: "Gift credit received", subject: "Paul Broussard sent you a $25.00 Helpr credit", sender: "supabase/functions/_shared/giftCardEmail.ts", trigger: "Someone buys a gift credit for this email.", el: h(GiftCardEmail, { donorName: "Paul Broussard", amount: "$25.00", claimUrl: `${SITE}/gift/claim?code=sample`, note: "Happy birthday! Get some help with the yard this spring." }) });

// ── Admin and support emails to members ──
const AUA = "supabase/functions/admin-user-actions/index.ts";
add({ id: "admin-verified", group: "Admin and support emails to members", name: "Manually verified", subject: "You're verified on Helpr", sender: AUA, trigger: "Admin verifies a member by hand.", el: h(AdminActionEmail, { preheader: "An admin verified your identity — you now have full access to Helpr.", title: "You're verified", greetingName: "Marie", paragraphs: [["An admin has personally ", { accent: "verified your account" }, ". You now have full access to post or accept jobs on Helpr."]], ctaUrl: `${SITE}/home`, ctaLabel: "Go to Dashboard" }) });
add({ id: "admin-id-reupload", group: "Admin and support emails to members", name: "Please re-upload your ID", subject: "Helpr — please re-upload your ID", sender: AUA, trigger: "Admin asks for a clearer ID photo.", el: h(AdminActionEmail, { preheader: "Your ID photo was hard to read — please upload a clearer one.", title: "Quick fix needed on your ID", greetingName: "Marie", paragraphs: ["Your ID photo was a bit hard to read on our end. Can you snap a clearer one so we can finish setting you up?"], callouts: [{ tone: "note", body: [{ b: "Admin note:" }, " ", "The photo was blurry around your birth date."] }], ctaUrl: `${SITE}/profile`, ctaLabel: "Re-upload ID" }) });
add({ id: "admin-password-reset", group: "Admin and support emails to members", name: "Password reset sent by an admin", subject: "Reset your Helpr password", sender: AUA, trigger: "Admin sends a reset link.", el: h(AdminActionEmail, { preheader: "An admin sent you a password reset link — it expires in 1 hour.", title: "Reset your password", greetingName: "Marie", paragraphs: ["An admin sent you a password reset link. Click the button below to choose a new password. This link expires in 1 hour."], ctaUrl: CONFIRM, ctaLabel: "Reset Password" }) });
add({ id: "admin-warning-1", group: "Admin and support emails to members", name: "Formal warning (strike 1)", subject: "(emailSubject, strike 1)", sender: AUA, trigger: "Admin gives a strike.", el: h(AdminActionEmail, { preheader: "A formal warning has been issued on your Helpr account (strike 1 of 3).", title: "Formal warning (Strike 1 of 3)", greetingName: "Marie", paragraphs: ["You've received a formal warning regarding a platform policy violation:"], callouts: [{ tone: "note", body: "Asked a Helpr to be paid in cash outside the app." }, { tone: "plain", body: ["This is your ", { b: "1st strike" }, ". A 2nd strike will trigger a final warning banner across the app; a 3rd will result in a 7-day account suspension."] }], ctaUrl: `${SITE}/rules`, ctaLabel: "Review Platform Rules" }) });
add({ id: "admin-warning-2", group: "Admin and support emails to members", name: "Final warning (strike 2)", subject: "Helpr — FINAL warning", sender: AUA, trigger: "Admin gives a second strike.", el: h(AdminActionEmail, { preheader: "This is a final warning on your Helpr account — one more violation means a 7-day suspension.", title: "Final warning (Strike 2 of 3)", greetingName: "Marie", paragraphs: ["You've received a formal warning regarding a platform policy violation:"], callouts: [{ tone: "alert", body: [{ b: "This is your final warning." }, " One more violation will result in an automatic 7-day suspension. A warning banner is now visible at the top of your app."] }], ctaUrl: `${SITE}/rules`, ctaLabel: "Review Platform Rules" }) });
add({ id: "admin-suspended", group: "Admin and support emails to members", name: "Suspended 7 days (strike 3)", subject: "Helpr — Account suspended (7 days)", sender: AUA, trigger: "Third strike.", el: h(AdminActionEmail, { preheader: "Your Helpr account is suspended for 7 days after a third violation. Access returns on 11/16/2026.", title: "Account suspended for 7 days", greetingName: "Marie", paragraphs: ["Your account has been automatically suspended due to a third platform policy violation:"], callouts: [{ tone: "alert", body: [{ b: "Your account has reached 3 strikes and is now suspended." }, " Access will be restored on ", { b: "11/16/2026" }, ". All active bids have been cancelled."] }], ctaUrl: `${SITE}/rules`, ctaLabel: "Review Platform Rules" }) });
add({ id: "admin-support-reply", group: "Admin and support emails to members", name: "Support replied", subject: "Re: Payout question", sender: "supabase/functions/admin-support-reply/index.ts", trigger: "Admin answers a support message.", el: h(AdminActionEmail, { preheader: "A reply about \"Payout question\"", title: "Louisiana Helpr Team replied", greetingName: "Marie", paragraphs: [["About your message \"", { b: "Payout question" }, "\":"], "Thanks for writing in. Your payout for the hedge trim went out this morning and should land in 1 to 2 business days.", "If it hasn't shown up by Thursday, reply in the app and we'll look again."], ctaUrl: `${SITE}/messages`, ctaLabel: "Reply in the app", footerNote: "Questions? Use the button above to reply in the app.", signOff: "— Louisiana Helpr Team" }) });

// ── To the owner / admins ──
add({ id: "support-request", group: "To the owner (admin inbox)", name: "New support request", subject: "[Payments] Payout question — Marie Thibodeaux", sender: "supabase/functions/contact-support/index.ts", trigger: "Anyone sends the support form.", el: h(SupportRequestEmail, { topicLabel: "Payments", name: "Marie Thibodeaux", email: "marie.thibodeaux@example.com", subject: "Payout question", message: "Hi, I finished a job Saturday and haven't seen the payout yet. Is that normal?", accountLine: "Member since Oct 2026 (signed in)" }) });
add({ id: "owner-daily", group: "To the owner (admin inbox)", name: "Owner daily summary", subject: "Louisiana Helpr daily summary: 4 sign-ups, 2 items sold", sender: ENG, trigger: "Daily cron.", el: h(OwnerDailySummaryEmail, { stats: { newUsers: 4, jobsPosted: 3, itemsPosted: 6, jobsCompleted: 2, itemsSold: 2, salesCents: 4350, openReports: 0, failedPayouts: 0, memberErrors: 1, membersWithErrors: 1, topSources: [{ source: "direct", signups: 3 }, { source: "www.google.com", signups: 1 }] }, adminUrl: `${SITE}/admin`, dayOf: "Mon, Nov 9" }) });
add({ id: "admin-weekly", group: "To the owner (admin inbox)", name: "Weekly digest", subject: "Louisiana Helpr Weekly Digest — Week of Nov 9", sender: ENG, trigger: "Weekly cron.", el: h(AdminDigestEmail, { stats: { newUsers: 19, newJobs: 11, completedJobs: 7, openReports: 0, revenue: 64.2 }, adminUrl: `${SITE}/admin`, weekOf: "Nov 2" }) });

const manifest = [];
for (const e of E) {
  const html = e.rawHtml ?? (await renderEmail(e.el)).html;
  const text = e.rawHtml ? "(raw HTML send; text part built separately)" : (await renderEmail(e.el)).text;
  await Deno.writeTextFile(`${out}/${e.id}.html`, html);
  await Deno.writeTextFile(`${out}/${e.id}.txt`, text);
  const meta = { id: e.id, group: e.group, name: e.name, subject: e.subject, sender: e.sender, trigger: e.trigger };
  manifest.push(meta);
}
await Deno.writeTextFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`rendered ${manifest.length} emails into ${out}`);
