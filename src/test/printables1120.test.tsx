/**
 * Free holiday printables (owner 2026-11-20), /gift-guides/printables:
 *   - every layout of every printable fits the 7.5 x 10 in area inside a letter page's margins; the owner's FINAL 22 tags
 *     only; wide tags print 10 to a page at real size, tall/square/split-vintage tags and the postcard 9 (shrunk to fit);
 *   - every design names a picture that exists and a box for each of its product's names, inside the design;
 *   - a printable shows only when it is switched on AND its files are listed; the hidden ones (every download card and the
 *     Santa letter / Nice List stand-in: the owner designs every printable herself) render nothing;
 *   - names: same names fill a page, a different name on each fills pages in order, empty rows skipped, designs mixed;
 *     control and direction characters stripped; a long name shrinks, then is squeezed to the box, never past it;
 *   - the maker draws the typed names and the louisianahelpr.com line on every tag, with cut lines, in the print pages;
 *   - the guides link only the printables that are shown (Gift Wrap & Cards: the tags), and the landing has the tile;
 *   - the page's head says "free printable Christmas gift tags with names".
 *
 * @mutate src/content/printables.ts |   if (!p.ready) return false; |   if (false) return false;
 * @mutate src/content/printables.ts |   if (at > w && at > 0) size = Math.max(max * 0.45, size * (w / at)); |   if (false) size = Math.max(max * 0.45, size * (w / at));
 * @mutate src/content/printables.ts |     squeeze: final > w + 0.5 ? w / final : 1, |     squeeze: 1,
 * @mutate src/content/printables.ts |  : opts.rows.filter(filled); |  : opts.rows;
 * @mutate src/content/printables.ts |   return s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, MAX_NAME); |   return s.slice(0, MAX_NAME);
 * @mutate src/pages/info/giftGuides/printables/NameMaker.tsx |       {site && ( |       {false && (
 * @mutate src/pages/info/giftGuides/printables/NameMaker.tsx |       {layout.cutLines && |       {false &&
 * @mutate src/content/printables.ts |   if (layout.fit && feet.length) { |   if (false) {
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router-dom";
import {
  PAGE,
  layoutFor,
  PRINTABLES,
  cleanName,
  designSize,
  fitLine,
  isShown,
  printablesForGuide,
  printablesRedirect,
  sheetPages,
  sheetSlots,
  shownPrintables,
  type DownloadProduct,
  type OverlayProduct,
} from "@/content/printables";
import { PUBLIC_PAGE_META, NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import NameMaker from "@/pages/info/giftGuides/printables/NameMaker";
import Printables from "@/pages/info/giftGuides/printables/Printables";
import { PrintablesLink } from "@/pages/info/giftGuides/printables/PrintablesLink";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const ROOT = process.cwd();
const overlays = PRINTABLES.filter((p): p is OverlayProduct => p.kind === "overlay");
const downloads = PRINTABLES.filter((p): p is DownloadProduct => p.kind === "download");
const tags = overlays.find((p) => p.id === "gift-tags")!;
const FINAL_TAGS = [
  "red-white-vintage-santa", "cream-red-elegant-illustrated", "red-green-illustrated-watercolor", "green-white-vintage-car",
  "green-pink-blue-watercolor-tree", "holiday-gift-tag-cream-stripes", "red-simple-retro-festive-ribbon", "green-beige-simple-watercolor",
  "beige-red-green-watercolor", ...Array.from({ length: 9 }, (_, i) => `red-green-white-vintage-${i + 1}`), "green-cream-vintage",
  "red-simple-retro-festive-mistletoe-berries", "green-white-minimalist-typography", "red-white-playful-simple",
];

afterEach(() => act(() => cleanup()));

describe("the config", () => {
  it("every layout fits a letter page; wide tags print 10 at real size, the rest 9 shrunk to fit", () => {
    let n = 0;
    for (const p of overlays)
      for (const l of p.layouts) {
        const slots = sheetSlots(p.size, l);
        n++;
        expect(slots.length, `${p.id} ${l.id}`).toBe(l.cols * l.rows);
        for (const s of slots) {
          expect(s.x).toBeGreaterThanOrEqual(-0.01);
          expect(s.y).toBeGreaterThanOrEqual(-0.01);
          expect(s.x + s.w).toBeLessThanOrEqual(PAGE.w + 0.01);
          expect(s.y + s.h).toBeLessThanOrEqual(PAGE.h + 0.01);
        }
      }
    expect(n).toBeGreaterThan(3);
    // The owner's final 22 tags (~/Desktop/Printables/Gift-tags/_tags.json, 2026-11-20), and no others.
    expect(tags.designs.map((d) => d.id).sort()).toEqual(FINAL_TAGS.slice().sort());
    const wideTag = (d: (typeof tags.designs)[number]) => {
      const z = designSize(tags, d);
      return z.w === 3.5 && z.h === 2;
    };
    for (const d of tags.designs) expect(layoutFor(tags, d).id, d.id).toBe(wideTag(d) ? "10" : "9");
    const sizes = Object.fromEntries(tags.designs.map((d) => [d.id, designSize(tags, d)]));
    expect(sizes["green-pink-blue-watercolor-tree"]).toEqual({ w: 2, h: 3.5 });
    expect(sizes["holiday-gift-tag-cream-stripes"]).toEqual({ w: 2.5, h: 2.5 });
    expect(sizes["red-green-white-vintage-1"]).toEqual({ w: 2, h: 2.65 });
    expect(sizes["green-cream-vintage"]).toEqual({ w: 5.5, h: 4.25 });
    // Wide: 2 across, 5 down, at their real 3.5 x 2 in, filling the 7.5 x 10 in area's height.
    const ten = tags.layouts.find((l) => l.id === "10")!;
    const t = sheetSlots({ w: 3.5, h: 2 }, ten);
    expect(t.length).toBe(10);
    expect([t[0].w, t[0].h, t[0].rotate, t[0].scale]).toEqual([350, 200, false, 1]);
    expect(t[9].y + t[9].h - t[0].y).toBeCloseTo(1000);
    // 9 to a page (3 x 3; 2026-11-20): a tall tag shrinks just enough (3 x 3.5 in > 10 in); the split vintage and square tags stay
    // real size; the postcard shrinks to 2.5 in wide, as the owner asked.
    const nine = tags.layouts.find((l) => l.id === "9")!;
    const tall = sheetSlots({ w: 2, h: 3.5 }, nine);
    expect(tall.length).toBe(9);
    expect(tall[0].rotate).toBe(false);
    expect(tall[0].scale).toBeCloseTo(1000 / 1050);
    expect(tall[8].y + tall[8].h - tall[0].y).toBeCloseTo(1000);
    expect(sheetSlots({ w: 2, h: 2.65 }, nine)[0].scale).toBe(1);
    expect(sheetSlots({ w: 2.5, h: 2.5 }, nine)[0].scale).toBe(1);
    const card = sheetSlots({ w: 5.5, h: 4.25 }, nine);
    expect(card[0].w).toBeCloseTo(250);
    expect(card[0].h).toBeCloseTo(193.18, 1);
    // Every tag fits its own sheet.
    for (const d of tags.designs) expect(() => sheetSlots(designSize(tags, d), layoutFor(tags, d)), d.id).not.toThrow();
    expect(() => sheetSlots({ w: 8.5, h: 11 }, { id: "x", label: "", cols: 1, rows: 1, rotate: false, scale: 1, cutLines: false })).toThrow();
  });

  it("every design's picture exists and has a box for each name, inside the design", () => {
    let n = 0;
    for (const p of overlays)
      for (const d of p.designs) {
        n++;
        expect(existsSync(join(ROOT, "public", d.image)), d.image).toBe(true);
        for (const f of p.fields) {
          const b = d.boxes[f.key];
          expect(b, `${d.id} ${f.key}`).toBeDefined();
          const z = designSize(p, d);
          expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= z.w && b.y + b.h <= z.h, `${d.id} ${f.key}`).toBe(true);
        }
        if (d.siteLine) expect(d.siteLine.y).toBeLessThanOrEqual(designSize(p, d).h);
        if (d.thumb) expect(existsSync(join(ROOT, "public", d.thumb)), d.thumb).toBe(true);
        // The repo caps a public binary at 300 KB.
        expect(statSync(join(ROOT, "public", d.image)).size, d.image).toBeLessThan(300 * 1024);
      }
    expect(n).toBe(23); // the owner's 22 final tags and the (hidden) Nice List stand-in, 2026-11-20
    for (const f of ["dancing-script-latin-700.woff2", "mountains-of-christmas-latin-700.woff2"]) expect(existsSync(join(ROOT, "public/fonts", f)), f).toBe(true);
  });

  it("only switched-on printables with their files show; the rest wait hidden", () => {
    expect(shownPrintables().map((p) => p.id)).toEqual(["gift-tags", "coloring-book", "merry-christmas-red-stripe", "merry-christmas-green-stripe", "merry-christmas-plaid", "thanksgiving-banner"]);
    expect(isShown(overlays.find((p) => p.id === "santa-letter")!)).toBe(false);
    // Only the final tags' pictures ship: no leftover design in public/printables/tags.
    expect(readdirSync(join(ROOT, "public/printables/tags")).sort()).toEqual(FINAL_TAGS.flatMap((id) => [`${id}.jpg`, `${id}.webp`]).sort());
    // Owner 2026-11-21: the coloring book is live (Boys book); every other download still waits hidden.
    for (const p of downloads) expect(isShown(p), p.id).toBe(["coloring-book", "merry-christmas-red-stripe", "merry-christmas-green-stripe", "merry-christmas-plaid", "thanksgiving-banner"].includes(p.id));
    for (const p of downloads.filter(isShown)) for (const f of p.files) expect(existsSync(join(ROOT, "public", f.href)), f.href).toBe(true);
    const hidden = downloads.find((d) => !isShown(d))!;
    expect(isShown({ ...hidden, ready: true })).toBe(true);
    expect(isShown({ ...hidden, ready: true, files: [] })).toBe(false);
    expect(isShown({ ...tags, designs: [] })).toBe(false);
    expect(downloads.find((d) => d.id === "elf-kit")!.files.map((f) => f.label)).toEqual(["12-day plan", "24-day plan", "25-day plan"]);
    expect(JSON.stringify(PRINTABLES)).not.toMatch(/elf on the shelf/i);
  });
});

describe("names", () => {
  it("same names fill one page; a different name on each fills pages in order and skips empty rows; designs mix", () => {
    const same = sheetPages(tags, 10, { mode: "same", same: { to: "Mia", from: "Mom" }, rows: [], designId: tags.designs[1].id, mixDesigns: false });
    expect(same.length).toBe(1);
    expect(same[0].length).toBe(10);
    expect(new Set(same[0].map((i) => i.design.id))).toEqual(new Set([tags.designs[1].id]));
    const rows = Array.from({ length: 11 }, (_, i) => ({ to: i === 3 ? "" : `Kid ${i}`, from: "" }));
    const each = sheetPages(tags, 8, { mode: "each", same: {}, rows, designId: tags.designs[0].id, mixDesigns: true });
    expect(each.map((p) => p.length)).toEqual([8, 2]);
    expect(each.flat().map((i) => i.names.to)).not.toContain("");
    // Mixing cycles only the designs on the same sheet at the same size: the wide tags, never a tall one or the postcard.
    const wide = tags.designs.filter((d) => layoutFor(tags, d).id === "10");
    expect(each[0].slice(0, 4).map((i) => i.design.id)).toEqual(wide.slice(0, 4).map((d) => d.id));
    expect(new Set(each.flat().map((i) => layoutFor(tags, i.design).id))).toEqual(new Set(["10"]));
    const vint = sheetPages(tags, 9, { mode: "same", same: { to: "Mia" }, rows: [], designId: "red-green-white-vintage-1", mixDesigns: true });
    expect(vint[0].map((i) => i.design.id)).toEqual(Array.from({ length: 9 }, (_, i) => `red-green-white-vintage-${i + 1}`));
  });

  it("names lose control and direction characters and stop at 40", () => {
    expect(cleanName("Mi\u202ea\u0007")).toBe("Mia");
    expect(cleanName("x".repeat(50)).length).toBe(40);
  });

  it("a long name shrinks to the box, then is squeezed to it; a short one is full size", () => {
    const box = { x: 0.4, y: 1, w: 1.7, h: 0.5 };
    const measure = (t: string, size: number) => t.length * size * 0.5;
    const short = fitLine(box, "To:", "Mia", measure);
    expect(short.size).toBeCloseTo(39);
    expect(short.squeeze).toBe(1);
    const mid = fitLine(box, "To:", "Grandma Josephine", measure);
    expect(mid.size).toBeLessThan(short.size);
    expect(mid.squeeze).toBe(1);
    const long = fitLine(box, "To:", "The Thibodeaux-Fontenot Family", measure);
    expect(long.squeeze).toBeLessThan(1);
    const drawn = (long.prefixSize ? measure("To:", long.prefixSize) + long.size * 0.25 : 0) + measure("The Thibodeaux-Fontenot Family", long.size);
    expect(drawn * long.squeeze).toBeCloseTo(170);
    expect(long.size).toBeGreaterThanOrEqual(39 * 0.45 - 0.01);
  });
});

describe("the maker and the page", () => {
  it("draws the typed names on every tag, with cut lines, on each design's own sheet, and no website line (owner 2026-11-21)", async () => {
    render(<NameMaker product={tags} />);
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "Mia" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "Aunt Lexi" } });
    const root = document.querySelector("[data-printable-print-root]")!;
    // The first tag is wide: 10 to the page (2026-11-20).
    await waitFor(() => expect(root.querySelectorAll("[data-printable-item]").length).toBe(10));
    expect(root.querySelectorAll("[data-printable-cut]").length).toBe(10);
    // Owner 2026-11-21: "remove our website from the labels".
    expect(root.querySelectorAll("[data-printable-site]").length).toBe(0);
    // The first tag prints its own "To:" (labels: false), so only the name is drawn on its line.
    expect(tags.designs[0].labels).toBe(false);
    expect([...root.querySelectorAll('[data-printable-line="to"]')].map((t) => t.textContent)).toEqual(Array(10).fill("Mia"));
    expect(document.querySelector("[data-printable-preview]")!.textContent).toContain("Aunt Lexi");
    // No per-page chooser: each design prints on its own sheet.
    expect(document.querySelector("[data-printable-layout]")).toBeNull();
    // A tall tag: 9 to the page (2026-11-20), upright, shrunk to fit.
    fireEvent.click(document.querySelector('[data-printable-design="green-pink-blue-watercolor-tree"]')!);
    await waitFor(() => expect(root.querySelectorAll("[data-printable-item]").length).toBe(9));
    expect(root.querySelector('[data-printable-item="0"]')!.getAttribute("transform")).not.toMatch(/rotate/);
    expect(root.querySelector('[data-printable-item="0"]')!.getAttribute("transform")).toMatch(/scale\(0\.95/);
    // The postcard: 9 to the page (2026-11-20) at 2.5 in wide.
    fireEvent.click(document.querySelector('[data-printable-design="green-cream-vintage"]')!);
    await waitFor(() => expect(root.querySelector('[data-printable-item="0"]')!.getAttribute("transform")).toMatch(/scale\(0\.45/));
    expect(root.querySelectorAll("[data-printable-item]").length).toBe(9);
    // A different name on each: one tag per filled row.
    fireEvent.click(document.querySelector('[data-printable-mode="each"]')!);
    fireEvent.change(screen.getByLabelText("Tag 1: To"), { target: { value: "Ava" } });
    await waitFor(() => expect(root.querySelectorAll("[data-printable-item]").length).toBe(1));
  });

  it("each kind is its own page showing only its own printables; the guides link only shown printables", () => {
    // Owner 2026-11-21: "coloring book and banner should have their own page".
    const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Printables /></MemoryRouter>);
    const cards = () => [...document.querySelectorAll("[data-printable-card]")].map((c) => c.getAttribute("data-printable-card"));
    at("/gift-guides/printables/gift-tags");
    // Holiday audit 1121 area 5 #6: one live maker draws no one-option picker card.
    expect(cards()).toEqual([]);
    expect(document.querySelector("[role=radiogroup]")).toBeNull();
    expect(document.getElementById("gift-tags")?.getAttribute("aria-label")).toMatch(/Gift tags with names/);
    act(() => cleanup());
    at("/gift-guides/printables/coloring-books");
    expect(cards()).toEqual(["coloring-book"]);
    expect(document.getElementById("gift-tags")).toBeNull();
    act(() => cleanup());
    at("/gift-guides/printables/banners");
    expect(cards()).toEqual(["merry-christmas-red-stripe", "merry-christmas-green-stripe", "merry-christmas-plaid", "thanksgiving-banner"]);
    expect(document.getElementById("gift-tags")).toBeNull();
    act(() => cleanup());
    expect(printablesForGuide("gift-wrap-and-cards").map((p) => p.id)).toEqual(["gift-tags"]);
    expect(printablesForGuide("educators")).toEqual([]);
    render(<MemoryRouter><PrintablesLink slug="gift-wrap-and-cards" /><PrintablesLink slug="educators" /></MemoryRouter>);
    expect([...document.querySelectorAll("[data-gift-printable-link]")].map((a) => a.getAttribute("href"))).toEqual(["/gift-guides/printables/gift-tags#gift-tags"]);
  });

  it("the old /gift-guides/printables address lands on the page its #anchor names, else Gift tags", () => {
    expect(printablesRedirect("")).toBe("/gift-guides/printables/gift-tags");
    expect(printablesRedirect("#pr-coloring")).toBe("/gift-guides/printables/coloring-books");
    expect(printablesRedirect("#coloring-book")).toBe("/gift-guides/printables/coloring-books#coloring-book");
    expect(printablesRedirect("#pr-banners")).toBe("/gift-guides/printables/banners");
    expect(printablesRedirect("#gift-tags")).toBe("/gift-guides/printables/gift-tags#gift-tags");
    expect(printablesRedirect("#gift-planner-sheet")).toBe("/gift-guides/printables/gift-tags#gift-planner-sheet");
    render(<MemoryRouter initialEntries={["/gift-guides/printables#pr-banners"]}><Printables /></MemoryRouter>);
    expect([...document.querySelectorAll("[data-printable-card]")].map((c) => c.getAttribute("data-printable-card"))).toEqual(["merry-christmas-red-stripe", "merry-christmas-green-stripe", "merry-christmas-plaid", "thanksgiving-banner"]);
  });

  it("each printables page has its own head, and the old address keeps its own", () => {
    for (const [path, word] of [["/gift-guides/printables/gift-tags", "gift tags"], ["/gift-guides/printables/coloring-books", "coloring books"], ["/gift-guides/printables/banners", "banner"]] as const) {
      const p = PUBLIC_PAGE_META[path];
      expect(p.title.toLowerCase(), path).toContain(word);
      expect(p.canonical, path).toBe(`https://www.louisianahelpr.com${path}`);
    }
    // The old address only forwards (owner 11-21: each kind its own page): out of the sitemap, noindex, its own head.
    const m = NOINDEX_PAGE_META["/gift-guides/printables"];
    expect(m.title.toLowerCase()).toContain("free holiday printables");
    expect(m.description.toLowerCase()).toContain("coloring books");
    expect(m.canonical).toBe("https://www.louisianahelpr.com/gift-guides/printables");
  });
});

/**
 * Holiday audit 1121 area 5 (#6, #9, #11, #12, #21) on /gift-guides/printables (page counts measured 2026-11-21).
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx |         {makers.length > 1 && ( |         {makers.length > 0 && (
 * @mutate src/lib/publicPageMeta.mjs |     title: "Free holiday printables — Helpr", |     title: "Free printable gift tags — Helpr",
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | .pr-card-img{flex:none;width:96px;height:auto;align-self:flex-start;border-radius:6px;border:1px solid var(--gg-line)} | .pr-card-img{flex:none;width:96px;height:auto;align-self:flex-start;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.12)}
 * @mutate src/content/printables.ts | title: "Boys coloring book", blurb: "A cover and 20 Christmas pages to color.", preview: "/printables/coloring-book/preview-boys.webp" | title: "Boys coloring book", blurb: "A cover and 20 Christmas pages to color.", preview: "/printables/coloring-book/preview-girls.webp"
 * @mutate src/content/printables.ts | christmas-coloring-book-boys.pdf", title: "Boys coloring book" | christmas-coloring-book-boys.pdf", title: "Boys book (free)"
 * @mutate src/content/printables.ts | { label: "Wide banner", href: "/printables/thanksgiving-banner/ | { label: "Original 2:1 (free)", href: "/printables/thanksgiving-banner/
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | .pr-card-wide{flex-direction:column;max-width:640px; | .pr-card-wide{flex-direction:column;max-width:420px;
 */
// Page counts measured 2026-11-21 from the PDFs' own page trees (the test below re-reads them).
describe("printables audit 1121 area 5: previews, covers, page counts", () => {
  it("previews sit with no drop shadow (owner rule: no box behind a photo)", () => {
    render(<MemoryRouter initialEntries={["/gift-guides/printables/coloring-books"]}><Printables /></MemoryRouter>);
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{[^}]*\\}`).exec(css)?.[0] ?? "";
    expect(rule(".pr-card-img").length).toBeGreaterThan(10);
    for (const sel of [".pr-card-img", ".pr-maker-card img"]) expect(rule(sel)).not.toMatch(/box-shadow/);
  });

  it("each coloring book shows its own cover and title (owner 11-22 #14), and the PDFs really are 21 pages", () => {
    render(<MemoryRouter initialEntries={["/gift-guides/printables/coloring-books"]}><Printables /></MemoryRouter>);
    const card = document.querySelector('[data-printable-card="coloring-book"]')!;
    const covers = [...card.querySelectorAll("img")].map((i) => new URL(i.src).pathname);
    expect(covers).toEqual(["/printables/coloring-book/preview-girls.webp", "/printables/coloring-book/preview-boys.webp"]);
    for (const cover of covers) expect(existsSync(join("public", cover!))).toBe(true);
    expect([...card.querySelectorAll(".pr-card-title")].map((t) => t.textContent)).toEqual(["Girls coloring book", "Boys coloring book"]);
    const buttons = [...card.querySelectorAll("[data-printable-download]")].map((b) => b.getAttribute("aria-label"));
    expect(buttons).toEqual(["Download the girls coloring book (PDF)", "Download the boys coloring book (PDF)"]);
    // The count is the PDFs' own (their page tree's /Count), so a re-exported book with more pages turns this red.
    for (const f of ["girls", "boys"]) {
      const pdf = readFileSync(join("public/printables/coloring-book", `christmas-coloring-book-${f}.pdf`), "latin1");
      expect(Math.max(...[...pdf.matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1]))), f).toBe(21);
    }
  });

  it("the banner buttons use plain words and the wide card has room (guides polish 1122 #31)", () => {
    render(<MemoryRouter initialEntries={["/gift-guides/printables/banners"]}><Printables /></MemoryRouter>);
    const card = document.querySelector('[data-printable-card="thanksgiving-banner"]')!;
    expect([...card.querySelectorAll("[data-printable-download]")].map((b) => b.textContent)).toEqual(["12x18 print\u00a0›", "Wide banner\u00a0›"]);
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    expect(Number(/\.pr-card-wide\{[^}]*max-width:(\d+)px/.exec(css)?.[1])).toBeGreaterThanOrEqual(640);
  });
});
