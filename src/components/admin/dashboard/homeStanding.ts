import { ADMIN_QUEUE_IDS, type PendingCounts } from "@/components/admin/adminRailBadges";

/**
 * What the admin home may say about the platform.
 *
 * "Calm" is a claim, so it needs every number behind it to be read and zero: the
 * home said "Everything looks calm" on 2026-10-30 while 4 critical and 84 error ledger items
 * were open (measured 10-30), because it asked only three of the nine queues and
 * never the ledger. Anything still loading or unreadable is `unknown`, not calm.
 */
export type HomeStanding = "attention" | "calm" | "unknown";

export function homeStanding(input: {
  queues: PendingCounts;
  /** Open serious ledger items; undefined while loading or unreadable. */
  seriousAlerts: number | undefined;
  dataError: boolean;
}): HomeStanding {
  const counts = [...ADMIN_QUEUE_IDS.map((id) => input.queues[id]), input.seriousAlerts];
  if (counts.some((n) => (n ?? 0) > 0)) return "attention";
  if (input.dataError || counts.some((n) => n === undefined)) return "unknown";
  return "calm";
}

export const HOME_STANDING_LINE: Record<HomeStanding, string> = {
  attention: "There are items needing attention today.",
  calm: "Everything looks calm on the platform.",
  unknown: "Still checking what needs you.",
};
