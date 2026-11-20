/**
 * Free holiday printables (owner 2026-11-20), /gift-guides/printables. The owner designs every printable in Canva and
 * drops the exports in ~/Desktop/Printables/<folder> (README.txt there); this file is the ONE place they are listed.
 *
 * Two kinds:
 * - "overlay": the shopper types names and we draw them over a blank area of the owner's design (gift tags, the Santa
 *   letter / Nice List, thank-you cards). Each design names its picture and, for each name, the box the name is drawn
 *   in (inches from the design's top-left corner). Everything happens in the browser: no account, nothing saved.
 * - "download": a ready-made PDF (coloring book, elf kit, planner sheet, recipe cards, declutter checklist).
 *
 * A card shows only when its `ready` is true AND its files are listed (an overlay needs at least one design, a download
 * at least one file). Ship a new printable hidden with `ready: false`; flip it when the owner's file is in public/printables.
 *
 * HOW TO ADD A DESIGN (owner): put the picture (a JPEG of the Canva PNG, under 300 KB) in public/printables/<folder>/
 * and add one entry to that product's `designs` (gift tags: src/content/printableTagDesigns.ts) with the file name and
 * where each name goes, in inches from the top-left corner of the design (x = across, y = down, w = width, h = height).
 * Guard: src/test/printables1120.test.tsx.
 */

import { OWNER_TAGS } from "./printableTagDesigns";

/** One rectangle on a design, in inches from its top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the name sits in the box (default "center"). */
  align?: "left" | "center";
}

export interface OverlayDesign {
  id: string;
  /** What the picker says, e.g. "Red gingham". */
  name: string;
  /** The design's full-size picture under public/, e.g. "/printables/tags/brown-elegant-christmas.jpg" (Canva export at 288-300 dpi). */
  image: string;
  /** A small WebP for the picker (the full-size picture loads only for the preview and the printout). Default: image. */
  thumb?: string;
  /** This design's size in inches when it is not the product's (a landscape 3.5 x 2.5 tag among portrait ones). */
  size?: { w: number; h: number };
  /** For each of the product's field keys: the blank area its name is drawn in. */
  boxes: Record<string, Box>;
  /** The names' color. */
  ink: string;
  /** Draw "To:" / "From:" before the names (false when the design already prints them). Default true. */
  labels?: boolean;
  /**
   * The small louisianahelpr.com line: its baseline in inches from the top, its color, and its middle in inches from the
   * left (default: the middle of the design); false when the design prints it itself.
   */
  siteLine?: { y: number; color: string; x?: number } | false;
}

interface OverlayField {
  key: string;
  /** The form label. */
  label: string;
  /** Drawn before the name on the printable when the design's `labels` is on, e.g. "To:". */
  prefix?: string;
  placeholder: string;
}

/** How items sit on a letter page (portrait, 0.5 in margins: a 7.5 x 10 in area every printer prints). */
export interface SheetLayout {
  id: string;
  label: string;
  cols: number;
  rows: number;
  /**
   * Turn each item a quarter turn so it fits: always, never, or only a portrait design ("portrait": a sheet of 3.5 x 2.5 in
   * slots, 2 across and 4 down, takes landscape tags as they are and portrait 2.5 x 3.5 in tags turned).
   */
  rotate: boolean | "portrait";
  /** Printed size = design size x scale. */
  scale: number;
  /** Dashed cut lines around each item. */
  cutLines: boolean;
}

export interface OverlayProduct {
  kind: "overlay";
  id: string;
  title: string;
  blurb: string;
  ready: boolean;
  /** The designs' size in inches (a design may name its own, e.g. landscape tags). */
  size: { w: number; h: number };
  fields: OverlayField[];
  layouts: SheetLayout[];
  /** A different name on each item is allowed (one tag per family member). */
  mix: boolean;
  /** What one item is called: "tag", "letter", "card". */
  unit: string;
  designs: OverlayDesign[];
  /** Gift guides that link here once ready (slug). */
  guides: string[];
}

export interface DownloadProduct {
  kind: "download";
  id: string;
  title: string;
  blurb: string;
  ready: boolean;
  /** A small picture of the first page, under public/. */
  preview: string;
  /** One button per file: the 12-, 24- and 25-day elf plans each get one. */
  files: { label: string; href: string }[];
  guides: string[];
  /** A link under the button (the planner sheet links the online planner; the checklist links Declutter). */
  cta?: { to: string; label: string };
}

export type Printable = OverlayProduct | DownloadProduct;

export const PRINTABLES_PATH = "/gift-guides/printables" as const;

/** Self-hosted name fonts (public/fonts, never loaded from Google). The tag maker declares the two new faces itself. */
export const NAME_FONTS = [
  { id: "script", label: "Script", family: "LH Dancing Script", style: "normal", weight: 700, file: "/fonts/dancing-script-latin-700.woff2" },
  { id: "festive", label: "Festive", family: "LH Mountains of Christmas", style: "normal", weight: 700, file: "/fonts/mountains-of-christmas-latin-700.woff2" },
  // Already on the site (src/index.css): the landing's serif.
  { id: "classic", label: "Classic", family: "Bodoni Moda", style: "italic", weight: 700, file: null },
] as const;
export type NameFontId = (typeof NAME_FONTS)[number]["id"];

const SITE_RED = "#8f2f2a";

const TO_FROM: OverlayField[] = [
  { key: "to", label: "To", prefix: "To:", placeholder: "Mia" },
  { key: "from", label: "From", prefix: "From:", placeholder: "Aunt Lexi" },
];

export const PRINTABLES: Printable[] = [
  {
    kind: "overlay",
    id: "gift-tags",
    title: "Gift tags with names",
    blurb: "Pick a tag, type the names, and print a sheet of 8 with cut lines.",
    ready: true,
    // The owner's tags are 3.5 x 2 in (a few 2 x 3.5 in, turned on the sheet); each design names its own size.
    size: { w: 3.5, h: 2 },
    fields: TO_FROM,
    // 2 across, 4 down: landscape tags as they are, portrait ones turned, every tag at its real size.
    layouts: [{ id: "8", label: "8 per page", cols: 2, rows: 4, rotate: "portrait", scale: 1, cutLines: true }],
    mix: true,
    unit: "tag",
    // The owner's Canva tags (src/content/printableTagDesigns.ts).
    designs: OWNER_TAGS,
    guides: ["gift-wrap-and-cards"],
  },
  {
    kind: "overlay",
    id: "santa-letter",
    title: "Letter to Santa and Nice List",
    blurb: "Type your child's name for a letter to Santa or a Nice List certificate.",
    ready: true,
    size: { w: 8.5, h: 11 },
    fields: [{ key: "name", label: "Child's name", placeholder: "Mia" }],
    layouts: [{ id: "1", label: "1 per page", cols: 1, rows: 1, rotate: false, scale: 0.88, cutLines: false }],
    mix: true,
    unit: "page",
    // One stand-in until the owner's letter and certificate arrive (Santa-letter-Nice-list/).
    designs: [
      { id: "nice-list", name: "Nice List", image: "/printables/santa/nice-list.svg", boxes: { name: { x: 1.25, y: 4.55, w: 6, h: 1.1 } }, ink: SITE_RED, labels: false, siteLine: { y: 10.55, color: "#7b6a55" } },
    ],
    guides: [],
  },
  {
    kind: "overlay",
    id: "thank-you-cards",
    title: "Thank-you cards",
    blurb: "Teacher and nurse thank-you cards with names, 2 or 4 to a page.",
    ready: false,
    size: { w: 4.25, h: 5.5 },
    fields: TO_FROM,
    layouts: [
      { id: "4", label: "4 per page", cols: 2, rows: 2, rotate: false, scale: 0.88, cutLines: true },
      { id: "2", label: "2 per page", cols: 1, rows: 2, rotate: true, scale: 1.15, cutLines: true },
    ],
    mix: true,
    unit: "card",
    designs: [],
    guides: ["educators", "healthcare"],
  },
  {
    kind: "download",
    id: "coloring-book",
    title: "Christmas coloring book",
    blurb: "Pages to color, ready to print at home.",
    ready: false,
    preview: "/printables/coloring-book/preview.webp",
    files: [{ label: "Download & print (free)", href: "/printables/coloring-book/christmas-coloring-book.pdf" }],
    guides: [],
  },
  {
    kind: "download",
    id: "elf-kit",
    title: "Elf Adventure Kit",
    blurb: "A plan for what your elf does each day, with the supply list and the arrival letter.",
    ready: false,
    preview: "/printables/elf-kit/preview.webp",
    files: [
      { label: "12-day plan", href: "/printables/elf-kit/elf-adventure-kit-12-days.pdf" },
      { label: "24-day plan", href: "/printables/elf-kit/elf-adventure-kit-24-days.pdf" },
      { label: "25-day plan", href: "/printables/elf-kit/elf-adventure-kit-25-days.pdf" },
    ],
    guides: [],
  },
  {
    kind: "download",
    id: "gift-planner-sheet",
    title: "Gift list and budget sheet",
    blurb: "Write down who you're shopping for, gift ideas and what you spent.",
    ready: false,
    preview: "/printables/gift-planner/preview.webp",
    files: [{ label: "Download & print (free)", href: "/printables/gift-planner/gift-list-and-budget.pdf" }],
    guides: [],
    cta: { to: "/gift-guides/planner", label: "Or plan online with the gift planner" },
  },
  {
    kind: "download",
    id: "recipe-cards",
    title: "Louisiana holiday recipe cards",
    blurb: "Holiday favorites from Louisiana kitchens, on cards to print and share.",
    ready: false,
    preview: "/printables/recipe-cards/preview.webp",
    files: [{ label: "Download & print (free)", href: "/printables/recipe-cards/louisiana-holiday-recipe-cards.pdf" }],
    guides: ["home-cook", "louisiana-food-gifts"],
  },
  {
    kind: "download",
    id: "declutter-checklist",
    title: "Clear space before the gifts come",
    blurb: "A room-by-room checklist to make room before Christmas.",
    ready: false,
    preview: "/printables/declutter-checklist/preview.webp",
    files: [{ label: "Download & print (free)", href: "/printables/declutter-checklist/declutter-checklist.pdf" }],
    guides: [],
    cta: { to: "/declutter/sell", label: "Sell what you clear out on Declutter" },
  },
];

/** A printable shows only when it is switched on AND its files are listed. */
export function isShown(p: Printable): boolean {
  if (!p.ready) return false;
  return p.kind === "overlay" ? p.designs.length > 0 : p.files.length > 0;
}

export const shownPrintables = (list: Printable[] = PRINTABLES) => list.filter(isShown);

/** The shown printables a guide links to (its slug in their `guides`). */
export const printablesForGuide = (slug: string, list: Printable[] = PRINTABLES) => shownPrintables(list).filter((p) => p.guides.includes(slug));

// ---------------------------------------------------------------------------------------------------------------
// The sheet: everything in hundredths of an inch, on the 7.5 x 10 in area inside a letter page's 0.5 in margins.

export const PAGE = { w: 750, h: 1000 } as const;

/** A design's size in inches: its own, else its product's. */
export const designSize = (p: OverlayProduct, d: OverlayDesign) => d.size ?? p.size;

/** Where one item sits on the page: its top-left, its printed size, and whether it is turned a quarter turn. */
export interface Slot {
  x: number;
  y: number;
  /** The slot's size on the page (already turned). */
  w: number;
  h: number;
  rotate: boolean;
  scale: number;
}

/** The slots of one page, row by row, centered in the printable area. Throws when the layout does not fit. */
export function sheetSlots(size: { w: number; h: number }, layout: SheetLayout): Slot[] {
  return pageSlots(Array.from({ length: layout.cols * layout.rows }, () => size), layout);
}

/** An item's place on the page before it is positioned: turned or not, and its printed width and height. */
function footprint(size: { w: number; h: number }, layout: SheetLayout) {
  const rotate = layout.rotate === "portrait" ? size.h > size.w : layout.rotate;
  const iw = size.w * 100 * layout.scale;
  const ih = size.h * 100 * layout.scale;
  return { rotate, w: rotate ? ih : iw, h: rotate ? iw : ih };
}

/**
 * The slots of one page for items of these sizes (one per item, in order): a grid of equal cells as big as the largest
 * item, centered in the printable area, each item centered in its cell (a 3.5 x 2 in tag and a 2 x 3.5 in tag turned
 * take the same cell). Throws when the grid does not fit the page.
 */
export function pageSlots(sizes: { w: number; h: number }[], layout: SheetLayout): Slot[] {
  const feet = sizes.map((s) => footprint(s, layout));
  const cw = Math.max(0, ...feet.map((f) => f.w));
  const ch = Math.max(0, ...feet.map((f) => f.h));
  const gw = cw * layout.cols;
  const gh = ch * layout.rows;
  if (gw > PAGE.w + 0.01 || gh > PAGE.h + 0.01) throw new Error(`printables: layout ${layout.id} does not fit a letter page`);
  const x0 = (PAGE.w - gw) / 2;
  const y0 = (PAGE.h - gh) / 2;
  return feet.slice(0, layout.cols * layout.rows).map((f, i) => {
    const c = i % layout.cols;
    const r = Math.floor(i / layout.cols);
    return { x: x0 + c * cw + (cw - f.w) / 2, y: y0 + r * ch + (ch - f.h) / 2, w: f.w, h: f.h, rotate: f.rotate, scale: layout.scale };
  });
}

/** The SVG transform that draws an item (in its own design units) into its slot. */
export function slotTransform(s: Slot): string {
  return s.rotate ? `translate(${s.x + s.w} ${s.y}) rotate(90) scale(${s.scale})` : `translate(${s.x} ${s.y}) scale(${s.scale})`;
}

export type Names = Record<string, string>;
export interface SheetItem {
  design: OverlayDesign;
  names: Names;
}

/** Names as typed, trimmed and cut to fit (no control or direction characters; React escapes the rest). */
export const MAX_NAME = 40;
export function cleanName(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, MAX_NAME);
}

/**
 * The items of the whole printout, page by page. Same names: one full page of copies. A different name on each: one
 * item per filled row (empty rows skipped), pages filled in order. Designs: the chosen one, or every design in turn.
 */
export function sheetPages(p: OverlayProduct, perPage: number, opts: { mode: "same" | "each"; same: Names; rows: Names[]; designId: string; mixDesigns: boolean }): SheetItem[][] {
  const chosen = p.designs.find((d) => d.id === opts.designId) ?? p.designs[0];
  if (!chosen) return [];
  const designAt = (i: number) => (opts.mixDesigns && p.designs.length > 1 ? p.designs[(p.designs.indexOf(chosen) + i) % p.designs.length] : chosen);
  const filled = (n: Names) => p.fields.some((f) => (n[f.key] ?? "").trim() !== "");
  const names: Names[] = opts.mode === "same" ? Array.from({ length: perPage }, () => opts.same) : opts.rows.filter(filled);
  const items = names.map((n, i) => ({ design: designAt(i), names: n }));
  const pages: SheetItem[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages.length ? pages : [[{ design: chosen, names: {} }]];
}

/** How one line of text is drawn in its box: font size, baseline, anchor x, and a squeeze when even the smallest size is too wide. */
export interface FittedLine {
  x: number;
  y: number;
  size: number;
  prefixSize: number;
  anchor: "start" | "middle";
  /**
   * Under 1 when even the smallest size is too wide: the line is drawn narrower by this much, about its anchor (a
   * transform, not SVG textLength, which Safari ignores on text holding a <tspan>).
   */
  squeeze: number;
}

/** The prefix ("To:") is drawn at this share of the name's size, in Montserrat. */
const PREFIX_SHARE = 0.5;
const PREFIX_GAP = 0.25;

/**
 * Fit "prefix name" in a box (design units = hundredths of an inch): as large as the box height allows, smaller until it
 * fits the width, never under 45% of that; past that it is squeezed to the box width (`squeeze`).
 * `measure(text, size, isPrefix)` returns the drawn width at that font size.
 */
export function fitLine(box: Box, prefix: string, name: string, measure: (text: string, size: number, isPrefix: boolean) => number): FittedLine {
  const x = box.x * 100;
  const y = box.y * 100;
  const w = box.w * 100;
  const h = box.h * 100;
  const max = h * 0.78;
  const widthAt = (size: number) => (prefix ? measure(prefix, size * PREFIX_SHARE, true) + size * PREFIX_GAP : 0) + (name ? measure(name, size, false) : 0);
  let size = max;
  const at = widthAt(size);
  if (at > w && at > 0) size = Math.max(max * 0.45, size * (w / at));
  const final = widthAt(size);
  const anchor = box.align === "left" ? "start" : "middle";
  return {
    x: anchor === "start" ? x : x + w / 2,
    // The baseline: the box's middle, lowered by about a third of the size so the letters sit centred.
    y: y + h / 2 + size * 0.32,
    size,
    prefixSize: size * PREFIX_SHARE,
    anchor,
    squeeze: final > w + 0.5 ? w / final : 1,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Words

export const PRINTABLES_WORDS = {
  title: "Free holiday printables",
  lead: "Gift tags with names and more, made by Louisiana Helpr. Type the names, see them on the design, and print at home. Free, no sign-up, nothing saved.",
  tile: { title: "Free printables", body: "Gift tags with names and more, free to print." },
  guideLink: (title: string) => `Free printable: ${title}`,
  make: "Make yours",
  making: "Making",
  moreTitle: "More free printables",
  design: "Design",
  font: "Name style",
  names: "Names",
  modeSame: (unit: string) => (unit === "page" ? "One name" : `Same names on every ${unit}`),
  modeEach: (unit: string) => (unit === "page" ? "Several names, a page for each" : `A different name on each ${unit}`),
  addRow: (unit: string) => `Add another ${unit}`,
  removeRow: (n: number) => `Remove ${n}`,
  rowLabel: (unit: string, n: number) => `${unit[0].toUpperCase()}${unit.slice(1)} ${n}`,
  mixDesigns: "Mix the designs",
  layout: "How many per page",
  preview: "Preview",
  sheet: "Your page",
  pages: (n: number) => (n === 1 ? "1 page" : `${n} pages`),
  print: "Print",
  savePdf: "Save as PDF",
  saving: "Making your PDF…",
  printTip: (unit: string) => `Print at 100% (actual size) on letter paper.${unit === "page" ? "" : " Cardstock works best."}`,
  pdfError: "We couldn't make the PDF. Try Print instead, or try again.",
  loading: "Loading the maker…",
  free: "Free",
  site: "louisianahelpr.com",
} as const;
