import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A reading whose read has not answered yet (Q1287). useInstantQuery hands
 * back its fallback's zeros until then, and those painted as real numbers:
 * "0 sent", "0 unresolved", Job Activity all 0, on every cold load. A pending
 * reading is a placeholder bone, never the fallback. Guard:
 * src/components/admin/AdminHealth.coldLoad.test.tsx.
 */
export const Reading = ({ pending, bone, children }: { pending: boolean; bone: string; children: ReactNode }) =>
  pending ? <Skeleton data-pending-reading="" aria-hidden="true" className={bone} /> : <>{children}</>;
