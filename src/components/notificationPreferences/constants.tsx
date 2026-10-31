import {
  Briefcase, MessageSquare, DollarSign, Star, Megaphone,
  Navigation, CheckCircle2, Users, RefreshCw, Receipt, ShieldAlert, Sparkles,
  Tag, HandCoins, MessageCircleQuestion, ShoppingBag, CalendarClock, Undo2, TrendingDown, Search,
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
// "Payout sent!" and tips. So each row's description says what it covers,
// overlap included, because neither label can.
export const rows: Row[] = [
  { key: "new_offers", emailKey: "email_new_offers", label: "Job offers", icon: <Briefcase className="w-3.5 h-3.5" /> },
  { key: "job_applications", emailKey: "email_job_applications", label: "Applications", icon: <Users className="w-3.5 h-3.5" /> },
  { key: "job_updates", emailKey: "email_job_updates", label: "Job updates", icon: <RefreshCw className="w-3.5 h-3.5" /> },
  // The Daily Match Digest row renders directly beneath this one (see
  // NotificationPreferences.tsx) — it is a delivery mode FOR this category,
  // and it greys out when this switch is off.
  { key: "job_matches", emailKey: "email_job_matches", label: "New matches", icon: <Sparkles className="w-3.5 h-3.5" /> },
  { key: "messages", emailKey: "email_messages", label: "Messages", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { key: "transit_updates", emailKey: "email_transit_updates", label: "Helpr on the way", icon: <Navigation className="w-3.5 h-3.5" /> },
  { key: "work_status", emailKey: "email_work_status", label: "Work status", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  { key: "payments", emailKey: "email_payments", label: "Job payments", description: "Finished jobs, refunds and saved cards. Some payouts and tips too.", icon: <Receipt className="w-3.5 h-3.5" /> },
  { key: "financial_alerts", emailKey: "email_financial_alerts", label: "Payments and tips", description: "Money held for a job, payout setup, payouts and tips.", icon: <DollarSign className="w-3.5 h-3.5" /> },
  { key: "reviews", emailKey: "email_reviews", label: "Reviews", icon: <Star className="w-3.5 h-3.5" /> },
  { key: "system_alerts", emailKey: "email_system_alerts", label: "System alerts", icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  { key: "promotions", emailKey: "email_promotions", label: "Promotions", icon: <Megaphone className="w-3.5 h-3.5" /> },
];

// ── The "Declutter" group (owner 2026-10-28, via the lead: "Yes, build them") ──
// One row per declutter_* notification type (20261028162048). Shown only while
// Declutter is on for the member; Wanted matches only while Wanted is.
// Labels are one or two short words, inside the 375px budget described above.
// Pickups, price drops and Wanted matches are the only kinds that send a notice
// email, so the other rows show a dash in the Email column rather than a switch that does
// nothing. (A Declutter refund's receipt email, declutter-money's
// tellBuyerRefunded, is a receipt and always goes; the Refunds dash says so. So do the seller's
// "You sold" and "Your payout is on its way", _shared/declutterSellerEmail.ts; the Sales dash says so,
// NIGHT-SET-Declutterse-3.)
const NO_EMAIL = "In the app only, no email for this";
export const declutterRows: Row[] = [
  { key: "declutter_listings", emailKey: "email_declutter_listings", label: "Listings", icon: <Tag className="w-3.5 h-3.5" />, noEmailSwitch: NO_EMAIL },
  { key: "declutter_offers", emailKey: "email_declutter_offers", label: "Offers", icon: <HandCoins className="w-3.5 h-3.5" />, noEmailSwitch: NO_EMAIL },
  { key: "declutter_questions", emailKey: "email_declutter_questions", label: "Questions", icon: <MessageCircleQuestion className="w-3.5 h-3.5" />, noEmailSwitch: NO_EMAIL },
  { key: "declutter_sales", emailKey: "email_declutter_sales", label: "Sales", icon: <ShoppingBag className="w-3.5 h-3.5" />, noEmailSwitch: "Sale and payout receipts are always emailed" },
  { key: "declutter_pickups", emailKey: "email_declutter_pickups", label: "Pickups", icon: <CalendarClock className="w-3.5 h-3.5" /> },
  { key: "declutter_refunds", emailKey: "email_declutter_refunds", label: "Refunds", icon: <Undo2 className="w-3.5 h-3.5" />, noEmailSwitch: "Refund receipts are always emailed" },
  { key: "declutter_price_drops", emailKey: "email_declutter_price_drops", label: "Price drops", icon: <TrendingDown className="w-3.5 h-3.5" /> },
  { key: "declutter_wanted", emailKey: "email_declutter_wanted", label: "Wanted matches", icon: <Search className="w-3.5 h-3.5" /> },
];
