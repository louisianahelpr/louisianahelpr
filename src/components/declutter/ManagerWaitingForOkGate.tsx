/**
 * Manager mode: the seller's "Waiting for your OK" list on Selling. Its code loads only while the declutter_manager
 * switch is on for her (a separate chunk; nothing for everyone else). Kept out of DeclutterHomeView, whose own
 * switches are read once (listArrivesInOneWave): this reads its own and paints nothing until it is on.
 */
import { lazy, Suspense } from "react";
import { useFeature } from "@/hooks/useFeature";

const ManagerWaitingForOk = lazy(() => import("./ManagerWaitingForOk"));

export function ManagerWaitingForOkGate({ userId }: { userId: string }) {
  const on = useFeature("declutter_manager");
  if (!on) return null;
  return <Suspense fallback={null}><ManagerWaitingForOk userId={userId} /></Suspense>;
}
