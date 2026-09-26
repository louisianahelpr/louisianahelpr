/**
 * Open a private document in a new tab from a click (docs/OPEN.md Q295).
 *
 * The admin credential queue's "Open" awaited createSignedUrl and only THEN
 * called window.open. WebKit (Safari, and the iOS app's WKWebView) drops the
 * click's user activation across that await and blocks the popup; with
 * "noopener" window.open returns null, so the block was invisible: no tab, no
 * toast ("no observable change", press run 35837735324).
 *
 * The tab is now opened SYNCHRONOUSLY inside the click, then pointed at the
 * signed URL once it exists, or closed with a toast if signing fails. A popup
 * refused outright says so instead of doing nothing.
 */
export type OpenDeps = {
  /** window.open */
  open: (url: string, target: string) => Window | null;
  /** Resolves the signed URL, or null when it could not be made. */
  sign: () => Promise<string | null>;
  toastError: (msg: string) => void;
};

export const POPUP_BLOCKED = "Your browser blocked the new tab. Allow pop-ups for this site and try again.";
export const SIGN_FAILED = "Couldn't generate a view link.";

/** Call from the click handler itself, before any await. */
export async function openSignedDocument(deps: OpenDeps): Promise<"opened" | "blocked" | "sign-failed"> {
  const tab = deps.open("", "_blank");
  if (!tab) {
    deps.toastError(POPUP_BLOCKED);
    return "blocked";
  }
  // The same isolation "noopener" gave: the document cannot reach this page.
  tab.opener = null;
  let url: string | null;
  try {
    url = await deps.sign();
  } catch {
    // Treated exactly like a null URL below: the tab closes and the admin is told.
    url = null;
  }
  if (!url) {
    tab.close();
    deps.toastError(SIGN_FAILED);
    return "sign-failed";
  }
  tab.location.href = url;
  return "opened";
}
