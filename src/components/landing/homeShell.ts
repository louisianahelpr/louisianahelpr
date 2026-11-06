/**
 * Q2705 B: index.html's signed-in /home skeleton (#lh-home-shell) is a fixed overlay over the booting app. Anything
 * that ends up on screen at /home other than HomeDashboard (a route or app error card, ProtectedRoute's account
 * error card or the under-13 screen) calls this, so the bones never sit over it for the 10 s cap. Plain DOM, no React,
 * so the error boundaries can import it. Guard: src/test/homeShellMatchesSkeleton.test.tsx.
 */
export const HOME_SHELL_ID = "lh-home-shell";
/** Q2705 B: the signed-in /jobs skeleton (#lh-jobs-shell). dropHomeShell takes it away too (every error card). */
export const JOBS_SHELL_ID = "lh-jobs-shell";

/** Q2705 B: the signed-in /messages and /declutter skeletons (#lh-messages-shell, #lh-declutter-shell). */
export const MESSAGES_SHELL_ID = "lh-messages-shell";
export const DECLUTTER_SHELL_ID = "lh-declutter-shell";

export function dropHomeShell(doc: Document = document): void {
  doc.getElementById(HOME_SHELL_ID)?.remove();
  dropJobsShell(doc);
  doc.getElementById(MESSAGES_SHELL_ID)?.remove();
  doc.getElementById(DECLUTTER_SHELL_ID)?.remove();
}

export function dropJobsShell(doc: Document = document): void {
  doc.getElementById(JOBS_SHELL_ID)?.remove();
}
