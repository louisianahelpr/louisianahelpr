/**
 * Manager mode phase 3: the manager cards on Selling (grant setup, offer, Managed by, Managing). Its code loads only
 * while the declutter_manager switch is on for the viewer (a separate chunk; nothing for everyone else), like
 * ManagerWaitingForOkGate.
 */
import { lazy, Suspense } from "react";
import { useFeature } from "@/hooks/useFeature";

const ManagerPanel = lazy(() => import("./ManagerPanel"));

export function ManagerPanelGate() {
  const on = useFeature("declutter_manager");
  if (!on) return null;
  return <Suspense fallback={null}><ManagerPanel /></Suspense>;
}
