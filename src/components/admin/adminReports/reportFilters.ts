import { CheckCircle2, Clock, Search, type LucideIcon } from "lucide-react";
import type { ReportQueueFilter } from "@/components/admin/adminQueueKeys";

/**
 * The Reports screen's status pills, in order. Real Title Case labels, not CSS
 * `capitalize` over the status key (see AdminReports). Each pill shows how many
 * reports it lists (useFilterCounts, owner 2026-10-27).
 */
export const REPORT_FILTERS: {
  value: ReportQueueFilter;
  label: string;
  icon?: LucideIcon;
  /** The Dismissed icon is drawn dimmed (AdminReports applies it). */
  dim?: boolean;
}[] = [
  { value: "pending", label: "New", icon: Clock },
  { value: "investigating", label: "Investigating", icon: Search },
  { value: "resolved", label: "Resolved", icon: CheckCircle2 },
  { value: "dismissed", label: "Dismissed", icon: CheckCircle2, dim: true },
  { value: "all", label: "All" },
];
