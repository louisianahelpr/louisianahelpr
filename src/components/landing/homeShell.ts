/**
 * Q2705 B: index.html's signed-in /home skeleton (#lh-home-shell) is a fixed overlay over the booting app. Anything
 * that ends up on screen at /home other than HomeDashboard (a route or app error card, ProtectedRoute's account
 * error card or the under-13 screen) calls this, so the bones never sit over it for the 10 s cap. Plain DOM, no React,
 * so the error boundaries can import it. Guard: src/test/homeShellMatchesSkeleton.test.tsx.
 */
export const HOME_SHELL_ID = "lh-home-shell";

export function dropHomeShell(doc: Document = document): void {
  doc.getElementById(HOME_SHELL_ID)?.remove();
}
