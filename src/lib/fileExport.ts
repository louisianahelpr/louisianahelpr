import { toast } from "sonner";
import { isNativePlatform } from "@/lib/nativeInit";
import { shareFileNative } from "@/lib/nativeShare";

/**
 * fileExport — hand a generated file (CSV, PDF, JSON) to the device it was
 * generated on.
 *
 * ─── THE DEFECT THIS EXISTS TO FIX ────────────────────────────────────────
 * Owner, 2026-08-30: "Download csv pdf etc does not work."
 *
 * Every export used the browser download idiom — `new Blob(...)` →
 * `URL.createObjectURL` → `<a download>` → `.click()` → `revokeObjectURL`
 * (jsPDF's `doc.save()` does the same thing internally). That idiom is a NO-OP
 * inside the app: Capacitor serves the bundled `dist/` from WKWebView, which
 * honours neither the `download` attribute nor a `blob:` navigation. The click
 * fired, nothing happened, no error was thrown and nothing was logged — the
 * exact silent-no-op shape that makes a feature feel broken rather than
 * unavailable. It worked perfectly in desktop Chrome, which is why it shipped.
 *
 * ─── WHY THIS IS NOW A THIN ADAPTER ───────────────────────────────────────
 * The first pass at this file could not build the real fix: @capacitor/filesystem
 * was not a dependency, so it shipped a weaker fallback — base64 `data:` URI →
 * `Share.share({ url })` — and documented that it should be upgraded "the next
 * time the native project is regenerated".
 *
 * That has happened. @capacitor/filesystem@8.1.3 is in package.json and
 * registered in the iOS SPM manifest (`ios/App/CapApp-SPM/Package.swift`,
 * `CapacitorFilesystem`), added by the lane that fixed "Add to Calendar".
 *
 * The `data:` fallback had to go regardless of taste, because on iOS it is
 * inert for the one thing it exists to do. `SharePlugin.swift` does
 * `URL(string: url)` and appends the result to `UIActivityViewController`'s
 * `activityItems`, and iOS resolves a share sheet's targets from an item's UTI.
 * A `data:` URL has no UTI — so the sheet opened on an opaque percent-encoded
 * blob with no filename, offering Copy/Messages/Mail and never "Save to Files".
 * Worse, that call also passed a sibling `text:` item, which makes the share a
 * mixed activity and suppresses document handlers outright.
 *
 * So the native path is now the idiom iOS actually acts on: stage the bytes as
 * a real file with @capacitor/filesystem, then share the `file://` URI and ONLY
 * that item. iOS resolves the extension's UTI (`public.comma-separated-values-text`
 * for .csv, `com.adobe.pdf` for .pdf, `public.json` for .json) and offers Save
 * to Files, Mail, Print, AirDrop.
 *
 * ─── AND WHY IT IS NOT A THIRD IMPLEMENTATION OF THAT ─────────────────────
 * That exact write-then-share block already exists twice: `calendarExport.ts`
 * (.ics) established it, and `shareFileNative` in `nativeShare.ts` is that same
 * idiom deliberately generalised ("the idiom calendarExport.ts established,
 * generalised" — its own docblock) for the /work-record PDF. `shareFileNative`
 * is a general-purpose helper, so this module CALLS it rather than growing a
 * third near-identical copy. It also gets two things the old local
 * implementation lacked: `report()` telemetry on every failure, and separate
 * try/catch around staging vs presenting so a disk error can't be swallowed by
 * the cancellation test.
 *
 * What stays here is what is genuinely this module's own: the bridge size
 * guard, the blob→base64 conversion, and `canPrintDocument`.
 */

/**
 * Ceiling on what we will stage and hand to the Capacitor bridge.
 *
 * The payload crosses the JS↔native boundary as a single base64 string, so a
 * large export would freeze the bridge rather than fail. A year of payouts is a
 * few KB and the widest tax PDF is well under this; refusing past it with an
 * actionable message beats a hang.
 */
const NATIVE_SHARE_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Can this surface actually show a print dialog?
 *
 * `window.print()` exists on `window` everywhere but is a NO-OP in every
 * WKWebView-hosted context this app runs in: the shipped app has no
 * `server.url` in capacitor.config.ts, so it runs bundled `dist/` inside
 * WKWebView, which ships no print UI at all — and an iOS home-screen install
 * hits the same wall because manifest.webmanifest declares
 * `display: standalone`, and standalone WebKit has no print UI either.
 *
 * The derivation is lifted from `src/pages/WorkRecord.tsx`, which found and
 * documented this first; it should be deduped into this module the next time
 * that file is touched (it is owned by another lane right now).
 */
export const canPrintDocument =
  !isNativePlatform &&
  typeof navigator !== "undefined" &&
  (navigator as Navigator & { standalone?: boolean }).standalone !== true &&
  typeof window !== "undefined" &&
  typeof window.print === "function";

/**
 * Blob → bare base64 (no `data:` prefix), which is what `Filesystem.writeFile`
 * takes when no `encoding` is passed.
 *
 * ONE ENCODING FOR EVERY FILE TYPE, DELIBERATELY. `Filesystem.writeFile` has
 * two modes: omit `encoding` and it decodes `data` as base64 and writes the
 * raw bytes; pass `Encoding.UTF8` and it writes the string's UTF-8 bytes. Text
 * exports (CSV, JSON) work either way — a Blob built from a JS string is
 * already UTF-8, so base64 of those bytes round-trips to the identical file —
 * but a PDF works only through base64, and picking the wrong mode corrupts the
 * file SILENTLY (a UTF-8 write of binary mangles every non-UTF-8 byte; a
 * base64-mode write of plain text throws). Callers hand this module a Blob and
 * never think about it, so there is no per-call-site choice left to get wrong.
 *
 * FileReader rather than a manual `btoa` over a string: `btoa` operates on
 * latin1 code units, so any non-ASCII character in a CSV (an accented name, a
 * "—", a "€") throws InvalidCharacterError or silently truncates. FileReader
 * reads the blob's actual bytes and is asynchronous, so the encode does not
 * block the main thread.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the generated file."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read the generated file."));
        return;
      }
      // `data:<mime>;base64,<payload>` → `<payload>`. readAsDataURL always
      // produces a base64 data URL, so the comma is always present.
      const comma = result.indexOf(",");
      resolve(comma === -1 ? "" : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export interface SaveFileOptions {
  blob: Blob;
  /**
   * Filename WITH its extension, used for the web download and to stage the
   * native file. The extension is load-bearing on iOS: the share sheet's
   * targets are resolved from the file's UTI, which comes from the extension.
   */
  filename: string;
  /** Human name of the thing being exported, for the toast copy. */
  label: string;
  /** Tag for error telemetry, e.g. "adminExport.users". */
  source?: string;
}

/**
 * Deliver `blob` to the user, by whichever route the current platform actually
 * supports. Never throws, never returns silently: every failure produces a
 * toast (and a `report`) except an explicit share-sheet cancellation, which is
 * a "no thanks" rather than a fault.
 *
 * No success toast lives HERE, and that is not the same as no confirmation.
 * On native the OS share sheet is the confirmation. On web the download is
 * confirmed by `confirmDownloaded` inside `shareFileNative`, through the bare
 * `toast(...)` callable — this used to say "the browser's own download UI is
 * the confirmation", which was wrong: on desktop Safari that is a silent write
 * to ~/Downloads and on iOS Safari it is nothing at all, so exporting read as
 * a dead button. Do not add a `toast.success` here to fix that; `toastPolicy`
 * would suppress it and you would ship the same silence with extra code.
 *
 * @returns true when the file was handed off, false when it was not.
 */
export async function saveOrShareFile({
  blob,
  filename,
  label,
  source = "fileExport",
}: SaveFileOptions): Promise<boolean> {
  if (isNativePlatform && blob.size > NATIVE_SHARE_MAX_BYTES) {
    toast.error("That export is too large to share from the app", {
      description: "Narrow the date range, or download it from helpr on the web.",
    });
    return false;
  }

  let base64: string;
  try {
    base64 = await blobToBase64(blob);
  } catch {
    // Reading our own freshly-built blob should not fail, but if it does the
    // user must hear about it — silence is the defect this module exists for.
    toast.error(`Couldn't prepare ${label}`, { description: "Try again in a moment." });
    return false;
  }

  // Native: Filesystem.writeFile(Cache) → Share.share({ files: [uri] }), files
  // ONLY — no `text`, no `url` sibling. Web: `<a download>` on an object URL.
  // Both branches, their toasts and their telemetry live in `shareFileNative`.
  const outcome = await shareFileNative({
    fileName: filename,
    base64,
    blob,
    // `title` is NOT an activity item — SharePlugin.swift sets it as the
    // sheet's `subject` — so it is safe alongside `files`.
    title: filename,
    dialogTitle: `Save ${label}`,
    source,
  });

  return outcome === "shared" || outcome === "downloaded";
}
