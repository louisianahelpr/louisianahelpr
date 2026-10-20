import { BadgeCheck, CalendarDays, ClipboardList, Clock, Coins, FileText, Heart, Home, PawPrint } from "lucide-react";
import type { MenuItem } from "./types";
import { SECTION_TINT } from "./workMenuGroup";
import { TAB_TITLES } from "@/pages/profile/types";

/**
 * JOBS SETTINGS (owner standing rule, 2026-10-19: "anything belonging to a
 * section lives in that section, not in Profile"; lead decision option A).
 * These rows used to be Profile's "Work" group and a few of its Money and
 * Account rows; they are Jobs things, so they live at /jobs/settings, reached
 * from the foot of Jobs > Posted and Jobs > Working. Each row still opens its
 * existing /profile?tab= page, so every old link keeps working.
 *
 * Static on purpose: no profile field changes a row, so the page paints whole.
 */
export const JOBS_SETTINGS_GROUPS: { title: string; items: MenuItem[] }[] = [
  {
    title: "When you post",
    items: [
      { key: "saved_helpers", label: "Saved Helprs", icon: <Heart className="w-5 h-5" />, desc: "Rebook favorites with a direct offer", tint: SECTION_TINT.work, href: "/profile?tab=saved_helpers" },
      { key: "auto-tip", label: "After a job", icon: <Coins className="w-5 h-5" />, desc: "Automatic tips & instant payment release", tint: SECTION_TINT.work, href: "/profile?tab=auto_tip" },
      { key: "str-settings", label: "Host Automation", icon: <Home className="w-5 h-5" />, desc: "Auto-post cleanings on Airbnb / VRBO checkout", tint: SECTION_TINT.work, href: "/profile?tab=str_settings" },
      { key: "pets", label: "My Pets", icon: <PawPrint className="w-5 h-5" />, desc: "Pet profiles & vet notes", tint: SECTION_TINT.work, href: "/profile?tab=pets" },
      { key: "home-history", label: "Home History", icon: <ClipboardList className="w-5 h-5" />, desc: "Your home's permanent maintenance record", tint: SECTION_TINT.work, href: "/profile?tab=home_history" },
    ],
  },
  {
    title: "When you work",
    items: [
      { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-5 h-5" />, desc: "Your calendar & upcoming jobs", tint: SECTION_TINT.work, href: "/profile?tab=schedule" },
      { key: "availability", label: "Availability", icon: <Clock className="w-5 h-5" />, desc: "Weekly hours & the available-now signal", tint: SECTION_TINT.work, href: "/profile?tab=availability" },
      // Q2200: the owner asked for Licensed & Insured in the Helpr's Jobs settings (it also stays in Shops > Shop settings).
      { key: "credentials", label: TAB_TITLES.credentials, icon: <BadgeCheck className="w-5 h-5" />, desc: "Licenses & insurance for licensed work", tint: SECTION_TINT.work, href: "/profile?tab=credentials" },
      { key: "work-record", label: "Work Record", icon: <FileText className="w-5 h-5" />, desc: "Shareable verified earnings document", tint: SECTION_TINT.work, href: "/profile?tab=work_record" },
    ],
  },
];
