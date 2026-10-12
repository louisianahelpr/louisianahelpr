import { CalendarDays, Clock, Heart, ShieldCheck, Home, Gift } from "lucide-react";
import type { MenuItem } from "./types";

/**
 * ONE TINT PER SECTION.
 *
 * These were assigned ad hoc: 21 rows across 6 tints with no rule, so Schedule
 * was sienna while Availability directly beneath it was sage, and Gift Card
 * carried a raw `155 50% 30%` literal instead of a brand token — which the
 * project's own guidance forbids. The owner spotted it: "Why are some the same
 * colors and some do not match???" There was no answer, because there was no
 * rule.
 *
 * Now the tint carries information: it tells you which group a row belongs to.
 * Warnings & Strikes stays destructive-red — the one deliberate
 * exception, because "this is a penalty surface" outranks "this is the Legal
 * group".
 */
export const SECTION_TINT = {
  /** Account + household. Cool blue-grey — the "about you" group. */
  account: "var(--stormy-sky)",
  /** Work + credentials. Warm sienna. */
  work: "var(--burnt-sienna)",
  /** Money. Green, the colour money already reads as. */
  money: "var(--sage)",
  /** Legal, support, admin. Quiet grey-blue — REVERSED 2026-08-24 (owner):
   *  the whole group in red made Help & Support read like an emergency and
   *  spent the alarm colour on rows that carry none. Red now belongs to
   *  Warnings & Strikes alone. */
  legal: "var(--stormy-sky)",
  /** Warnings & Strikes only — the one genuinely consequential row. */
  danger: "var(--destructive)",
} as const;

/**
 * The landing's first settings group, "Work". Every row is fixed: no profile
 * field, role or tier changes a label, description or target. That is why it
 * lives here, outside useProfileLandingDerived: the landing's loading
 * skeleton (ProfilePageSkeleton) draws these exact rows as its first frame,
 * so a cold /profile paints real words before the profile row arrives
 * (Q1173, the owner's data-aware skeleton rule, Q722). A row that ever comes
 * to depend on data must move back into the hook, or the skeleton would show
 * a guess.
 */
export const WORK_MENU_GROUP: { title: string; items: MenuItem[] } = {
  title: "Work",
  items: [
    // Two rows, not one. These used to be a single "Schedule" row opening
    // a screen with a Calendar|Hours segmented control — a second choice
    // after the one you just made. Split on owner request 2026-08-19.
    { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-5 h-5" />, desc: "Your calendar & upcoming jobs", tint: SECTION_TINT.work },
    { key: "availability", label: "Availability", icon: <Clock className="w-5 h-5" />, desc: "Weekly hours & the available-now signal", tint: SECTION_TINT.work },
    { key: "saved_helpers", label: "Saved Helprs", icon: <Heart className="w-5 h-5" />, desc: "Rebook favorites with a direct offer", tint: SECTION_TINT.work },
    {
      key: "credentials",
      label: "Licensed & Insured",
      icon: <ShieldCheck className="w-5 h-5" />,
      desc: "Add your license and insurance",
      tint: SECTION_TINT.work,
    },
    {
      key: "str-settings",
      label: "Host Automation",
      icon: <Home className="w-5 h-5" />,
      desc: "Auto-post cleanings on Airbnb / VRBO checkout",
      tint: SECTION_TINT.work,
      href: "/profile?tab=str_settings",
    },
    {
      key: "gift-card",
      label: "Gift Card",
      icon: <Gift className="w-5 h-5" />,
      // Not "job credits" (owner, 2026-08-30) — there is no credit balance
      // in this product. It sends a real Helpr gift card by email that the
      // recipient claims and puts toward any job.
      desc: "Send a Helpr gift card by email",
      tint: SECTION_TINT.work,
      // A TAB, like every sibling in this list (2026-09-11).
      href: "/profile?tab=gift_card",
    },
    // "Benefits & Perks" (/benefits) removed 2026-08-31 (owner): the page
    // it opened had no partner agreements behind it, so the row promised
    // "health coverage, financial tools & supply discounts" that Helpr
    // never actually offered. Page and route deleted; the row goes with
    // them rather than becoming a dead entry point.
  ],
};
