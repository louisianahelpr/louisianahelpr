/**
 * Two small pieces of each report row in the Reports queue (split out of AdminReports.tsx, componentSizeRatchet,
 * batch 1030e): the SLA chip's words and tone, and the report type's icon.
 */
import { Briefcase, Clock, MessageSquare, User } from "lucide-react";
import { LISTING_REPORT } from "./reportedListings";
import { WANTED_REPORT } from "@/components/admin/adminReports/reportedWanted";

/** Trust & safety reports are triaged within this many hours. */
export const SLA_BREACH_HOURS = 24;

// SLA: trust & safety reports must be triaged within 24h. Visual
// indicator at >24h (yellow) and >48h (red) so the queue self-prioritizes.
export const slaInfo = (createdAt: string) => {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const hours = ageMs / 3600_000;
  // Past a couple of days, hours stop being a quantity anyone can read:
  // the queue was rendering "1431h overdue", which is ~60 days. Hours stay
  // for the range where they are still actionable.
  const overdue = (h: number) =>
    h >= 48 ? `${Math.floor(h / 24)}d overdue` : `${Math.floor(h)}h overdue`;
  if (hours > SLA_BREACH_HOURS * 2) return { label: overdue(hours), tone: "red" as const };
  if (hours > SLA_BREACH_HOURS) return { label: overdue(hours), tone: "yellow" as const };
  const hoursLeft = Math.max(0, SLA_BREACH_HOURS - hours);
  return { label: `${Math.ceil(hoursLeft)}h to SLA`, tone: "green" as const };
};

export const typeIcon = (type: string) => {
  if (type === "user") return <User className="w-4 h-4" />;
  if (type === "job" || type === "application" || type === LISTING_REPORT || type === WANTED_REPORT) return <Briefcase className="w-4 h-4" />;
  if (type === "review") return <Clock className="w-4 h-4" />;
  return <MessageSquare className="w-4 h-4" />;
};
