/**
 * Free holiday printables (owner 2026-11-20), /gift-guides/printables:
 *   - every layout of every printable fits the 7.5 x 10 in area inside a letter page's margins, and a tag sheet is 8;
 *   - every design names a picture that exists and a box for each of its product's names, inside the design;
 *   - a printable shows only when it is switched on AND its files are listed; the hidden ones render nothing;
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
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router-dom";
import {
  PAGE,
  PRINTABLES,
  cleanName,
  designSize,
  fitLine,
  isShown,
  pageSlots,
  printablesForGuide,
  sheetPages,
  sheetSlots,
  shownPrintables,
  type DownloadProduct,
  type OverlayProduct,
} from "@/content/printables";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
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

afterEach(() => act(() => cleanup()));

describe("the config", () => {
  it("every layout fits a letter page; a tag sheet holds 8 at 2.5 x 3.5 in", () => {
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
    // The owner's 3.5 x 2 in tags: 8 at their real size, 2 across and 4 down.
    const t = sheetSlots({ w: 3.5, h: 2 }, tags.layouts[0]);
    expect(t.length).toBe(8);
    expect([t[0].w, t[0].h, t[0].rotate]).toEqual([350, 200, false]);
    // A 2 x 3.5 in tag is turned into the same place.
    const p = sheetSlots({ w: 2, h: 3.5 }, tags.layouts[0]);
    expect(p.map((s) => [s.x, s.y, s.w, s.h, s.rotate])).toEqual(t.map((s) => [s.x, s.y, s.w, s.h, true]));
    // Mixed sizes: equal cells as big as the largest, each tag centered in its cell.
    const m = pageSlots([{ w: 3.5, h: 2 }, { w: 2.5, h: 3.5 }], tags.layouts[0]);
    expect([m[0].w, m[0].h, m[1].w, m[1].h, m[1].rotate]).toEqual([350, 200, 350, 250, true]);
    expect(m[0].y - m[1].y).toBeCloseTo(25);
    // Every tag, alone or mixed with all the others, fits 8 to a letter page.
    for (const d of tags.designs) expect(() => sheetSlots(designSize(tags, d), tags.layouts[0]), d.id).not.toThrow();
    for (let i = 0; i < tags.designs.length; i += 8) {
      expect(() => pageSlots(tags.designs.slice(i, i + 8).map((d) => designSize(tags, d)), tags.layouts[0])).not.toThrow();
    }
    expect(() => pageSlots(tags.designs.map((d) => designSize(tags, d)), tags.layouts[0])).not.toThrow();
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
      }
    expect(n).toBeGreaterThan(20); // 21+ owner tags and the Nice List stand-in, measured 2026-11-20
    for (const f of ["dancing-script-latin-700.woff2", "mountains-of-christmas-latin-700.woff2"]) expect(existsSync(join(ROOT, "public/fonts", f)), f).toBe(true);
  });

  it("only switched-on printables with their files show; the rest wait hidden", () => {
    expect(shownPrintables().map((p) => p.id)).toEqual(["gift-tags", "santa-letter"]);
    for (const p of downloads) expect(isShown(p), p.id).toBe(false);
    expect(isShown({ ...downloads[0], ready: true })).toBe(true);
    expect(isShown({ ...downloads[0], ready: true, files: [] })).toBe(false);
    expect(isShown({ ...tags, designs: [] })).toBe(false);
    expect(downloads.find((d) => d.id === "elf-kit")!.files.map((f) => f.label)).toEqual(["12-day plan", "24-day plan", "25-day plan"]);
    expect(JSON.stringify(PRINTABLES)).not.toMatch(/elf on the shelf/i);
  });
});

describe("names", () => {
  it("same names fill one page; a different name on each fills pages in order and skips empty rows; designs mix", () => {
    const same = sheetPages(tags, 8, { mode: "same", same: { to: "Mia", from: "Mom" }, rows: [], designId: tags.designs[1].id, mixDesigns: false });
    expect(same.length).toBe(1);
    expect(same[0].length).toBe(8);
    expect(new Set(same[0].map((i) => i.design.id))).toEqual(new Set([tags.designs[1].id]));
    const rows = Array.from({ length: 11 }, (_, i) => ({ to: i === 3 ? "" : `Kid ${i}`, from: "" }));
    const each = sheetPages(tags, 8, { mode: "each", same: {}, rows, designId: tags.designs[0].id, mixDesigns: true });
    expect(each.map((p) => p.length)).toEqual([8, 2]);
    expect(each.flat().map((i) => i.names.to)).not.toContain("");
    expect(each[0].slice(0, 4).map((i) => i.design.id)).toEqual(tags.designs.slice(0, 4).map((d) => d.id));
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
  it("draws the typed names and louisianahelpr.com on all 8 tags, with cut lines, in the print pages", async () => {
    render(<NameMaker product={tags} />);
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "Mia" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "Aunt Lexi" } });
    const root = document.querySelector("[data-printable-print-root]")!;
    await waitFor(() => expect(root.querySelectorAll("[data-printable-item]").length).toBe(8));
    expect(root.querySelectorAll("[data-printable-cut]").length).toBe(8);
    expect(root.querySelectorAll("[data-printable-site]").length).toBe(8);
    // The first tag prints its own "To:" (labels: false), so only the name is drawn on its line.
    expect(tags.designs[0].labels).toBe(false);
    expect([...root.querySelectorAll('[data-printable-line="to"]')].map((t) => t.textContent)).toEqual(Array(8).fill("Mia"));
    expect(document.querySelector("[data-printable-preview]")!.textContent).toContain("Aunt Lexi");
    // Mixed designs: a landscape tag sits as it is, a portrait one turned, in the same sheet.
    fireEvent.click(document.querySelector("[data-printable-mix-designs]")!);
    const tall = (d: (typeof tags.designs)[number]) => (d.size ?? tags.size).h > (d.size ?? tags.size).w;
    const portrait = tags.designs.findIndex(tall);
    const wide = tags.designs.findIndex((d) => !tall(d));
    expect(portrait).toBeGreaterThan(-1);
    expect(portrait).toBeLessThan(8);
    await waitFor(() => expect(root.querySelector(`[data-printable-item="${portrait}"]`)!.getAttribute("transform")).toMatch(/rotate\(90\)/));
    expect(root.querySelector(`[data-printable-item="${wide}"]`)!.getAttribute("transform")).not.toMatch(/rotate/);
    // A different name on each: one tag per filled row.
    fireEvent.click(document.querySelector('[data-printable-mode="each"]')!);
    fireEvent.change(screen.getByLabelText("Tag 1: To"), { target: { value: "Ava" } });
    await waitFor(() => expect(root.querySelectorAll("[data-printable-item]").length).toBe(1));
  });

  it("the page shows the shown makers and no hidden card; the guides link only shown printables", () => {
    render(<MemoryRouter><Printables /></MemoryRouter>);
    const cards = [...document.querySelectorAll("[data-printable-card]")].map((c) => c.getAttribute("data-printable-card"));
    expect(cards).toEqual(["gift-tags", "santa-letter"]);
    act(() => cleanup());
    expect(printablesForGuide("gift-wrap-and-cards").map((p) => p.id)).toEqual(["gift-tags"]);
    expect(printablesForGuide("educators")).toEqual([]);
    render(<MemoryRouter><PrintablesLink slug="gift-wrap-and-cards" /><PrintablesLink slug="educators" /></MemoryRouter>);
    expect([...document.querySelectorAll("[data-gift-printable-link]")].map((a) => a.getAttribute("href"))).toEqual(["/gift-guides/printables#gift-tags"]);
  });

  it("the head names the search it is for", () => {
    const m = PUBLIC_PAGE_META["/gift-guides/printables"];
    expect(m.title.toLowerCase()).toContain("free printable christmas gift tags with names");
    expect(m.canonical).toBe("https://www.louisianahelpr.com/gift-guides/printables");
  });
});
