/**
 * LEAD-LIST-FOR-SELLER (owner 10-31 ~10:30 PM): the Helpr's "Add listing for <seller>" panel on a "Have a Helpr list
 * it" job. This thin mount is on every Helpr card's on-site and working steps; the panel itself
 * (ListForSellerPanelOpen) and the Declutter modules it needs load only on an open Have a Helpr list it job, so no other
 * card pays for them.
 */
import { lazy, Suspense } from "react";
import { isSellForMeJob } from "@/lib/declutter/sellForMe";
import type { PanelProps } from "./ListForSellerPanelOpen";

const ListForSellerPanelOpen = lazy(() => import("./ListForSellerPanelOpen"));

export function ListForSellerPanel(props: PanelProps) {
  if (!isSellForMeJob(props.job.category) || props.job.helper_completed_at) return null;
  return <Suspense fallback={null}><ListForSellerPanelOpen {...props} /></Suspense>;
}
