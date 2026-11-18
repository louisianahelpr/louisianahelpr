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

/** The queue names as the admin rail shows them (adminNavGroups), lower-cased into the attention line. */
const QUEUE_NAME: Record<(typeof ADMIN_QUEUE_IDS)[number], string> = {
  idvreview: "Identity review",
  credentials: "License & insurance",
  exceptions: "Exception queue",
  stalled: "Stuck jobs",
  fraud: "Fraud",
  banreview: "Ban review",
  disputes: "Disputes",
  reports: "Reports",
  support: "Support",
};

/**
 * Design audit r2 #47: the greeting said "There are items needing attention today." and named nothing. This names what
 * is waiting, from the same numbers homeStanding reads: "10 health alerts, 2 in Identity review need a look." Null when
 * nothing is open (the standing line then says calm or still checking).
 */
export function attentionLine(queues: PendingCounts, seriousAlerts: number | undefined): string | null {
  const parts: string[] = [];
  if ((seriousAlerts ?? 0) > 0) parts.push(`${seriousAlerts} health ${seriousAlerts === 1 ? "alert" : "alerts"}`);
  for (const id of ADMIN_QUEUE_IDS) {
    const n = queues[id] ?? 0;
    if (n > 0) parts.push(`${n} in ${QUEUE_NAME[id]}`);
  }
  if (parts.length === 0) return null;
  return `${parts.join(", ")} ${parts.length === 1 && parts[0].startsWith("1 ") ? "needs" : "need"} a look.`;
}
