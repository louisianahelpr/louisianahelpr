import {
  Briefcase, MessageSquare, DollarSign, Star, Megaphone,
  Navigation, CheckCircle2,
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
export const rows: Row[] = [
  { key: "new_offers", emailKey: "email_new_offers", label: "Job Offers", icon: <Briefcase className="w-3.5 h-3.5" /> },
  { key: "messages", emailKey: "email_messages", label: "Messages", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { key: "transit_updates", emailKey: "email_transit_updates", label: "Transit Updates", icon: <Navigation className="w-3.5 h-3.5" /> },
  { key: "work_status", emailKey: "email_work_status", label: "Work Status", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  { key: "financial_alerts", emailKey: "email_financial_alerts", label: "Payments & Tips", icon: <DollarSign className="w-3.5 h-3.5" /> },
  { key: "reviews", emailKey: "email_reviews", label: "Reviews", icon: <Star className="w-3.5 h-3.5" /> },
  { key: "promotions", emailKey: "email_promotions", label: "Promotions", icon: <Megaphone className="w-3.5 h-3.5" /> },
];
