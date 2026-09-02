/**
 * The Helpr document letterhead — ONE implementation, shared by every PDF the
 * app hands a third party.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `/work-record` shipped the first of these documents and, with it, a whole
 * house style: the wrought-iron crest, the Times-BoldItalic wordmark with its
 * Burnt-Sienna "· LA" tail, the warm hairlines, the bark-tinted section band,
 * the letter-format geometry. `/home-history` is the poster-side twin of that
 * screen — same `.doc-card` surface in the app, same "hand this to somebody"
 * purpose (a buyer, an insurer, an appraiser) — so it must hand over a document
 * that is visibly the same company's. Copying 60 lines of jsPDF drawing into a
 * second file is how two records end up with two letterheads and one of them
 * quietly stops matching the app; every one of the constants below was
 * originally a local in `workRecordDocument.ts`, and this module is those exact
 * values, moved rather than re-derived.
 *
 * No React, no Capacitor, no `@/` aliases — the bytes that get shared can be
 * generated and inspected outside a browser. The staging + share-sheet half
 * lives in `shareFileNative` (nativeShare.ts).
 */
import type jsPDFType from "jspdf";
import { HELPR_MARK_PNG, HELPR_MARK_PX } from "./helprMarkPng";

/** ASCII only in any string handed to these helpers. jsPDF's built-in
 *  Helvetica/Times are Latin-1, so a smart quote, an en dash or a star glyph
 *  renders as mojibake on the one document that has to look official. The
 *  interpunct (U+00B7) is the single exception — Latin-1 has it at 0xB7. */

export type RGB = readonly [number, number, number];

/**
 * THE DOCUMENT'S PALETTE — the app's tokens, resolved to RGB.
 *
 * jsPDF has no CSS, so the tokens are inlined here with the token they came
 * from named beside them. All are the LIGHT-mode values on purpose: a PDF has
 * one appearance, and it is printed on white paper.
 */
export const INK: RGB = [35, 35, 26]; // --ink-deep   hsl(64 16% 12%)
export const MUTED: RGB = [100, 102, 84]; // --olivewood, lightened to ~5.9:1 on white
export const RULE: RGB = [214, 211, 200]; // warm hairline, not a neutral grey
export const BARK: RGB = [94, 101, 68]; // --bark       #5E6544
export const SIENNA: RGB = [152, 66, 22]; // --burnt-sienna #984216
export const BAND: RGB = [240, 241, 235]; // --bark at ~8% over white

export const PAGE_W = 612;
export const PAGE_H = 792;
export const MARGIN = 54;
export const CONTENT_W = PAGE_W - MARGIN * 2;

/** Where the verification line points. One address, same as the app's. */
export const VERIFICATION_EMAIL = "admin@louisianahelpr.com";

export interface PdfFile {
  fileName: string;
  /** Base64 WITHOUT a `data:` prefix — what Filesystem.writeFile wants. */
  base64: string;
  /** The same bytes, for the web `<a download>` branch. */
  blob: Blob;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return binary.length === 0 ? "" : btoa(binary);
}

/** The drawing primitives every Helpr document shares. */
export interface PdfKit {
  doc: jsPDFType;
  /** `setTextColor` takes three channels; the palette is tuples. */
  ink: (c: RGB) => void;
  /** A warm hairline across the content column. */
  rule: (y: number) => void;
  /** A small uppercase field label. */
  label: (text: string, x: number, y: number) => void;
  /** A bark-on-bark-tint section header band. Returns the y of its bottom rule. */
  band: (text: string, y: number) => number;
  /**
   * Fit `text` into `maxW`: shrink from `start` to `min`, then wrap.
   *
   * The measuring MUST happen with the font already set. jsPDF's
   * `getTextWidth`/`splitTextToSize` read the document's CURRENT font state,
   * and an earlier draft split at the 7.5pt label size and then drew at 11pt —
   * so "Maximiliana Guillory-Thibodeaux III" was measured as fitting and
   * rendered straight through the "ID verified by Stripe" column next to it.
   * Caught by rendering the PDF, not by reading the code.
   */
  fitLines: (text: string, maxW: number, start: number, min: number) => { lines: string[]; size: number };
}

/**
 * Build a letter-format document and draw the Helpr letterhead on it.
 *
 * jsPDF is ~450KB and is already a dependency (the tax export uses it); the
 * dynamic import keeps it off the critical path of every page that merely
 * OFFERS an export. It is imported inside this function rather than at module
 * scope so opening a page does not pay for a document nobody has asked to
 * share yet.
 *
 * Returns the kit plus `y`, the baseline the caller's first section may start
 * at — so a document never hardcodes a number that only holds while the
 * masthead keeps its current height.
 */
export async function createLetterheadPdf(
  title: string,
  generatedLine: string,
): Promise<PdfKit & { y: number }> {
  const { default: jsPDF } = await import("jspdf");
  const doc: jsPDFType = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

  const ink = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

  const rule = (y: number) => {
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  };

  const label = (text: string, x: number, y: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    ink(MUTED);
    doc.text(text.toUpperCase(), x, y, { charSpace: 0.6 });
  };

  const band = (text: string, y: number) => {
    doc.setFillColor(BAND[0], BAND[1], BAND[2]);
    doc.rect(MARGIN, y, CONTENT_W, 22, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    ink(BARK);
    doc.text(text.toUpperCase(), MARGIN + 10, y + 15, { charSpace: 1.2 });
    rule(y + 22);
    return y + 22;
  };

  const fitLines = (text: string, maxW: number, start: number, min: number) => {
    doc.setFont("helvetica", "bold");
    for (let size = start; size >= min; size -= 0.5) {
      doc.setFontSize(size);
      if (doc.getTextWidth(text) <= maxW) return { lines: [text], size };
    }
    doc.setFontSize(min);
    return { lines: doc.splitTextToSize(text, maxW) as string[], size: min };
  };

  // ==========================================================================
  // LETTERHEAD — the crest, the wordmark, the title.
  //
  //  1. THE CREST IS THE MARK. `HELPR_MARK_PNG` is the wrought-iron H — the
  //     one the owner has twice asked for by name ("Emails should use the h
  //     logo") and the one on the app-lock screen. Drawn at its true aspect
  //     ratio from `HELPR_MARK_PX`, never a guessed box, so it cannot squash.
  //  2. THE WORDMARK IS SET IN A SERIF ITALIC. In the app "Helpr" is italic EB
  //     Garamond with a Burnt-Sienna "- LA" tail (see HelprMark.tsx). jsPDF
  //     ships only the standard 14 faces, and embedding EB Garamond would mean
  //     `addFileToVFS` + `addFont` and a ~200KB base64 font subset in the
  //     chunk, for one export, on a path that must also work offline. Times
  //     BoldItalic is a real serif italic, costs ZERO bytes because every PDF
  //     reader has it, and cannot fall back to tofu in whatever ancient
  //     Acrobat a leasing office runs.
  //  3. COLOUR. Bark on the section band, Burnt Sienna on the LA tail, warm
  //     hairlines. Enough to read as Helpr, not so much that a landlord thinks
  //     he is holding an advert.
  // ==========================================================================
  const MARK_H = 30;
  const MARK_W = (HELPR_MARK_PX.width / HELPR_MARK_PX.height) * MARK_H;
  doc.addImage(HELPR_MARK_PNG, "PNG", MARGIN, 52, MARK_W, MARK_H);

  const wordmarkX = MARGIN + MARK_W + 10;
  doc.setFont("times", "bolditalic");
  doc.setFontSize(25);
  ink(INK);
  doc.text("Helpr", wordmarkX, 78);
  // MEASURE WHILE THE WORDMARK'S FONT IS STILL SET. `getTextWidth` reads the
  // document's CURRENT font and size — the same trap `fitLines` above
  // documents — so measuring after the switch to 12pt italic would place the
  // tail on top of the "r".
  const wordmarkW = doc.getTextWidth("Helpr");

  // The "· LA" tail, on the wordmark's baseline — the same Burnt-Sienna
  // suffix HelprMark.tsx renders in the app.
  //
  // The interpunct is the ONE non-ASCII character on this page, and it is safe
  // where a smart quote or an en dash is not: jsPDF's built-in faces encode
  // through WinAnsi/Latin-1, which has U+00B7 at 0xB7. An en dash (U+2013) has
  // no Latin-1 slot at all. If a future edit adds another non-ASCII glyph,
  // RENDER THE PDF and look — the failure is a silently wrong glyph, not an
  // exception.
  doc.setFont("times", "italic");
  doc.setFontSize(12);
  ink(SIENNA);
  doc.text("· LA", wordmarkX + wordmarkW + 7, 78, { charSpace: 1.6 });

  doc.setFont("times", "bolditalic");
  doc.setFontSize(18);
  ink(INK);
  doc.text(title, MARGIN, 112);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  ink(MUTED);
  doc.text(generatedLine, MARGIN, 128);

  rule(146);

  return { doc, ink, rule, label, band, fitLines, y: 146 };
}

/** Serialise the document once, into both shapes `shareFileNative` needs. */
export function finishPdf(doc: jsPDFType, fileName: string): PdfFile {
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  return {
    fileName,
    base64: toBase64(bytes),
    blob: new Blob([bytes], { type: "application/pdf" }),
  };
}
