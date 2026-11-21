/**
 * Selling boost (owner 2026-11-20): Browse's "New this week" row is its own chunk, off Browse's critical path (Q178).
 * It starts downloading as Browse's own module graph runs, beside the list read, so it is in hand by the time the
 * cards paint. Kept out of DeclutterBrowseView.tsx so that file stays under the component-size threshold.
 * Guard: src/test/declutterSellingBoost.test.tsx.
 */
import { lazy } from "react";
import { loadModule } from "@/lib/loadModule";

export const DeclutterNewThisWeek = lazy(() => import("./DeclutterNewThisWeek"));
if (typeof window !== "undefined") {
  // loadModule (dynamicImportThenDoesNoWork): the early start does no work on the module, it only warms the chunk.
  void loadModule(() => import("./DeclutterNewThisWeek")).catch(() => {
    // A failed early start costs nothing: lazy() asks for the chunk again when the row renders.
  });
}
