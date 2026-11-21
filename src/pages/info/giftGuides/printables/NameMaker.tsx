import { useEffect, useId, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeRadio } from "@/components/ui/NativeRadio";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { Dialog, DialogContent, DialogFooter, DialogHero, DialogPrimaryAction, DialogSecondaryAction } from "@/components/ui/dialog";
import { canPrintDocument, saveOrShareFile } from "@/lib/fileExport";
import {
  NAME_FONTS,
  PAGE,
  PRINTABLES_WORDS as W,
  cleanName,
  designSize,
  fitLine,
  layoutFor,
  pageSlots,
  sheetPages,
  slotTransform,
  MAX_NAME,
  type NameFontId,
  type Names,
  type OverlayDesign,
  type OverlayProduct,
  type SheetItem,
  type SheetLayout,
} from "@/content/printables";

/**
 * The name-overlay maker (owner 2026-11-20), its own lazy chunk: gift tags, the Santa letter / Nice List and the
 * thank-you cards. The shopper picks a design and a name style and types the names; the preview and the printout are
 * the same SVG (one per letter page, 7.5 x 10 in inside 0.5 in margins), so what you see is what prints. Print uses a
 * print stylesheet (the pages are portaled to <body>; everything else is hidden while printing); "Save as PDF" draws
 * the same pages on a canvas and hands jsPDF the pictures (the native app has no print dialog). Nothing is saved.
 * Guard: src/test/printables1120.test.tsx.
 */

type Font = (typeof NAME_FONTS)[number];
const PREFIX_FAMILY = "Montserrat, Helvetica, Arial, sans-serif";

/** Width of `text` at `size` px in a font; a plain estimate when there is no canvas (tests, very old browsers). */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureWith(font: Font) {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement("canvas").getContext("2d");
    } catch {
      // No canvas at all: the estimate below is used.
      measureCtx = null;
    }
  }
  return (text: string, size: number, isPrefix: boolean) => {
    if (!measureCtx) return text.length * size * (isPrefix ? 0.62 : 0.5);
    measureCtx.font = isPrefix ? `600 ${size}px ${PREFIX_FAMILY}` : `${font.style} ${font.weight} ${size}px "${font.family}"`;
    return measureCtx.measureText(text).width;
  };
}

interface Line {
  key: string;
  prefix: string;
  name: string;
  fit: ReturnType<typeof fitLine>;
}

function itemLines(product: OverlayProduct, item: SheetItem, font: Font): Line[] {
  const measure = measureWith(font);
  const labels = item.design.labels !== false;
  return product.fields.flatMap((f) => {
    const box = item.design.boxes[f.key];
    if (!box) return [];
    const name = cleanName(item.names[f.key] ?? "").trim();
    const prefix = labels && f.prefix ? f.prefix : "";
    if (!name && !prefix) return [];
    return [{ key: f.key, prefix, name, fit: fitLine(box, prefix, name, measure) }];
  });
}

/** One item, drawn in its own design units (hundredths of an inch). */
function ItemSvg({ product, item, font }: { product: OverlayProduct; item: SheetItem; font: Font }) {
  const size = designSize(product, item.design);
  const w = size.w * 100;
  const h = size.h * 100;
  const site = item.design.siteLine;
  return (
    <>
      <image href={item.design.image} x={0} y={0} width={w} height={h} preserveAspectRatio="none" />
      {itemLines(product, item, font).map((l) => (
        <text
          key={l.key}
          x={0}
          y={0}
          transform={`translate(${l.fit.x} ${l.fit.y})${l.fit.squeeze < 1 ? ` scale(${l.fit.squeeze} 1)` : ""}`}
          textAnchor={l.fit.anchor}
          fill={item.design.ink}
          fontFamily={`"${font.family}", cursive`}
          fontStyle={font.style}
          fontWeight={font.weight}
          fontSize={l.fit.size}
          data-printable-line={l.key}
        >
          {l.prefix && <tspan fontFamily={PREFIX_FAMILY} fontStyle="normal" fontWeight={600} fontSize={l.fit.prefixSize}>{l.prefix} </tspan>}
          {l.name}
        </text>
      ))}
      {site && (
        <text x={site.x !== undefined ? site.x * 100 : w / 2} y={site.y * 100} textAnchor="middle" fill={site.color} fontFamily={PREFIX_FAMILY} fontWeight={600} fontSize={Math.max(6.5, w * 0.026)} letterSpacing={0.4} data-printable-site="">
          {W.site}
        </text>
      )}
    </>
  );
}

/** One letter page: the items in their slots, and the dashed cut lines. */
function PageSvg({ product, layout, items, font, className, label }: { product: OverlayProduct; layout: SheetLayout; items: SheetItem[]; font: Font; className: string; label: string }) {
  // Each item's own slot in the design's sheet (10 wide tags, or 9 of the rest shrunk to fit).
  const slots = pageSlots(items.map((item) => designSize(product, item.design)), layout);
  return (
    <svg className={className} viewBox={`0 0 ${PAGE.w} ${PAGE.h}`} role="img" aria-label={label} xmlns="http://www.w3.org/2000/svg">
      <rect width={PAGE.w} height={PAGE.h} fill="#ffffff" />
      {items.map((item, i) => (
        <g key={i} transform={slotTransform(slots[i])} data-printable-item={i}>
          <ItemSvg product={product} item={item} font={font} />
        </g>
      ))}
      {layout.cutLines &&
        items.map((_, i) => (
          <rect key={`cut${i}`} x={slots[i].x} y={slots[i].y} width={slots[i].w} height={slots[i].h} className="pr-cut" data-printable-cut="" />
        ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Save as PDF: the same plan drawn on a canvas at 200 dpi, one JPEG per page.

const DPI = 200;
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`printables: could not load ${src}`));
    img.src = src;
  });

async function drawPage(product: OverlayProduct, layout: SheetLayout, items: SheetItem[], font: Font, images: Map<string, HTMLImageElement>): Promise<HTMLCanvasElement> {
  const k = DPI / 100;
  const canvas = document.createElement("canvas");
  canvas.width = PAGE.w * k;
  canvas.height = PAGE.h * k;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("printables: no canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const slots = pageSlots(items.map((item) => designSize(product, item.design)), layout);
  items.forEach((item, i) => {
    const s = slots[i];
    const size = designSize(product, item.design);
    const w = size.w * 100;
    const h = size.h * 100;
    ctx.save();
    ctx.scale(k, k);
    if (s.rotate) {
      ctx.translate(s.x + s.w, s.y);
      ctx.rotate(Math.PI / 2);
    } else ctx.translate(s.x, s.y);
    ctx.scale(s.scale, s.scale);
    const img = images.get(item.design.image);
    if (img) ctx.drawImage(img, 0, 0, w, h);
    for (const l of itemLines(product, item, font)) {
      ctx.fillStyle = item.design.ink;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      const nameFont = `${font.style} ${font.weight} ${l.fit.size}px "${font.family}"`;
      const prefixFont = `600 ${l.fit.prefixSize}px ${PREFIX_FAMILY}`;
      ctx.font = prefixFont;
      const pw = l.prefix ? ctx.measureText(`${l.prefix} `).width : 0;
      ctx.font = nameFont;
      const nw = ctx.measureText(l.name).width;
      const total = pw + nw;
      const squeeze = l.fit.squeeze;
      const drawn = total * squeeze;
      const x0 = l.fit.anchor === "middle" ? l.fit.x - drawn / 2 : l.fit.x;
      ctx.save();
      ctx.translate(x0, l.fit.y);
      ctx.scale(squeeze, 1);
      if (l.prefix) {
        ctx.font = prefixFont;
        ctx.fillText(`${l.prefix} `, 0, 0);
      }
      ctx.font = nameFont;
      ctx.fillText(l.name, pw, 0);
      ctx.restore();
    }
    const site = item.design.siteLine;
    if (site) {
      ctx.fillStyle = site.color;
      ctx.textAlign = "center";
      ctx.font = `600 ${Math.max(6.5, w * 0.026)}px ${PREFIX_FAMILY}`;
      ctx.fillText(W.site, site.x !== undefined ? site.x * 100 : w / 2, site.y * 100);
    }
    ctx.restore();
  });
  if (layout.cutLines) {
    ctx.save();
    ctx.scale(k, k);
    ctx.strokeStyle = "#8a8a8a";
    ctx.lineWidth = 0.7;
    ctx.setLineDash([5, 4]);
    items.forEach((_, i) => ctx.strokeRect(slots[i].x, slots[i].y, slots[i].w, slots[i].h));
    ctx.restore();
  }
  return canvas;
}

async function makePdf(product: OverlayProduct, layout: SheetLayout, pages: SheetItem[][], font: Font): Promise<Blob> {
  const srcs = [...new Set(pages.flat().map((i) => i.design.image))];
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(srcs.map(async (s) => images.set(s, await loadImage(s))));
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
  for (let p = 0; p < pages.length; p++) {
    if (p > 0) doc.addPage("letter", "portrait");
    const canvas = await drawPage(product, layout, pages[p], font, images);
    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0.5, 0.5, PAGE.w / 100, PAGE.h / 100);
  }
  return doc.output("blob");
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Press and hold a design (~400 ms, owner 2026-11-21: "can they hold the picture down to make it bigger") opens the big
 * preview; a quick tap still just picks it. A finger that moves (a scroll) cancels the hold. The click that ends a hold is
 * swallowed so the hold does not also pick the design ("Use this design" does that).
 */
const HOLD_MS = 400;
function useLongPress(onHold: (id: string) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => clear, []);
  return {
    bind: (id: string) => ({
      onPointerDown: (e: RPointerEvent) => {
        if (e.button > 0) return;
        clear();
        held.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          timer.current = null;
          held.current = true;
          onHold(id);
        }, HOLD_MS);
      },
      onPointerMove: (e: RPointerEvent) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (e: RMouseEvent) => {
        if (held.current || timer.current) e.preventDefault();
      },
      onClick: (e: RMouseEvent) => {
        // detail 0 is a keyboard press (Space on the radio): never swallowed, whatever an earlier hold left behind.
        if (!held.current || e.detail === 0) return;
        held.current = false;
        e.preventDefault();
      },
    }),
  };
}

const emptyNames = (p: OverlayProduct): Names => Object.fromEntries(p.fields.map((f) => [f.key, ""]));

export default function NameMaker({ product }: { product: OverlayProduct }) {
  const uid = useId();
  const [designId, setDesignId] = useState(product.designs[0]?.id ?? "");
  const [fontId, setFontId] = useState<NameFontId>("script");
  const [layoutIdx, setLayoutIdx] = useState(0);
  const [mode, setMode] = useState<"same" | "each">("same");
  const [same, setSame] = useState<Names>(() => emptyNames(product));
  const [rows, setRows] = useState<Names[]>(() => [emptyNames(product), emptyNames(product)]);
  const [mixDesigns, setMixDesigns] = useState(false);
  const [fontsTick, setFontsTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [zoomId, setZoomId] = useState<string | null>(null);
  const zoomDesign = zoomId ? product.designs.find((d) => d.id === zoomId) : undefined;
  const hold = useLongPress(setZoomId);
  const font = NAME_FONTS.find((f) => f.id === fontId) ?? NAME_FONTS[0];
  // A design that names its sheet prints on it (gift tags); otherwise the shopper's choice.
  const designLayouts = product.designs.some((d) => d.layout);
  const layout = layoutFor(product, product.designs.find((d) => d.id === designId), layoutIdx);
  const perPage = layout.cols * layout.rows;
  const maxRows = perPage * 4;

  // The name fonts: measure again once each has loaded (the first measure used the fallback's widths).
  useEffect(() => {
    let live = true;
    if (typeof document === "undefined" || !document.fonts?.load) return;
    void Promise.all(NAME_FONTS.map((f) => document.fonts.load(`${f.style} ${f.weight} 40px "${f.family}"`).catch(() => [])))
      .then(() => live && setFontsTick((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);

  const pages = useMemo(
    () => sheetPages(product, perPage, { mode, same, rows, designId, mixDesigns }),
    // fontsTick: re-fit once the fonts are in.
    [product, perPage, mode, same, rows, designId, mixDesigns, fontsTick],
  );
  const first = pages[0][0];
  const design: OverlayDesign | undefined = product.designs.find((d) => d.id === designId);

  const setRow = (i: number, key: string, v: string) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: cleanName(v) } : row)));
  const savePdf = async () => {
    setSaving(true);
    setErr(null);
    try {
      const blob = await makePdf(product, layout, pages, font);
      await saveOrShareFile({ blob, filename: `louisiana-helpr-${product.id}.pdf`, label: product.title, source: "printables.pdf" });
    } catch (e: unknown) {
      console.warn("printables: pdf failed", e);
      setErr(W.pdfError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pr-maker" data-printable-maker={product.id}>
      <style>{MAKER_CSS}</style>
      <fieldset className="pr-set">
        <legend>{W.design}</legend>
        <p className="pr-hint">{W.designHint}</p>
        <div className="pr-designs" data-printable-designs="">
          {product.designs.map((d) => (
            <div key={d.id} className={`pr-design-cell${d.id === designId ? " is-on" : ""}`}>
              <label className="pr-design" {...hold.bind(d.id)}>
                <NativeRadio name={`${uid}-design`} value={d.id} checked={d.id === designId} onChange={() => setDesignId(d.id)} className="sr-only" data-printable-design={d.id} />
                <img loading="lazy" decoding="async" src={d.thumb ?? d.image} alt="" draggable={false} width={designSize(product, d).w * 24} height={designSize(product, d).h * 24} />
                <span>{d.name}</span>
              </label>
              <RoundIconButton size="sm" className="pr-zoom" aria-label={W.zoom(d.name)} onClick={() => setZoomId(d.id)} data-printable-zoom={d.id}>
                <span className="pr-zoom-dot" aria-hidden="true"><ZoomIn className="h-3.5 w-3.5" /></span>
              </RoundIconButton>
            </div>
          ))}
        </div>
        <Dialog open={!!zoomDesign} onOpenChange={(o) => !o && setZoomId(null)}>
          {zoomDesign && (
            <DialogContent data-printable-zoom-dialog={zoomDesign.id}>
              <DialogHero title={zoomDesign.name} />
              {/* The full-size picture loads only now, when the preview opens; the grid shows the light thumbs. */}
              <img className="pr-zoom-img" src={zoomDesign.image} alt={zoomDesign.name} width={designSize(product, zoomDesign).w * 200} height={designSize(product, zoomDesign).h * 200} data-printable-zoom-img="" />
              <DialogFooter>
                <DialogSecondaryAction onClick={() => setZoomId(null)}>{W.close}</DialogSecondaryAction>
                <DialogPrimaryAction onClick={() => { setDesignId(zoomDesign.id); setZoomId(null); }} data-printable-zoom-use="">{W.useDesign}</DialogPrimaryAction>
              </DialogFooter>
            </DialogContent>
          )}
        </Dialog>
        {product.designs.length > 1 && (
          <label className="pr-check min-h-11">
            <Checkbox checked={mixDesigns} onCheckedChange={(v) => setMixDesigns(v === true)} data-printable-mix-designs="" />
            <span>{W.mixDesigns}</span>
          </label>
        )}
      </fieldset>

      <fieldset className="pr-set">
        <legend>{W.font}</legend>
        <div className="pr-chips">
          {NAME_FONTS.map((f) => (
            <label key={f.id} className={`pr-chip${f.id === fontId ? " is-on" : ""}`} style={{ fontFamily: `"${f.family}", cursive`, fontStyle: f.style, fontWeight: f.weight }}>
              <NativeRadio name={`${uid}-font`} value={f.id} checked={f.id === fontId} onChange={() => setFontId(f.id)} className="sr-only" data-printable-font={f.id} />
              {f.label}
            </label>
          ))}
        </div>
      </fieldset>

      {product.layouts.length > 1 && !designLayouts && (
        <fieldset className="pr-set">
          <legend>{W.layout}</legend>
          <div className="pr-chips">
            {product.layouts.map((l, i) => (
              <label key={l.id} className={`pr-chip pr-chip-plain${i === layoutIdx ? " is-on" : ""}`}>
                <NativeRadio name={`${uid}-layout`} value={l.id} checked={i === layoutIdx} onChange={() => setLayoutIdx(i)} className="sr-only" data-printable-layout={l.id} />
                {l.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="pr-set">
        <legend>{W.names}</legend>
        {product.mix && (
          <div className="pr-modes">
            {(["same", "each"] as const).map((m) => (
              <label key={m} className="pr-radio">
                <NativeRadio name={`${uid}-mode`} value={m} checked={mode === m} onChange={() => setMode(m)} data-printable-mode={m} />
                <span>{m === "same" ? W.modeSame(product.unit) : W.modeEach(product.unit)}</span>
              </label>
            ))}
          </div>
        )}
        {mode === "same" ? (
          <div className="pr-fields">
            {product.fields.map((f) => (
              <div key={f.key}>
                <label htmlFor={`${uid}-same-${f.key}`}>{f.label}</label>
                <Input id={`${uid}-same-${f.key}`} value={same[f.key] ?? ""} maxLength={MAX_NAME} placeholder={f.placeholder} autoComplete="off" onChange={(e) => setSame((s) => ({ ...s, [f.key]: cleanName(e.target.value) }))} data-printable-field={f.key} />
              </div>
            ))}
          </div>
        ) : (
          <ol className="pr-rows">
            {rows.map((row, i) => (
              <li key={i} className="pr-row" data-printable-row={i}>
                <span className="pr-row-n" aria-hidden="true">{i + 1}</span>
                {product.fields.map((f) => (
                  <Input key={f.key} aria-label={`${W.rowLabel(product.unit, i + 1)}: ${f.label}`} value={row[f.key] ?? ""} maxLength={MAX_NAME} placeholder={f.label} autoComplete="off" onChange={(e) => setRow(i, f.key, e.target.value)} />
                ))}
                <RoundIconButton className="pr-x" aria-label={W.removeRow(i + 1)} onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [emptyNames(product)]))}>
                  <span aria-hidden="true">×</span>
                </RoundIconButton>
              </li>
            ))}
          </ol>
        )}
        {mode === "each" && rows.length < maxRows && (
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setRows((r) => [...r, { ...emptyNames(product), ...(r.length && r[r.length - 1].from ? { from: r[r.length - 1].from } : {}) }])} data-printable-add-row="">
            {W.addRow(product.unit)}
          </Button>
        )}
      </fieldset>

      <div className={`pr-previews${perPage === 1 ? " is-one" : ""}`}>
        <div className="pr-one-wrap">
          <p className="pr-k">{W.preview}</p>
          <svg className="pr-one" viewBox={`0 0 ${designSize(product, first.design).w * 100} ${designSize(product, first.design).h * 100}`} role="img" aria-label={`${W.preview}: ${design?.name ?? ""}`} data-printable-preview="">
            <ItemSvg product={product} item={first} font={font} />
          </svg>
        </div>
        <div>
          <p className="pr-k">{W.sheet} <span>({W.pages(pages.length)})</span></p>
          <PageSvg product={product} layout={layout} items={pages[0]} font={font} className="pr-page-thumb" label={W.sheet} />
        </div>
      </div>

      <div className="pr-actions">
        {canPrintDocument && (
          <Button type="button" className="btn-grad-primary" onClick={() => window.print()} data-printable-print="">{W.print}</Button>
        )}
        <Button type="button" variant={canPrintDocument ? "outline" : "default"} className={canPrintDocument ? "" : "btn-grad-primary"} disabled={saving} onClick={() => void savePdf()} data-printable-pdf="">
          {saving ? W.saving : W.savePdf}
        </Button>
      </div>
      {err && <p className="pr-err" role="alert">{err}</p>}
      <p className="pr-note">{W.printTip(product.unit)}</p>

      {typeof document !== "undefined" &&
        createPortal(
          <div className="lh-print-root" aria-hidden="true" data-printable-print-root="">
            {pages.map((items, i) => (
              <PageSvg key={i} product={product} layout={layout} items={items} font={font} className="lh-print-page" label={`${W.sheet} ${i + 1}`} />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

const fontFaces = NAME_FONTS.filter((f) => f.file)
  .map((f) => `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url("${f.file}") format("woff2")}`)
  .join("");

/** The maker's own styles, in its lazy chunk; the print rules print only the pages. */
const MAKER_CSS = `${fontFaces}
.pr-maker{display:grid;gap:14px}
.pr-set{border:0;margin:0;padding:0;min-width:0}
.pr-set>legend{font-size:13px;font-weight:700;color:var(--gg-ink);margin:0 0 8px;padding:0}
/* Every design in a wrapping grid (owner 2026-11-21: the sideways row hid the rest): 3 a row on a phone, 6-8 on a desktop. */
.pr-hint{font-size:12.5px;color:var(--gg-muted);margin:-4px 0 8px}
.pr-designs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:2px}
@media (min-width:480px){.pr-designs{grid-template-columns:repeat(auto-fill,minmax(84px,1fr))}}
.pr-design-cell{position:relative;min-width:0;border:2px solid transparent;border-radius:12px}
.pr-design-cell.is-on{border-color:var(--gg-olive);background:var(--gg-soft)}
.pr-maker .pr-design{display:flex;flex-direction:column;align-items:center;gap:6px;padding:6px;cursor:pointer;font-size:12px;line-height:1.25;text-align:center;margin:0;font-weight:600;color:var(--gg-ink);-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.pr-design img{display:block;width:auto;height:72px;max-width:100%;object-fit:contain;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.12);-webkit-touch-callout:none;pointer-events:none}
.pr-maker .pr-design:focus-within{outline:2px solid var(--gg-olive);outline-offset:0;border-radius:10px}
.pr-chip:focus-within{outline:2px solid var(--gg-olive);outline-offset:2px}
/* The magnifier: a 44 px hit box (the app's tap floor) drawn as a small 28 px dot in the cell's corner, so it never hides the tag. */
.pr-maker .pr-zoom{position:absolute;top:-6px;right:-4px;background:transparent;color:var(--gg-ink)}
.pr-zoom-dot{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:hsl(var(--card));border:1px solid var(--gg-line);box-shadow:0 1px 3px rgba(0,0,0,.14)}
.pr-zoom:hover .pr-zoom-dot{border-color:var(--gg-olive)}
.pr-zoom:focus-visible{outline:none}
.pr-zoom:focus-visible .pr-zoom-dot{outline:2px solid var(--gg-olive);outline-offset:2px}
.pr-zoom-img{display:block;width:100%;height:auto;max-height:min(55vh,560px);object-fit:contain;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.12)}
.pr-chips{display:flex;flex-wrap:wrap;gap:8px}
.pr-maker .pr-chip{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid var(--gg-line);border-radius:999px;cursor:pointer;font-size:20px;color:var(--gg-ink);background:hsl(var(--card));margin:0}
.pr-maker .pr-chip-plain{font:600 14px Montserrat,sans-serif}
.pr-maker .pr-chip.is-on{border-color:var(--gg-olive);background:var(--gg-soft)}
.pr-maker .pr-check,.pr-maker .pr-radio{display:flex;align-items:center;gap:10px;min-height:44px;font-size:14px;font-weight:500;color:var(--gg-ink);cursor:pointer;margin:0}
.pr-modes{display:grid;gap:0;margin:0 0 6px}
.pr-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.pr-fields label{display:block;font-size:13px;font-weight:600;margin:0 0 6px;color:var(--gg-ink)}
.pr-rows{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.pr-row{display:flex;gap:6px;align-items:center;min-width:0}
.pr-row>input{flex:1;min-width:0}
.pr-row-n{flex:none;width:18px;font-size:12px;font-weight:700;color:var(--gg-muted);text-align:right}
.pr-x{flex:none;color:var(--gg-muted);font-size:22px}
.pr-previews{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:14px;align-items:start}
.pr-previews.is-one{grid-template-columns:minmax(0,1fr);max-width:360px}
.pr-previews.is-one .pr-one-wrap{display:none}
@media (max-width:419px){.pr-previews{grid-template-columns:minmax(0,1fr)}.pr-one{max-width:260px;margin:0 auto}}
.pr-k{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gg-muted);margin:0 0 6px}
.pr-k span{text-transform:none;letter-spacing:0;font-weight:600}
.pr-one{display:block;width:100%;height:auto;max-height:420px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.12)}
.pr-page-thumb{display:block;width:100%;height:auto;border:1px solid var(--gg-line);border-radius:4px;background:#fff}
.pr-actions{display:flex;flex-wrap:wrap;gap:8px}
.pr-err{color:hsl(var(--destructive-ink));font-size:13px;font-weight:600;margin:0}
.pr-note{color:var(--gg-muted);font-size:12px;margin:0}
/* The cut lines (a class, not attributes: icon stroke weights are ratcheted, src/test/typeAndIconScaleRatchet.test.ts). */
.pr-cut{fill:none;stroke:#8a8a8a;stroke-width:0.7;stroke-dasharray:5 4}
.lh-print-root{display:none}
@media print{
  @page{size:letter portrait;margin:0.5in}
  html,body{height:auto!important;min-height:0!important;overflow:visible!important;background:#fff!important;padding:0!important;margin:0!important}
  body>*:not(.lh-print-root){display:none!important}
  .lh-print-root{display:block!important}
  .lh-print-root{font-size:0;line-height:0}
  .lh-print-page{display:block;width:7.5in;height:10in;overflow:hidden}
  .lh-print-page+.lh-print-page{break-before:page;page-break-before:always}
}
`;
