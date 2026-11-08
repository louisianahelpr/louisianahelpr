import type { LastActiveLabel } from "./types";
import { activeBandLabel, type ActiveBand } from "@/lib/activeBand";

// Active-cohort label (#5): "Active today" / "Active this week", from the
// server's coarse band (get_user_last_active, 20261108001932), which never
// sends a sign-in time, so a viewer can't pattern-match someone's routine.
// "today" wears the olive presence dot; "this week" is muted olivewood.
// Null (no line) when the server gave no band: no sign-in in 7 days, or a
// blocked, suspended or hidden test user.
export function computeLastActiveLabel(band: ActiveBand | null): LastActiveLabel | null {
  const text = activeBandLabel(band);
  return text ? { text, isLive: band === "today" } : null;
}
