import { toast } from "sonner";
import { isNativePlatform } from "@/lib/nativeInit";
import { report } from "@/lib/errorLogger";

export interface ShareContent {
  title?: string;
  text: string;
  /**
   * OPTIONAL, and that is the point.
   *
   * `url` used to be required, so every caller had to supply one whether or not
   * a URL existed for the thing being shared. /work-record had none — there is
   * no public record route — so it passed the marketing homepage, and iOS did
   * what iOS does when handed both a URL and text: it rendered the link preview
   * for louisianahelpr.com and buried the summary. The owner's report was "just
   * shared the website not their work history."
   *
   * Omit it when there is nothing real to link to. A share with no URL sends
   * the text, which is at least about the sharer; a share with a filler URL
   * sends the filler.
   */
  url?: string;
  /** Title shown on the native Android share chooser. */
  dialogTitle?: string;
  /** Combined text+url used for the clipboard fallback. */
  clipboardText?: string;
  /**
   * Set when the CALLER renders its own clipboard confirmation, so the two do
   * not stack. `ShareJobButton` flips its label to "Copied" inline; without
   * this it would also get the "Link copied" toast and confirm one copy twice.
   *
   * Only the clipboard-success confirmation is suppressed. The last-ditch
   * "Copy this link" toast and the hard-error toast still fire, because a
   * caller opting out of a *success* confirmation has not thereby taken
   * responsibility for reporting failure — and a share that fails silently is
   * the defect this whole module exists to prevent.
   */
  suppressCopyConfirmation?: boolean;
}

/** Outcome of `shareFileNative`, so the caller can give the right feedback
 *  instead of guessing which branch ran. */
export type ShareFileOutcome = "shared" | "downloaded" | "cancelled" | "failed";

/**
 * Outcome of `shareNative`, for the same reason `ShareFileOutcome` exists: the
 * caller cannot otherwise tell which rung of the ladder ran.
 *
 * This is what lets a caller converge onto `shareNative` WITHOUT losing an
 * inline confirmation. `ShareJobButton` kept its own duplicate share ladder
 * for exactly one reason — it flips its own label to "Copied" because
 * `src/lib/toastPolicy.ts` suppresses confirmation toasts app-wide — and with
 * no return value there was no way to do that on top of a shared helper. Now
 * there is, so there is one implementation of the ladder instead of three.
 *
 *  - `shared`    — the OS sheet (or Web Share API) accepted the payload.
 *  - `copied`    — no sheet available; the text landed on the clipboard.
 *  - `surfaced`  — no sheet AND no clipboard; the text was shown to the user
 *                  to copy by hand. The action produced something, but the
 *                  caller should not claim a copy happened.
 *  - `cancelled` — the user dismissed the sheet. Say nothing.
 *  - `failed`    — nothing worked; `shareNative` has already toasted an error.
 */
export type ShareOutcome = "shared" | "copied" | "surfaced" | "cancelled" | "failed";

/**
 * Confirm a clipboard fallback in a channel the user can actually perceive.
 *
 * NOT `toast.success`. `src/lib/toastPolicy.ts` runs at boot (`main.tsx`) and
 * replaces `toast.success` / `.info` / `.message` with no-ops unless the
 * payload carries an `action`. This file used to confirm the clipboard tier
 * with `toast.success("Link copied")` and its own comment claimed that fixed
 * the "share does nothing" report — it did not. The copy landed and NOTHING
 * rendered, on exactly the surface the bug was reported from (desktop Safari /
 * macOS Chrome, which have no `navigator.share`, so they ALWAYS take this
 * rung). A confirmation written into a suppressed channel is indistinguishable
 * from no confirmation at all.
 *
 * The bare `toast(...)` callable is a different function object; `applyToastPolicy`
 * only reassigns the `.success`/`.info`/`.message` PROPERTIES, so this one
 * renders. The last-ditch tier below already relied on that.
 */
function confirmCopied(hasUrl: boolean, suppress?: boolean): void {
  if (suppress) return;
  toast(hasUrl ? "Link copied" : "Summary copied", {
    description: "Paste it anywhere to share.",
  });
}

export interface ShareFileContent {
  /** File name WITH its extension — iOS resolves the sheet's handlers (and
   *  therefore "Save to Files", Mail, Messages) from the extension's UTI. */
  fileName: string;
  /** Base64 payload, no `data:` prefix — what Filesystem.writeFile takes. */
  base64: string;
  /** The same bytes for the web download branch. */
  blob: Blob;
  /** Sheet subject on iOS / chooser title on Android. Not an activity item. */
  title?: string;
  dialogTitle?: string;
  /** Tag used for error telemetry, e.g. "workRecord". */
  source: string;
  /**
   * Set when the CALLER states the download in its own words, so the two do
   * not stack. `/work-record` does this — "Work record saved · <file> — attach
   * or print it" is worth more on that screen than the generic line below.
   *
   * Same contract as `suppressCopyConfirmation`: it silences the SUCCESS
   * confirmation only. Every failure toast still fires, because opting out of
   * saying "it worked" is not taking responsibility for saying "it didn't".
   */
  suppressDownloadConfirmation?: boolean;
}

/**
 * Tiered share with a native-first chain so the affordance works on
 * every surface the app ships to:
 *
 *  1. Capacitor native (@capacitor/share) — the OS Share Sheet on
 *     iOS/Android (AirDrop, Messages, Mail, Instagram DM, …).
 *  2. Web Share API (navigator.share) — modern mobile browsers.
 *  3. Clipboard — copy the link + toast a hint.
 *  4. Last-ditch toast of the link/summary itself.
 *
 * User-cancellation of the sheet throws an AbortError on both the Web
 * Share API and the Capacitor bridge — that's a normal "no thanks," not
 * a failure, so it's swallowed silently.
 *
 * Dynamic import keeps the plugin chunk off the web critical-path bundle.
 */
/**
 * Copy `text` to the clipboard, returning whether it actually landed.
 *
 * Two rungs: the async Clipboard API, then the legacy `execCommand("copy")`
 * off a detached textarea — still the only clipboard available in some
 * embedded WebViews (including the Capacitor WKWebView, which can reject
 * `navigator.clipboard.writeText` outside a live user gesture or when the
 * clipboard-write permission hasn't been granted) and on insecure origins,
 * where `navigator.clipboard` is undefined entirely. Returning a boolean
 * (rather than throwing) is what lets the caller distinguish "copied" from
 * "could not copy" and show the right thing instead of assuming success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the execCommand fallback below — some WebViews
      // expose `navigator.clipboard` but still reject the call.
    }
  }
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  // Off-screen but still selectable. `display:none` would make the
  // selection — and therefore the copy — fail silently.
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

export async function shareNative(content: ShareContent): Promise<ShareOutcome> {
  const { title, text, url, dialogTitle, suppressCopyConfirmation } = content;
  // `${text}\n${url}` with no url used to paste the literal string
  // "undefined" onto the end of the clipboard text.
  const clipboardText = content.clipboardText ?? (url ? `${text}\n${url}` : text);
  try {
    /* CALL navigator.share BEFORE ANY await — this is the whole bug.
       The web Share API is gated on user activation, and activation is
       consumed by the first await in the handler. This function used to open
       with `await import("@capacitor/core")` purely to ask which platform it
       was on, so by the time it reached `navigator.share` the browser no
       longer considered the click live and rejected with NotAllowedError. The
       catch below then tried the clipboard, which needs document focus and
       often fails too, and the tap read as doing nothing.

       `isNativePlatform` is a synchronous const from nativeInit, so the branch
       costs no await. The @capacitor/share import still happens lazily — but
       only on native, where the plugin bridge has no gesture requirement. */
    // The `url` key is only SET when there is a url. `{ url: undefined }` is
    // treated as absent by WebIDL and by the Capacitor bridge today, but this
    // payload is the thing the whole bug was about, so it is built explicitly
    // rather than left to those two coincidences.
    if (!isNativePlatform && typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share(url ? { title, text, url } : { title, text });
      return "shared";
    }
    if (isNativePlatform) {
      const { Share } = await import("@capacitor/share");
      await Share.share(url ? { title, text, url, dialogTitle } : { title, text, dialogTitle });
      return "shared";
    }
    /* The clipboard tier MUST say something. It used to `return` silently, so
       on any surface without `navigator.share` — desktop Safari and macOS
       Chrome, which is where this was reported — tapping Share copied the link
       and gave zero feedback. Indistinguishable from a dead button (owner,
       2026-08-30: "does nothing"). The tier list at the top of this file always
       described this step as "copy the link + toast a hint"; the toast was just
       never written. */
    if (await copyToClipboard(clipboardText)) {
      confirmCopied(!!url, suppressCopyConfirmation);
      return "copied";
    }
    /* Last-ditch tier, also from the list at the top and also never
       implemented: no share sheet AND no clipboard. Surface the URL so the
       action still produces something the user can act on. */
    toast(url ? "Copy this link" : "Copy this summary", { description: clipboardText });
    return "surfaced";
  } catch (err) {
    if (isUserCancellation(err)) return "cancelled";
    // NotAllowedError is what a gesture-less or permission-blocked share
    // throws. It is NOT a cancellation, so it must not be swallowed — the
    // fallbacks below are what turn it back into something the user sees.
    // Fall back to clipboard before surfacing a hard failure.
    try {
      if (await copyToClipboard(clipboardText)) {
        // Same silent-success bug as the tier above: the recovery path copied
        // the link and said nothing, so a share that fell back after a
        // NotAllowedError looked identical to a dead button.
        confirmCopied(!!url, suppressCopyConfirmation);
        return "copied";
      }
    } catch {
      /* clipboard also unavailable — fall through to the error toast */
    }
    toast.error("Couldn't share — try again.");
    return "failed";
  }
}

/** Both the Web Share API and the Capacitor bridge report a dismissed sheet as
 *  a thrown AbortError. That is a "no thanks", not a failure. */
/**
 * Confirm the WEB DOWNLOAD branch of `shareFileNative`.
 *
 * The native branch needs nothing: the OS share sheet slides up, which is
 * unmissable. The web branch is `<a download>`, and after it fires the page is
 * pixel-identical to the page before it — same button, same state, no dialog.
 * The browser's own download UI is the only signal, and it is a silent
 * `~/Downloads` write with a brief toolbar flicker on desktop Safari and
 * nothing at all on iOS Safari. So on the two surfaces this app is most often
 * opened from, exporting a file looked exactly like a dead button.
 *
 * That is the same defect `confirmCopied` above documents, one branch over,
 * and the same fix: the bare `toast(...)` callable, which `applyToastPolicy`
 * does not patch. It is deliberately here rather than at each call site —
 * "nothing on screen changed" is a property of this BRANCH, so every caller
 * (earnings CSV, tax PDF, admin export, calendar file, work record) inherits
 * it instead of each rediscovering the suppression. `toast.success` here would
 * render nothing; see src/lib/toastPolicy.ts.
 *
 * The filename is the payload, not decoration — it is what the user searches
 * their downloads folder for.
 */
function confirmDownloaded(fileName: string, suppress?: boolean): void {
  if (suppress) return;
  toast(`${fileName} downloaded`, {
    description: "It's in your browser's downloads.",
  });
}

function isUserCancellation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /cancel/i.test(err.message) || /dismiss/i.test(err.message))
  );
}

/**
 * Share a real FILE — the idiom `calendarExport.ts` established, generalised.
 *
 * WHY A FILE AND NOT `{ text, url }`
 * ----------------------------------
 * iOS builds the share sheet from the UTIs of the activity items it is given.
 * Hand it a URL and it renders that URL's link preview and offers link-shaped
 * targets; hand it a `data:` URI and it has no UTI at all, so document handlers
 * (Files, Mail attachment, Print) never appear. Hand it a `file://` URI with a
 * real extension and the sheet offers Save to Files, Mail, Print, AirDrop —
 * the things someone does with a document they need to keep or forward.
 *
 * `files` is passed ALONE. Adding a sibling `text` or `url` makes it a mixed
 * activity and iOS suppresses the document handlers outright — that is the
 * exact mistake that made the calendar button appear to do nothing. `title` is
 * safe: the plugin maps it to the sheet's subject, not to an activity item.
 *
 * Branches:
 *  1. Native — Filesystem.writeFile (Cache) -> Share.share({ files }).
 *  2. Web — `<a download>` on an object URL. Deliberately NOT the Web Share
 *     API: sharing files there needs `navigator.canShare({files})` support the
 *     desktop browsers this app is used from do not have, and the call must
 *     beat the user-activation clock that the awaits above have already spent
 *     (see the big comment in `shareNative`). A download always works and
 *     leaves the recipient a file they can attach to an email.
 *
 * Every failure is BOTH toasted and reported, and the web branch also
 * CONFIRMS (see `confirmDownloaded`) — a share that silently does nothing is
 * the defect this whole path exists to fix, and on web an unannounced download
 * is indistinguishable from one.
 */
export async function shareFileNative(content: ShareFileContent): Promise<ShareFileOutcome> {
  const { fileName, base64, blob, title, dialogTitle, source, suppressDownloadConfirmation } =
    content;

  if (isNativePlatform) {
    let fileUri: string;
    // Staging and presenting fail for different reasons and need different
    // copy. Collapsing them would let a disk error be swallowed by the
    // cancellation test below.
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const written = await Filesystem.writeFile({
        path: fileName,
        // No `encoding` => the plugin treats `data` as base64, which is what a
        // PDF needs. Passing Encoding.UTF8 here would corrupt the bytes.
        data: base64,
        // Cache, not Documents: the file only has to survive long enough for
        // the share sheet to read it. Documents is user-visible and
        // iCloud-backed on iOS, so a stray copy per tap would pile up in Files.
        directory: Directory.Cache,
        recursive: true,
      });
      fileUri = written.uri;
    } catch (err) {
      report(err, { severity: "error", tags: { source: `${source}.writeFile` } });
      toast.error("Couldn't prepare the file", {
        description: "Your device wouldn't let the app save it. Try again.",
      });
      return "failed";
    }

    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, files: [fileUri], dialogTitle });
      return "shared";
    } catch (err) {
      if (isUserCancellation(err)) return "cancelled";
      report(err, { severity: "error", tags: { source: `${source}.share` } });
      toast.error("Couldn't open the share sheet", { description: "Try again." });
      return "failed";
    }
  }

  try {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Object URLs are never auto-revoked. This one is referenced only by the
    // click that just fired, so free it once the browser has had a tick.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    // A download changes nothing on screen — see confirmDownloaded.
    confirmDownloaded(fileName, suppressDownloadConfirmation);
    return "downloaded";
  } catch (err) {
    if (isUserCancellation(err)) return "cancelled";
    report(err, { severity: "error", tags: { source: `${source}.download` } });
    toast.error("Couldn't download the file — try again.");
    return "failed";
  }
}
