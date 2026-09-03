import {
  Briefcase, MessageSquare, DollarSign, Star, Megaphone,
  Navigation, CheckCircle2, Users, RefreshCw, Receipt, ShieldAlert,
} from "lucide-react";
import type { Prefs, Row } from "./types";

export const defaultPrefs: Prefs = {
  job_applications: true, job_updates: true, messages: true, payments: true,
  reviews: true, promotions: true, system_alerts: true, push_enabled: true,
  email_job_applications: true, email_job_updates: true, email_messages: false,
  email_payments: true, email_reviews: true, email_promotions: false, email_system_alerts: true,
  new_offers: true, email_new_offers: true,
  transit_updates: true, email_transit_updates: false,
  work_status: true, email_work_status: true,
  financial_alerts: true, email_financial_alerts: true,
  match_digest_mode: false,
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
// measure under that at 14px/600. "Transit (On the Way / Arrived)" was 213px
// and truncated; every other label is a short Title Case pair well inside the
// budget ("Payments & Tips", the widest survivor, is 119px).
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
// On the two money rows: `payments` and `financial_alerts` are genuinely
// separate columns with separate types. `payment` (escrow held, released,
// refunded, cancellation fee) routes to `payments`; `financial_alerts` (tip
// received, payout sent, instant payout) routes to its own column. The labels
// have to carry that distinction because nothing else on the screen does.
export const rows: Row[] = [
  { key: "new_offers", emailKey: "email_new_offers", label: "Job Offers", icon: <Briefcase className="w-3.5 h-3.5" /> },
  { key: "job_applications", emailKey: "email_job_applications", label: "Applications", icon: <Users className="w-3.5 h-3.5" /> },
  { key: "job_updates", emailKey: "email_job_updates", label: "Job Updates", icon: <RefreshCw className="w-3.5 h-3.5" /> },
  { key: "messages", emailKey: "email_messages", label: "Messages", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { key: "transit_updates", emailKey: "email_transit_updates", label: "Transit Updates", icon: <Navigation className="w-3.5 h-3.5" /> },
  { key: "work_status", emailKey: "email_work_status", label: "Work Status", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  { key: "payments", emailKey: "email_payments", label: "Job Payments", icon: <Receipt className="w-3.5 h-3.5" /> },
  { key: "financial_alerts", emailKey: "email_financial_alerts", label: "Payments & Tips", icon: <DollarSign className="w-3.5 h-3.5" /> },
  { key: "reviews", emailKey: "email_reviews", label: "Reviews", icon: <Star className="w-3.5 h-3.5" /> },
  { key: "system_alerts", emailKey: "email_system_alerts", label: "System Alerts", icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  { key: "promotions", emailKey: "email_promotions", label: "Promotions", icon: <Megaphone className="w-3.5 h-3.5" /> },
];
