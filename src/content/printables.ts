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
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";

/** One rectangle on a design, in inches from its top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the name sits in the box (default "center"). */
  align?: "left" | "center";
}

/** Each design set's name in the picker. */
export const DESIGN_SETS = { "vintage-scallop": "Vintage scallops (9 tags)" } as const;

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
  /** The id of the product layout this design prints on (gift tags: "10" wide, "9" the rest). Default: the chosen one. */
  layout?: string;
  /**
   * The set it belongs to (holiday audit 1121 area 5 #19: the 9 vintage scallop tags, split from one sheet, took 9 of
   * the picker's 22 slots). The picker shows a set once, under DESIGN_SETS' name; picking it prints its tags in turn.
   */
  set?: keyof typeof DESIGN_SETS;
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
  /** Shrink the items (never grow them) until the grid fits the page: 9 tall tags or 9 postcards on one sheet. */
  fit?: boolean;
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
  /** Holiday audit 1121 area 5 #12: a card holding two books shows both covers (the boys' book sat beside a girl's cover). */
  previews?: string[];
  /** Which group the card sits in on the page (owner 2026-11-21: "a subsection for tags, banner and color books so it's not all mixed up"). Default "more". */
  section?: "coloring" | "banners" | "more";
  /** One button per file: the 12-, 24- and 25-day elf plans each get one. */
  files: { label: string; href: string }[];
  guides: string[];
  /** A link under the button (the planner sheet links the online planner; the checklist links Declutter). */
  cta?: { to: string; label: string };
  /** A store that prints it (the banner: Walgreens posters), opened in a new tab. A plain link, not an affiliate one. */
  printAt?: { href: string; label: string };
}

export type Printable = OverlayProduct | DownloadProduct;

export const PRINTABLES_PATH = "/gift-guides/printables" as const;

/**
 * Each kind of printable is its own page (owner 2026-11-21: "coloring book and banner should have their own page"):
 * the name makers (gift tags) on /gift-guides/printables/gift-tags, the coloring books and the banners on theirs. The
 * old /gift-guides/printables address lands on the page its #anchor names (else Gift tags), so old links keep working.
 */
export const PRINTABLE_PAGES = [
  { key: "tags", path: "/gift-guides/printables/gift-tags", label: "Gift tags", oldAnchors: ["pr-tags", "gift-tags", "santa-letter", "thank-you-cards"] },
  { key: "coloring", path: "/gift-guides/printables/coloring-books", label: "Coloring books", oldAnchors: ["pr-coloring", "coloring-book"] },
  { key: "banners", path: "/gift-guides/printables/banners", label: "Banners", oldAnchors: ["pr-banners", "thanksgiving-banner"] },
] as const;
export type PrintablePageKey = (typeof PRINTABLE_PAGES)[number]["key"];
export type PrintablePagePath = (typeof PRINTABLE_PAGES)[number]["path"];

/** The page a printable lives on: a name maker on Gift tags, a download on its section's page ("more" on Gift tags). */
const pageOfPrintable = (p: Printable): PrintablePageKey => (p.kind === "download" && (p.section === "coloring" || p.section === "banners") ? p.section : "tags");

/** The printables shown on one page. */
export const printablesOnPage = (key: PrintablePageKey, list: Printable[] = PRINTABLES) => shownPrintables(list).filter((p) => pageOfPrintable(p) === key);

/** The page path for a printable (a link to it lands on its page, at its card). */
export const printablePath = (p: Printable) => `${PRINTABLE_PAGES.find((x) => x.key === pageOfPrintable(p))!.path}#${p.id}`;

/** Where an old /gift-guides/printables#<anchor> link lands now. */
export const printablesRedirect = (hash: string) => {
  const anchor = hash.replace(/^#/, "");
  const page = PRINTABLE_PAGES.find((x) => (x.oldAnchors as readonly string[]).includes(anchor)) ?? PRINTABLE_PAGES[0];
  const keep = anchor && !anchor.startsWith("pr-") ? `#${anchor}` : "";
  return `${page.path}${keep}`;
};

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
    blurb: "Pick a tag, type the names, and print a sheet of 9 or 10 with cut lines.",
    ready: true,
    // Each design names its own size and its sheet (src/content/printableTagDesigns.ts).
    size: { w: 3.5, h: 2 },
    fields: TO_FROM,
    // The owner's sheets: wide 3.5 x 2 in tags 10 to a page (2 across, 5 down) at real size; tall, square, the split
    // vintage tags and the postcard 9 to a page (3 x 3), shrunk only as much as the page needs.
    layouts: [
      { id: "10", label: "10 per page", cols: 2, rows: 5, rotate: false, scale: 1, cutLines: true },
      { id: "9", label: "9 per page", cols: 3, rows: 3, rotate: false, scale: 1, fit: true, cutLines: true },
    ],
    mix: true,
    unit: "tag",
    // The owner's Canva tags (src/content/printableTagDesigns.ts).
    designs: OWNER_TAGS,
    // Owner 2026-11-21 ("remove from her, they already have their own section"): no printables on Her, Him or Kids
    // (this reverses holiday audit 1121 #49); they live under Free printables in the menu.
    guides: ["gift-wrap-and-cards"],
  },
  {
    kind: "overlay",
    id: "santa-letter",
    title: "Letter to Santa and Nice List",
    blurb: "Type your child's name for a letter to Santa or a Nice List certificate.",
    // Hidden: the owner designs every printable herself; the Nice List below is a stand-in until hers arrives.
    ready: false,
    size: { w: 8.5, h: 11 },
    fields: [{ key: "name", label: "Child's name", placeholder: "Mia" }],
    layouts: [{ id: "1", label: "1 per page", cols: 1, rows: 1, rotate: false, scale: 0.88, cutLines: false }],
    mix: true,
    unit: "page",
    // One stand-in until the owner's letter and certificate arrive (Santa-letter-Nice-list/).
    designs: [
      { id: "nice-list", name: "Nice List", image: "/printables/santa/nice-list.svg", boxes: { name: { x: 1.25, y: 4.55, w: 6, h: 1.1 } }, ink: SITE_RED, labels: false, siteLine: false },
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
    section: "coloring",
    title: "Christmas coloring book",
    blurb: "20 simple pages to color plus a cover, ready to print at home.",
    // Owner 2026-11-21: "both color books are ready for launch" (Boys approved first, then Girls).
    ready: true,
    preview: "/printables/coloring-book/preview-girls.webp",
    previews: ["/printables/coloring-book/preview-girls.webp", "/printables/coloring-book/preview-boys.webp"],
    // Guides polish 1122 #31: plain button names; the blurb says how long each book is (both PDFs: 21 pages, a cover and 20 to color).
    files: [
      { label: "Girls book", href: "/printables/coloring-book/christmas-coloring-book-girls.pdf" },
      { label: "Boys book", href: "/printables/coloring-book/christmas-coloring-book-boys.pdf" },
    ],
    // Owner 2026-11-21: not linked from Kids (it reversed holiday audit 1121 #49); the Coloring books page has them.
    guides: [],
  },
  {
    kind: "download",
    id: "merry-christmas-red-stripe",
    section: "banners",
    title: "Merry Christmas (red stripe)",
    blurb: "Print it as a 12x18 poster at Walgreens, from about $13, same-day pickup.",
    ready: true,
    preview: "/printables/merry-christmas-red-stripe/preview.webp",
    files: [
      { label: "12x18 print", href: "/printables/merry-christmas-red-stripe/merry-christmas-red-stripe-banner-12x18.jpg" },
      { label: "Wide banner", href: "/printables/merry-christmas-red-stripe/merry-christmas-red-stripe-banner.jpg" },
    ],
    printAt: { href: "https://photo.walgreens.com/store/posters", label: "Print at Walgreens" },
    guides: [],
  },
  {
    kind: "download",
    id: "merry-christmas-green-stripe",
    section: "banners",
    title: "Merry Christmas (green stripe)",
    blurb: "Print it as a 12x18 poster at Walgreens, from about $13, same-day pickup.",
    // Owner 2026-11-22: her Canva banners, newest first (scripts/printables-banner-add.py makes the files).
    ready: true,
    preview: "/printables/merry-christmas-green-stripe/preview.webp",
    files: [
      { label: "12x18 print", href: "/printables/merry-christmas-green-stripe/merry-christmas-green-stripe-banner-12x18.jpg" },
      { label: "Wide banner", href: "/printables/merry-christmas-green-stripe/merry-christmas-green-stripe-banner.jpg" },
    ],
    printAt: { href: "https://photo.walgreens.com/store/posters", label: "Print at Walgreens" },
    guides: [],
  },
  {
    kind: "download",
    id: "merry-christmas-plaid",
    section: "banners",
    title: "Merry Christmas (plaid)",
    blurb: "Print it as a 12x18 poster at Walgreens, from about $13, same-day pickup.",
    // Owner 2026-11-22: her Canva banners, newest first (scripts/printables-banner-add.py makes the files).
    ready: true,
    preview: "/printables/merry-christmas-plaid/preview.webp",
    files: [
      { label: "12x18 print", href: "/printables/merry-christmas-plaid/merry-christmas-plaid-banner-12x18.jpg" },
      { label: "Wide banner", href: "/printables/merry-christmas-plaid/merry-christmas-plaid-banner.jpg" },
    ],
    printAt: { href: "https://photo.walgreens.com/store/posters", label: "Print at Walgreens" },
    guides: [],
  },
  {
    kind: "download",
    id: "thanksgiving-banner",
    section: "banners",
    title: "Happy Thanksgiving banner",
    // Owner 2026-11-21 (relayed by the lead): Walgreens posters come 11x14, 12x18, 16x20, 20x30 and 24x36 from $12.99
    // with same-day pickup, and no 12 x 24, so the old "a 12 x 24 in print fits it" was wrong.
    blurb: "Print it as a 12x18 poster at Walgreens, from about $13, same-day pickup.",
    // Owner 2026-11-21: "add this to the free printables, it's a banner they can print at walgreens" (her Canva design).
    ready: true,
    preview: "/printables/thanksgiving-banner/preview.webp",
    // Owner 2026-11-21: "Download the banner (free)" overflowed (guides polish 1122 #31: "(free)" repeats the page, "2:1" is jargon) its button at the card's width; the card's title says what it is.
    // The 12 x 18 copy is the design untouched on its own white, padded to 3:2 (scripts/printables-banner-12x18.py), so a
    // Walgreens poster does not crop it; the original 2:1 file stays. Its button names the size, not "Poster size":
    // copy never says "poster" (src/test/roleNeutralCopy.test.ts reads it as the job role).
    files: [
      { label: "12x18 print", href: "/printables/thanksgiving-banner/happy-thanksgiving-banner-12x18.jpg" },
      { label: "Wide banner", href: "/printables/thanksgiving-banner/happy-thanksgiving-banner.jpg" },
    ],
    printAt: { href: "https://photo.walgreens.com/store/posters", label: "Print at Walgreens" },
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
    cta: { to: SELL_CHOOSER_PATH, label: "Sell what you clear out on Declutter" },
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

/** The sheet a design prints on: the one it names, else the chosen one (the product's first by default). */
export const layoutFor = (p: OverlayProduct, d: OverlayDesign | undefined, chosen = 0): SheetLayout =>
  p.layouts.find((l) => l.id === d?.layout) ?? p.layouts[chosen] ?? p.layouts[0];

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
  let feet = sizes.map((s) => footprint(s, layout));
  let scale = layout.scale;
  if (layout.fit && feet.length) {
    const k = Math.min(1, PAGE.w / (Math.max(...feet.map((f) => f.w)) * layout.cols), PAGE.h / (Math.max(...feet.map((f) => f.h)) * layout.rows));
    if (k < 1) {
      scale *= k;
      feet = sizes.map((s) => footprint(s, { ...layout, scale }));
    }
  }
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
    return { x: x0 + c * cw + (cw - f.w) / 2, y: y0 + r * ch + (ch - f.h) / 2, w: f.w, h: f.h, rotate: f.rotate, scale };
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
/** The designs the picker shows: each set once (its first tag, named for the set), every other design as itself. */
export function pickerDesigns(p: OverlayProduct): OverlayDesign[] {
  const seen = new Set<string>();
  return p.designs.flatMap((d) => {
    if (!d.set) return [d];
    if (seen.has(d.set)) return [];
    seen.add(d.set);
    return [{ ...d, name: DESIGN_SETS[d.set] }];
  });
}

export function sheetPages(p: OverlayProduct, perPage: number, opts: { mode: "same" | "each"; same: Names; rows: Names[]; designId: string; mixDesigns: boolean }): SheetItem[][] {
  const chosen = p.designs.find((d) => d.id === opts.designId) ?? p.designs[0];
  if (!chosen) return [];
  // Mixing cycles only the designs that print on the same sheet at the same size as the chosen one.
  const size = designSize(p, chosen);
  const group = p.designs.filter((d) => d.layout === chosen.layout && designSize(p, d).w === size.w && designSize(p, d).h === size.h);
  // A set (#19) prints its own tags in turn, as the sheet they were cut from did.
  const set = chosen.set ? p.designs.filter((d) => d.set === chosen.set) : [];
  const designAt = (i: number) =>
    opts.mixDesigns && group.length > 1 ? group[(group.indexOf(chosen) + i) % group.length]
    : set.length > 1 ? set[(set.indexOf(chosen) + i) % set.length]
    : chosen;
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
  /** Section headings on the page (owner 2026-11-21). */
  sectionTags: "Gift tags",
  // Each kind's own page (owner 2026-11-21: "coloring book and banner should have their own page").
  tagsTitle: "Free gift tags",
  coloringTitle: "Free coloring books",
  bannersTitle: "Free banners",
  sectionColoring: "Coloring books",
  sectionBanners: "Banners",
  design: "Design",
  designHint: "Pick a design. Press and hold one, or use its magnifier, to see it bigger.",
  zoom: (name: string) => `Bigger look at ${name}`,
  useDesign: "Use this design",
  close: "Close",
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
