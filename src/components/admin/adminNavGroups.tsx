import type { AdminNavItem } from "@/components/admin/AdminSidebar";
import {
  Activity,
  AlertTriangle,
  Award,
  Banknote,
  BarChart3,
  BellRing,
  Briefcase,
  ClipboardCheck,
  ClipboardList,
  Crown,
  Download,
  FileCheck,
  Gavel,
  Gift,
  Headphones,
  LayoutDashboard,
  Mail,
  Megaphone,
  Scale,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";

/**
 * THE admin section list — one definition, two consumers.
 *
 * It lived inside Admin.tsx, which was fine while the page owned the only rail
 * that rendered it. The side panel now shows the same sections nested under
 * "Admin" (owner: "the side panel should be identical to a non-admin user,
 * just add the admin sections under the Admin in the sidebar"), so a second
 * copy would be two lists drifting apart — a section added to one and missing
 * from the other, which is the defect class this codebase keeps hitting.
 *
 * Every `id` is a `?view=` value that /admin already deep-links on, so the side
 * panel links straight to `/admin?view=<id>` with no new routing.
 */
export const adminNavGroups: { title: string; items: AdminNavItem[] }[] = [
  {
    title: "Overview",
    items: [
      // "home" is already a real view (VIEW_LABELS.home === "Dashboard") and is
      // where every section's back arrow lands, but it had no rail row — so the
      // console's landing screen was the one screen you could not navigate TO,
      // only back to. Listing it makes the rail a complete map of the console.
      { id: "home", label: "Dashboard", icon: LayoutDashboard },
      { id: "analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Directory",
    items: [
      { id: "people", label: "Users", icon: Users },
      { id: "jobs", label: "Jobs", icon: Briefcase },
    ],
  },
  {
    // The review queues, together. These are the recurring daily shift —
    // someone is waiting on a decision in each — so they earn their own heading
    // rather than being rows lost inside a nine-row "Operations" list.
    //
    // "Identity Verify" was removed 2026-08-27 because it listed EVERY ID
    // upload and offered a manual approve on a review nobody performed —
    // a human stamp with no human behind it, feeding a badge strangers trust.
    //
    // "Identity Review" (2026-08-29) is not that screen coming back. It lists
    // only `manual_review` and `failed` — people Stripe BILLED for their one
    // attempt and could not verify — and exists because 2f650f35 stopped
    // making that outcome a permanent posting ban. Stripe still owns the pass;
    // this owns the appeal, and its approvals are badged "Admin Verified".
    title: "Queues",
    items: [
      { id: "idvreview", label: "Identity Review", icon: ShieldCheck },
      { id: "credentials", label: "License & Insurance", icon: FileCheck },
      { id: "exceptions", label: "Exception Queue", icon: ClipboardList },
    ],
  },
  {
    // Everything where a human is unhappy and someone must adjudicate.
    title: "Trust & Safety",
    items: [
      { id: "fraud", label: "Fraud", icon: ShieldAlert },
      { id: "banreview", label: "Ban Review", icon: Gavel },
      { id: "disputes", label: "Disputes", icon: Scale },
      { id: "reports", label: "Reports", icon: AlertTriangle },
      { id: "support", label: "Support", icon: Headphones },
    ],
  },
  {
    title: "Revenue",
    items: [
      { id: "subscriptions", label: "Subscriptions", icon: Crown },
      { id: "referrals", label: "Referrals", icon: Gift },
      { id: "payouts", label: "Payout Batches", icon: Banknote },
      { id: "tiers", label: "Helpr Tiers", icon: Award },
    ],
  },
  {
    title: "Engagement",
    items: [
      { id: "broadcasts", label: "Broadcasts", icon: Megaphone },
      { id: "notifications", label: "Notifications", icon: BellRing },
      { id: "notiflogs", label: "Notification Logs", icon: ClipboardCheck },
      { id: "marketing", label: "Marketing", icon: Mail },
    ],
  },
  {
    title: "System",
    items: [
      { id: "settings", label: "Settings", icon: Settings },
      { id: "audit", label: "Audit Log", icon: ScrollText },
      { id: "health", label: "Health", icon: Activity },
      { id: "export", label: "Export", icon: Download },
    ],
  },
];
