import type { AdminNavItem } from "@/components/admin/AdminSidebar";
import { BUSINESS_ENABLED } from "@/config/businessEnabled";
import {
  Activity,
  AlertTriangle,
  Award,
  Banknote,
  BarChart3,
  BellRing,
  Briefcase,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Crown,
  DollarSign,
  Gift,
  Headphones,
  Mail,
  Megaphone,
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
    items: [{ id: "analytics", label: "Analytics", icon: BarChart3 }],
  },
  {
    title: "Operations",
    items: [
      { id: "people", label: "Users", icon: Users },
      { id: "idv", label: "Identity Verify", icon: ShieldCheck },
      { id: "credentials", label: "License & Insurance", icon: ShieldCheck },
      { id: "exceptions", label: "Exception Queue", icon: ClipboardList },
      // Business Verification / Business Accounts are the admin half of the
      // Business product. They are spread in only while `BUSINESS_ENABLED` is
      // true, because with the product hidden they are two dead sidebar rows
      // naming a feature no user can reach — a verification queue for
      // businesses nobody can create, and an accounts list that can only ever
      // be empty. `?view=business_verify` also falls through to the dashboard
      // home rather than rendering the queue (see `renderContent`).
      ...(BUSINESS_ENABLED
        ? ([
            { id: "business_verify", label: "Business Verification", icon: Building2 },
            { id: "business_accounts", label: "Business Accounts", icon: Building2 },
          ] as AdminNavItem[])
        : []),
      { id: "jobs", label: "Jobs", icon: Briefcase },
      { id: "fraud", label: "Fraud", icon: ShieldAlert },
      { id: "disputes", label: "Disputes", icon: ShieldAlert },
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
      { id: "audit", label: "Audit Log", icon: ClipboardCheck },
      { id: "health", label: "Health", icon: Activity },
      { id: "export", label: "Export", icon: DollarSign },
    ],
  },
];


/** Flat list, for consumers that don't want the grouping. */
export const adminNavItems: AdminNavItem[] = adminNavGroups.flatMap((g) => g.items);
