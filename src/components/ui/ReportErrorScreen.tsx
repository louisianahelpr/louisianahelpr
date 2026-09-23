import { useEffect } from "react";
import { report } from "@/lib/errorLogger";
import { currentScreen, USER_ERROR_SCREEN } from "@/lib/currentScreen";

/**
 * Renders nothing; reports that a person is looking at an error card.
 *
 * For the pane-level error cards that are drawn by hand instead of through
 * `<ErrorState>` (the chat thread, the applicants list, saved searches, the
 * notification panel). Drop it inside the error branch next to the card: it
 * reports once per mount with the same tags ErrorState sends, including
 * `kind: "user-error-screen"`, which is what turns a real person's error
 * screen into an ops alert ledger item (docs/OPEN.md Q39). Offline is not a
 * defect and is not reported, matching ErrorState and the boundaries.
 */
export function ReportErrorScreen({ source, title }: { source: string; title: string }) {
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    report(new Error(`Error screen shown: ${title}`), {
      severity: "warning",
      tags: { source, kind: USER_ERROR_SCREEN, screen: currentScreen(), title },
    });
  }, [source, title]);
  return null;
}
