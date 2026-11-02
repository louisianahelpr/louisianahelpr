/** The seller's sale split line (ManagerSaleShare), loaded only while declutter_manager is on: a separate chunk. */
import { lazy, Suspense } from "react";
import { useFeature } from "@/hooks/useFeature";

const ManagerSaleShare = lazy(() => import("./ManagerSaleShare"));

export function ManagerSaleShareGate(props: { orderId: string; itemsCents: number; itemCount: number }) {
  const on = useFeature("declutter_manager");
  if (!on) return null;
  return <Suspense fallback={null}><ManagerSaleShare {...props} /></Suspense>;
}
