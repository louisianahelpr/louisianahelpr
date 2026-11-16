import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, FileText, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { DarkGroundCloseButton } from "@/components/ui/DarkGroundCloseButton";
import { useOverlayFocus } from "@/hooks/useOverlayFocus";
import { documentKind, documentName, downloadUrl } from "@/lib/documentKind";
import { isNativePlatform } from "@/lib/nativeInit";

// pdf.js loads only when a PDF is opened (PdfPages imports it), never on a page's first download.
const PdfPages = lazy(() => import("./PdfPages"));

export type OpenDocument = { url: string; name?: string | null };

const ZOOMS = [1, 1.5, 2, 3] as const;

/**
 * Leave the app on purpose, from the viewer's secondary actions only (Download, Open in new tab). Native: the in-app
 * browser sheet (SFSafariViewController), which shows the file with its own Share/Save; web: a new tab. A storage
 * download URL answers `Content-Disposition: attachment`, so on the web the tab saves the file and closes.
 */
async function leaveTo(url: string) {
  if (isNativePlatform) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url, presentationStyle: "popover" });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

const CHROME_BTN =
  "min-h-11 px-3 inline-flex items-center gap-1.5 rounded-ds-md bg-white/[0.12] ctl-tint-invert text-white font-sans text-ds-13 font-medium transition-colors active:scale-95";

/**
 * The app's own document viewer (owner 2026-11-15: "add the PDF viewer too"). A document opens here, full screen,
 * instead of the raw storage URL in a new tab, the way a photo opens in PhotoLightbox:
 *
 *   PDF          every page drawn with pdf.js, with zoom
 *   image/HEIC   the picture; a HEIC Chrome cannot draw falls back to the Download card
 *   Word, other  a card with the file name and Download
 *
 * Close is the primary action; Download and "Open in new tab" are secondary. Portalled to <body> with
 * pointer-events: auto, like PhotoLightbox, so a Radix modal underneath neither clips nor deadens it.
 * Guard: src/test/documentsOpenInApp.test.tsx.
 */
export function DocumentViewer({ doc, onClose }: { doc: OpenDocument | null; onClose: () => void }) {
  const open = doc !== null;
  const rootRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setZoom(1); setFailed(false); }, [doc?.url]);

  useOverlayFocus(rootRef, open);

  // Escape closes this viewer only, not a Radix sheet underneath (same capture-on-window reason as PhotoLightbox).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // Focus goes back to whatever opened the viewer.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    return () => { if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); };
  }, [open]);

  // An open Radix modal stamps aria-hidden on every <body> child but itself; keep the viewer visible to screen readers.
  useEffect(() => {
    const el = rootRef.current;
    if (!open || !el) return;
    const unhide = () => {
      if (el.getAttribute("aria-hidden") === "true") {
        el.removeAttribute("aria-hidden");
        el.removeAttribute("data-aria-hidden");
      }
    };
    unhide();
    const mo = new MutationObserver(unhide);
    mo.observe(el, { attributes: true, attributeFilter: ["aria-hidden"] });
    return () => mo.disconnect();
  }, [open]);

  if (!doc) return null;
  const name = documentName(doc.url, doc.name);
  const kind = documentKind(doc.url, doc.name);
  const showCard = failed || kind === "word" || kind === "other";
  const zi = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Document viewer"
      className="fixed inset-0 z-[60] flex flex-col animate-in fade-in-0 duration-200"
      // Opaque: at 0.97 the page behind still read through the title bar (screenshot 11-15, chromium-pdf-1440).
      style={{ backgroundColor: "hsl(38, 18%, 12%)", pointerEvents: "auto" }}
    >
      <div className="flex items-center gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-white/10">
        <p className="flex-1 min-w-0 truncate font-sans text-ds-14 font-semibold text-white" title={name}>{name}</p>
        <DarkGroundCloseButton aria-label="Close document viewer" className="!static flex-shrink-0" onClick={onClose} />
      </div>

      <div className="flex-1 min-h-0 overflow-auto overscroll-contain px-2 pt-3" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
        {showCard ? (
          <FileCard name={name} why={failed ? (kind === "heic" ? "This iPhone photo can't be shown in this browser." : "This file couldn't be shown here.") : "This kind of file can't be shown in the app."} url={doc.url} />
        ) : kind === "pdf" ? (
          <Suspense fallback={<Opening name={name} />}>
            <PdfPages url={doc.url} name={name} zoom={zoom} onError={() => setFailed(true)} />
          </Suspense>
        ) : (
          <div className="min-h-full flex items-center justify-center pb-6">
            <img src={doc.url} alt={name} onError={() => setFailed(true)} className="max-w-full max-h-[80dvh] object-contain rounded-ds-sm" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 px-3 pt-2 pb-[max(0.75rem,var(--safe-area-bottom,0px))] border-t border-white/10">
        {kind === "pdf" && !failed ? (
          <>
            <button type="button" className={CHROME_BTN} aria-label="Zoom out" disabled={zi <= 0} onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)])}>
              <ZoomOut className="w-4 h-4" aria-hidden />
            </button>
            <button type="button" className={CHROME_BTN} aria-label="Zoom in" disabled={zi >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])}>
              <ZoomIn className="w-4 h-4" aria-hidden />
            </button>
          </>
        ) : null}
        <button type="button" className={CHROME_BTN} onClick={() => void leaveTo(downloadUrl(doc.url, name))}>
          <Download className="w-4 h-4" aria-hidden /> Download
        </button>
        <button type="button" className={CHROME_BTN} onClick={() => void leaveTo(doc.url)}>
          <ExternalLink className="w-4 h-4" aria-hidden /> Open in new tab
        </button>
      </div>
    </div>,
    document.body,
  );
}

function Opening({ name }: { name: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-2 py-24 text-white/80 font-sans text-ds-13">
      <Loader2 className="w-6 h-6 animate-spin" aria-hidden />
      Opening {name}…
    </div>
  );
}

/** A file the viewer cannot draw: its name, why, and Download (the bottom bar's Download does the same). */
function FileCard({ name, why, url }: { name: string; why: string; url: string }) {
  return (
    <div className="min-h-full flex items-center justify-center py-10">
      <div className="w-full max-w-sm rounded-ds-lg bg-white/[0.08] border border-white/15 p-6 flex flex-col items-center text-center gap-3">
        <FileText className="w-10 h-10 text-white/80" aria-hidden />
        <p className="font-sans text-ds-15 font-semibold text-white break-all">{name}</p>
        <p className="font-sans text-ds-13 text-white/75">{why} Download it to open it on your device.</p>
        <button type="button" className="min-h-11 px-4 inline-flex items-center gap-1.5 rounded-ds-md btn-grad-primary text-white font-sans text-ds-13 font-medium active:scale-95" onClick={() => void leaveTo(downloadUrl(url, name))}>
          <Download className="w-4 h-4" aria-hidden /> Download {name}
        </button>
      </div>
    </div>
  );
}
