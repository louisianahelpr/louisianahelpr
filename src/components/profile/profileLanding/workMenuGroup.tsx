import { Bell, LayoutGrid, Shield, Type } from "lucide-react";
import type { MenuItem } from "./types";
import { TAB_TITLES } from "@/pages/profile/types";

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
  /** Jobs settings (the old Work group + credentials). Neutral, like Account:
   *  rust is for money only (audit #38, 2026-10-21; it was burnt-sienna). */
  work: "var(--stormy-sky)",
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
 * The landing's first settings group, "Account" (owner, 2026-10-19: Profile =
 * account, money, settings, help; the old "Work" rows moved to the Jobs
 * section's own settings, jobsSettingsGroups.tsx). Every row is fixed: no
 * profile field, role or tier changes a label, description or target. That is
 * why it lives here, outside useProfileLandingDerived: the landing's loading
 * skeleton (ProfilePageSkeleton) draws these exact rows as its first frame, so
 * a cold /profile paints real words before the profile row arrives (Q1173,
 * Q722). The one data-dependent mark, Account Security's "Verify phone" chip,
 * is added by the hook once the profile is in (a chip beside a label the
 * skeleton already drew, never a different row).
 */
export const ACCOUNT_MENU_GROUP: { title: string; items: MenuItem[] } = {
  title: "Account",
  items: [
    { key: "security", label: TAB_TITLES.security, icon: <Shield className="w-5 h-5" />, desc: "Email, password & login", tint: SECTION_TINT.account },
    { key: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" />, desc: "Choose what alerts you get", tint: SECTION_TINT.account },
    { key: "accessibility", label: "Accessibility", icon: <Type className="w-5 h-5" />, desc: "Color mode & bigger text", tint: SECTION_TINT.account },
    {
      key: "sections",
      label: "Your sections",
      icon: <LayoutGrid className="w-5 h-5" />,
      desc: "Show or hide Jobs, Declutter, Shops and Homes",
      tint: SECTION_TINT.account,
      href: "/home?customize=1",
    },
  ],
};
