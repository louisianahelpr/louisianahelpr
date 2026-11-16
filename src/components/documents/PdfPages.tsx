import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
// pdf.js, the LEGACY build: the modern build needs Promise.withResolvers (Safari 17.4) and the iOS app supports iOS 15
// (ios/App/App.xcodeproj IPHONEOS_DEPLOYMENT_TARGET). This module is only ever reached through React.lazy in
// DocumentViewer, so pdf.js never joins a page's first download (scripts/perf/critical-path.mjs).
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
// The worker is served from our own origin (CSP worker-src 'self' blob:), never a CDN.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** Pages drawn before the viewer asks the reader to download the rest (a phone holds every canvas in memory). */
const MAX_PAGES = 40;

/**
 * Every page of a PDF, one canvas per page, fitted to the viewer's width and drawn sharp for the screen's pixel ratio.
 * `zoom` widens the pages (the viewer scrolls both ways). `onError` fires once when the file cannot be read, so the
 * viewer shows its Download card instead.
 */
export default function PdfPages({ url, name, zoom, onError }: { url: string; name: string; zoom: number; onError: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    // isEvalSupported: false — pdf.js would otherwise compile font programs with new Function, which the CSP
    // (no 'unsafe-eval') refuses.
    const task = getDocument({ url, isEvalSupported: false });
    task.promise.then(
      (d) => { if (!cancelled) setDoc(d); },
      () => { if (!cancelled) onErrorRef.current(); },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Fit to the viewer, but no wider than a readable page on a desktop (1440: a 1950px-wide page was all margin).
    const measure = () => setWidth(Math.min(el.clientWidth, 900));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pages = doc ? Math.min(doc.numPages, MAX_PAGES) : 0;
  return (
    <div ref={wrapRef} className="w-full">
      {!doc ? (
        <div role="status" className="flex flex-col items-center justify-center gap-2 py-24 text-white/80 font-sans text-ds-13">
          <Loader2 className="w-6 h-6 animate-spin" aria-hidden />
          Opening {name}…
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 pb-6 mx-auto" style={{ width: width ? width * zoom : undefined }}>
          {Array.from({ length: pages }, (_, i) => (
            <PdfPage key={i} doc={doc} pageNumber={i + 1} width={Math.max(0, width * zoom - 16)} total={doc.numPages} />
          ))}
          {doc.numPages > MAX_PAGES ? (
            <p className="font-sans text-ds-13 text-white/80 px-4 text-center">
              Showing the first {MAX_PAGES} of {doc.numPages} pages. Download the file to see the rest.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PdfPage({ doc, pageNumber, width, total }: { doc: PDFDocumentProxy; pageNumber: number; width: number; total: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    let render: { cancel: () => void; promise: Promise<void> } | null = null;
    void doc.getPage(pageNumber).then((page) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
      canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) { setFailed(true); return; }
      render = page.render({ canvasContext: ctx, viewport });
      render.promise.catch((e: unknown) => {
        // A cancelled render (the reader zoomed or closed) is expected; any other failure shows on the page.
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) setFailed(true);
      });
    }, () => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, pageNumber, width]);
  return failed ? (
    <p className="font-sans text-ds-13 text-white/80">Page {pageNumber} could not be drawn.</p>
  ) : (
    <canvas ref={canvasRef} role="img" aria-label={`Page ${pageNumber} of ${total}`} className="bg-white rounded-ds-sm shadow-lg max-w-none" />
  );
}
