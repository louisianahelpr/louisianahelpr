import {
  Briefcase, MessageSquare, DollarSign, Star, Megaphone,
  Navigation, CheckCircle2, Users, RefreshCw, Receipt, ShieldAlert, Sparkles,
  Tag, HandCoins, MessageCircleQuestion, ShoppingBag, CalendarClock, Undo2, TrendingDown, Search, Store, Info,
} from "lucide-react";
import type { Prefs, Row } from "./types";

export const defaultPrefs: Prefs = {
  job_applications: true, job_updates: true, messages: true, payments: true,
  reviews: true, promotions: true, system_alerts: true,
  // Both masters default on, and both are their own DB column — neither one
  // stands in for the eleven category columns below it.
  push_enabled: true, email_enabled: true,
  // email_messages: on for everyone since 20261030150631 (owner 2026-10-30, Messages audit H1).
  email_job_applications: true, email_job_updates: true, email_messages: true,
  // email_promotions: null = never chosen, the column default since
  // 20261021135832 (Q2299); a false here would turn into a written opt-out the
  // first time a member without a row touched any switch.
  email_payments: true, email_reviews: true, email_promotions: null, email_system_alerts: true,
  new_offers: true, email_new_offers: true,
  transit_updates: true, email_transit_updates: false,
  work_status: true, email_work_status: true,
  financial_alerts: true, email_financial_alerts: true,
  job_matches: true, email_job_matches: true,
  declutter_listings: true, email_declutter_listings: true,
  declutter_offers: true, email_declutter_offers: true,
  declutter_questions: true, email_declutter_questions: true,
  shops_orders: true, email_shops_orders: true, shops_messages: true, email_shops_messages: true,
  shops_updates: true, email_shops_updates: true,
  // New from shops you follow (20261112070000): in the app and push; no email is sent for it.
  shops_following: true, email_shops_following: false,
  // Admin bell activity (20261112061000): the notices are always in an admin's bell; push and email default OFF.
  admin_activity: false, email_admin_activity: false,
  declutter_sales: true, email_declutter_sales: true,
  declutter_pickups: true, email_declutter_pickups: true,
  declutter_refunds: true, email_declutter_refunds: true,
  declutter_price_drops: true, email_declutter_price_drops: true,
  declutter_wanted: true, email_declutter_wanted: true,
  email_quote_reminders: true,
  match_digest_mode: false,
  // Messages audit M6: new-message alerts show the first words unless turned off.
  message_preview: true,
  // Saved-helper availability nudges are opt-in (owner, 2026-09-15) — off
  // until the user turns them on. Standalone toggle, not in `rows`.
  saved_helper_availability: false,
  remind_starting_soon: true,
  remind_finish_job: true,
  remind_payout_followups: true,
  remind_two_hours: true,
  remind_morning_of: true,
  remind_head_out: true,
  quiet_start: null,
  quiet_end: null,
};

// Coerce a Postgres `time` column (e.g. "22:00:00") to the `HH:MM`
// shape that `<input type="time">` expects. Returns null untouched so
// the toggle stays off until the user sets a window.
export const trimTime = (v: string | null | undefined): string | null => {
  if (!v) return null;
  return v.length >= 5 ? v.slice(0, 5) : v;
};

// Labels are capped by the row layout in NotificationPreferences.tsx: at a
// 375px viewport the label column is ~131px wide (335px panel − px-4 − the
// 28px glyph − the two 51px switch slots and their gap), so a label has to
// measure under that at 14px/600. "Transit (On the way / Arrived)" was 213px
// and truncated; every other label is a short Title Case pair well inside the
// budget ("Payments and tips", the widest survivor, is 119px).
//
// That budget is for 375 at the default scale, and it is not the tight case.
// At 320 the same arithmetic leaves 50px, and in Senior Mode these labels
// render at 17px (113–125px), so neither fits on one line however short the
// label is. The rows no longer truncate: under 360px they drop the glyph and
// tighten their gaps to roughly triple the column, and the label wraps to a
// second line if it still needs one. Keep labels to a short Title Case pair
// anyway — the budget above is what keeps them to ONE line at 375, and a
// label long enough to wrap there would push the whole list taller.
// ── Every mapped preference column gets a switch. All of them. ──
// This list used to hold 7 rows for the 10 columns
// `notification_type_pref_map` routes notifications through:
// `job_applications`, `job_updates`, `payments` and `system_alerts` had no
// control on this screen at all. That was survivable only while those columns
// were inert — 85% of accounts had no `notification_preferences` row, so the
// push gate skipped them entirely (fixed in 20260903012715). The moment the
// row always existed, four categories started being enforced against a
// preference the user could not see or change, which is a worse product than
// the bug it replaced and an App Store risk besides.
//
// `src/test/notificationTypeRegistries.test.ts` derives the required set from
// the map's seed rows in `supabase/migrations/` and fails if this list is
// missing any of them — so a future map row cannot go unswitched the way
// these four did. Do not shorten this list to match a hand-written count.
//
// On the two money rows: `payments` and `financial_alerts` are separate columns
// with separate types, but the senders don't split them cleanly by kind. Real
// members' titles on prod, last 60 days (read 2026-10-30): `financial_alerts`
// held money secured for a job, payout setup, payouts released and a tip;
// `payment` held refunds, job completed or approved, card saved, and also
// "Payout sent!" and tips. NOID-15 (10-31) moved "Payout sent!"
// (process-scheduled-payouts) and "You received a tip!" (checkout and the held
// tip repay) to `financial_alerts`, so each kind now sits under one row.
// F102 (owner UI audit 11-09): the switch names say plain outcomes ("Job updates", "Work status", "Job payments",
// "Payments and tips" and "System alerts" overlapped and needed the small print). Keys and columns are unchanged.
// F103 (owner UI audit 11-09): 35+ rows ran with no grouping until Job reminders. The rows sit under headers now
// (Messages, Jobs, Money, Account), each group contiguous; NotificationPreferences draws a header where the group
// changes. Keys, columns and switches are unchanged; only the order moved Messages to the top.
export const rows: Row[] = [
  { key: "messages", emailKey: "email_messages", label: "Messages", description: "New messages, plus a reminder at 15 min and 2 h if a job message is still unread. Texts follow Text alerts.", icon: <MessageSquare className="w-3.5 h-3.5" />, group: "Messages" },
  { key: "new_offers", emailKey: "email_new_offers", label: "Job offers", icon: <Briefcase className="w-3.5 h-3.5" />, group: "Jobs" },
  { key: "job_applications", emailKey: "email_job_applications", label: "Applications", icon: <Users className="w-3.5 h-3.5" />, group: "Jobs" },
  { key: "job_updates", emailKey: "email_job_updates", label: "Changes to my jobs", icon: <RefreshCw className="w-3.5 h-3.5" />, group: "Jobs" },
  // The Daily Match Digest row renders directly beneath this one (see
  // NotificationPreferences.tsx) — it is a delivery mode FOR this category,
  // and it greys out when this switch is off.
  { key: "job_matches", emailKey: "email_job_matches", label: "New matches", icon: <Sparkles className="w-3.5 h-3.5" />, group: "Jobs" },
  // Owner 11-08 (20261108160000): this row's switches pick push and email (both real now); the notice is always
  // kept in the notifications list.
  // Audit 11-10 F452: the email switch starts OFF for everyone (notification_preferences.email_transit_updates
  // DEFAULT false since 20260418215317, a live "heading your way" notice is for push), so the row says so.
    { key: "transit_updates", emailKey: "email_transit_updates", label: "Helpr on the way", description: "As your Helpr heads your way. Email is off unless you turn it on.", icon: <Navigation className="w-3.5 h-3.5" />, group: "Jobs" },
  { key: "work_status", emailKey: "email_work_status", label: "Helpr's progress", description: "When the work starts and when it's marked done.", icon: <CheckCircle2 className="w-3.5 h-3.5" />, group: "Jobs" },
  { key: "payments", emailKey: "email_payments", label: "Receipts and refunds", description: "Finished jobs, refunds and saved cards.", icon: <Receipt className="w-3.5 h-3.5" />, group: "Money" },
  { key: "financial_alerts", emailKey: "email_financial_alerts", label: "Payouts and tips", description: "Money held for a job, payout setup, payouts and tips.", icon: <DollarSign className="w-3.5 h-3.5" />, group: "Money" },
  { key: "reviews", emailKey: "email_reviews", label: "Reviews", icon: <Star className="w-3.5 h-3.5" />, group: "Account" },
  { key: "system_alerts", emailKey: "email_system_alerts", label: "Account and safety alerts", icon: <ShieldAlert className="w-3.5 h-3.5" />, group: "Account" },
  { key: "promotions", emailKey: "email_promotions", label: "Promotions", icon: <Megaphone className="w-3.5 h-3.5" />, group: "Account" },
];

// ── The "Declutter" group (owner 2026-10-28, via the lead: "Yes, build them") ──
// One row per declutter_* notification type (20261028162048). Shown only while
// Declutter is on for the member; Wanted matches too, as it also governs saved Declutter searches (Q2464).
// Labels are one or two short words, inside the 375px budget described above.
// H1 (Declutter buy audit 11-08, 20261108202546): Offers, Buying & selling, Pickups and Refunds notices are emailed
// too (trg_email_declutter_notice), so those rows have a real Email switch. Listings and Questions send no notice
// email, so they show a dash in the Email column rather than a switch that does nothing. (A Declutter refund's receipt email, declutter-money's
// tellBuyerRefunded, is a receipt and always goes; the Refunds dash says so. So do the seller's
// "You sold" and "Your payout is on its way", _shared/declutterSellerEmail.ts; the Sales dash says so,
// NIGHT-SET-Declutterse-3.)
const NO_EMAIL = "In the app only, no email for this";
// A3-103 (audit 11-01): each row says what it sends, read from the senders' titles (migrations and functions). The
// buyer's "Reserved: check out within 30 minutes" / "Reserved for you: check out in 24 hours" is a declutter_sales notice
// (20261101030040), so that row is named for both sides ("Buying & selling", was "Sales"): a buyer no longer turns it
// off thinking it is the seller's. No buyer-only category exists; splitting one out would be a new preference column
// (SQL), not done here.
export const declutterRows: Row[] = [
  { key: "declutter_listings", emailKey: "email_declutter_listings", label: "Listings", description: "When a listing waits for a check or is taken down.", icon: <Tag className="w-3.5 h-3.5" />, noEmailSwitch: NO_EMAIL },
  { key: "declutter_offers", emailKey: "email_declutter_offers", label: "Offers", description: "Offers and counteroffers, asks for your free items, and changes to items you offered on.", icon: <HandCoins className="w-3.5 h-3.5" /> },
  { key: "declutter_questions", emailKey: "email_declutter_questions", label: "Questions", description: "Questions on your listings, and sellers' answers to yours.", icon: <MessageCircleQuestion className="w-3.5 h-3.5" />, noEmailSwitch: NO_EMAIL },
  { key: "declutter_sales", emailKey: "email_declutter_sales", label: "Buying & selling", description: "Both sides: checkout deadlines when you buy, items sold and order messages. Sale and payout receipts are always emailed.", icon: <ShoppingBag className="w-3.5 h-3.5" /> },
  { key: "declutter_pickups", emailKey: "email_declutter_pickups", label: "Pickups", description: "Pickup and delivery times, reminders and updates.", icon: <CalendarClock className="w-3.5 h-3.5" /> },
  { key: "declutter_refunds", emailKey: "email_declutter_refunds", label: "Refunds", description: "Refund requests, reported problems and strikes. Refund receipts are always emailed.", icon: <Undo2 className="w-3.5 h-3.5" /> },
  { key: "declutter_price_drops", emailKey: "email_declutter_price_drops", label: "Price drops", description: "An item you watch got cheaper or free.", icon: <TrendingDown className="w-3.5 h-3.5" /> },
  { key: "declutter_wanted", emailKey: "email_declutter_wanted", label: "Wanted matches", description: "Your Wanted posts and saved Declutter searches.", icon: <Search className="w-3.5 h-3.5" /> },
];

// ── The "Member activity" group, admins only (owner 11-12, 20261112061000) ──
// The admin bell's notice for every real member activity (listings, offers, sales, jobs, Shops orders). Always in the
// bell; push and email are OFF until the admin turns them on (they would be one push or email per activity).
export const adminActivityRows: Row[] = [
  { key: "admin_activity", emailKey: "email_admin_activity", label: "Member activity", description: "Listings, offers, sales, jobs and Shops orders by members. Always in the bell; push and email are off unless you turn them on.", icon: <Info className="w-3.5 h-3.5" /> },
];

// ── The "Shops" group (shops audit 11-08 #6, 20261108201153) ──
// One row per shops_* notification type, all ON by default. Until then every Shops notice rode a Jobs switch, so a
// shop owner who turned off "Job offers" lost new orders. Only orders send email (new order, accepted, ready, refunded,
// payout sent); messages and updates are in the app only.
export const shopsRows: Row[] = [
  { key: "shops_orders", emailKey: "email_shops_orders", label: "Orders", description: "New orders, accepts, ready and handovers, payments, refunds and custom orders.", icon: <Store className="w-3.5 h-3.5" /> },
  { key: "shops_messages", emailKey: "email_shops_messages", label: "Shop messages", description: "New messages in a shop chat.", icon: <MessageSquare className="w-3.5 h-3.5" />, noEmailSwitch: NO_EMAIL },
  { key: "shops_updates", emailKey: "email_shops_updates", label: "Shop updates", description: "Your shop's settings and Shops strikes.", icon: <Info className="w-3.5 h-3.5" />, noEmailSwitch: NO_EMAIL },
  { key: "shops_following", emailKey: "email_shops_following", label: "Shops you follow", description: "New items from shops you follow, at most one notice per shop a day.", icon: <Store className="w-3.5 h-3.5" />, noEmailSwitch: NO_EMAIL },
];
