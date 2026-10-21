import { createContext, useContext, type ReactNode } from "react";
import { useFeature } from "@/hooks/useFeature";

/**
 * Board 141 (Q2272): whether refund requests are open to this viewer, read
 * ONCE around the job lists (JobsSection, around JobListPage) and handed to
 * every card below them.
 *
 * A context, not a useFeature call per card: the job cards render in many
 * places with no signed-in session or query cache around them (their own
 * tests, previews), and a card that reads a switch itself would need both.
 * Off by default, so anything rendered outside the lists shows no refund
 * control at all; the server refuses every refund RPC without the switch
 * anyway (require_feature).
 */
export const RefundsOnContext = createContext(false);

export function RefundsSwitchProvider({ children }: { children: ReactNode }) {
  const on = useFeature("refund_requests");
  return <RefundsOnContext.Provider value={on}>{children}</RefundsOnContext.Provider>;
}

export function useRefundsOn(): boolean {
  return useContext(RefundsOnContext);
}
