/**
 * NO ACTION TEXT IS DRAWN ON A TOP 10 PHOTO (flow audit 1123 C12, 2026-11-24).
 *
 * On the gift guides landing (the page the Facebook posts send shoppers to), the Top 10 cards drew the grey words "shop
 * similar" ON the product photo (phone 375: #1 Therabody over its own logo, #2 over the Lola band; desktop 1440: #1-#3),
 * which read as a rendering mistake. The fix moves the words to the card's bottom line, under the price at its right
 * end, with or without a cart, and the name column keeps a 44px strip at its foot for that line. The two icons keep
 * their owner-chosen places on the photo: the heart on the top-right (owner 11-21 evening) and an Amazon cart right
 * under it (owner 2026-11-22).
 *
 * jsdom draws no layout, so this test computes it: it renders the real landing (the real Top 10 picks, the real
 * stylesheet), and for every control beside each Top 10 card's link it resolves the cascade itself (every rule of the
 * page's gift-guide CSS whose @media width test holds at 375 and at 1440, matched with element.matches, ordered by
 * specificity then source order, box shorthands expanded). A control that shows text (anything not in .sr-only) is off
 * the photo when it is absolutely placed against the card's bottom (top auto, 0 <= bottom, bottom + 44 <= the strip the
 * name column keeps), the card's link has no bottom padding or margin (so the name column's foot is the card's foot),
 * and the photo sits above the name column. An icon-only control must be the heart or the cart, in its own spot. The
 * inventory is the rendered cards themselves, with floors.
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list.gg-top10 .gg-dupe{top:auto;bottom:0;left:auto;right:0;justify-content:flex-end} | .gg-list.gg-top10 .gg-dupe{top:46px;bottom:auto;left:auto;right:46px;justify-content:center}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-top10>li:has(>.gg-dupe) .gg-nm{padding-bottom:44px} | .gg-top10>li:has(>.gg-dupe) .gg-nm{padding-bottom:10px}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-top10 .gg-cart{position:absolute;top:46px;right:2px;z-index:1} | .gg-top10 .gg-cart{position:absolute;top:auto;bottom:0;right:0;z-index:1}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { loadGuidePicks } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { blankCssComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Rule = { media: string | null; selector: string; decls: Record<string, string>; order: number };

/** Top-level rules and the rules inside each @-block (one level, which is all this stylesheet nests). */
function parseRules(css: string): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  let order = 0;
  const body = (s: string) =>
    Object.fromEntries(
      s.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
        const at = d.indexOf(":");
        return [d.slice(0, at).trim(), d.slice(at + 1).trim()] as [string, string];
      }),
    );
  const readBlock = (from: number) => {
    let depth = 0;
    for (let j = from; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) return j;
    }
    throw new Error(`unbalanced CSS at ${from}`);
  };
  const strip = (s: string) => s.trim();
  css = blankCssComments(css);
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = strip(css.slice(i, open));
    const close = readBlock(open);
    if (head.startsWith("@")) {
      const inner = css.slice(open + 1, close);
      for (const m of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ media: head, selector: strip(m[1]), decls: body(m[2]), order: order++ });
    } else {
      out.push({ media: null, selector: head, decls: body(css.slice(open + 1, close)), order: order++ });
    }
    i = close + 1;
  }
  return out;
}

/** A width-only @media test at a viewport width; any other at-rule (hover, container, keyframes) is left out. */
function mediaHolds(media: string | null, width: number): boolean {
  if (media === null) return true;
  const m = /^@media\s+(.*)$/.exec(media);
  if (!m) return false;
  const parts = m[1].split(/\s+and\s+/);
  return parts.every((p) => {
    const w = /^\((min|max)-width:(\d+)px\)$/.exec(p.trim());
    if (!w) return false;
    return w[1] === "min" ? width >= Number(w[2]) : width <= Number(w[2]);
  });
}

/** Split a selector list at its top-level commas (not inside :where(...) or :has(...)). */
function splitList(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of sel) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Selector specificity [ids, classes/attributes/pseudo-classes, elements]; :where() counts nothing, :has()/:not()/:is() their most specific argument. */
function specificity(sel: string): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0];
  let s = sel;
  for (;;) {
    const m = /:(where|has|not|is)\(/.exec(s);
    if (!m) break;
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < s.length; end++) {
      if (s[end] === "(") depth++;
      else if (s[end] === ")" && --depth === 0) break;
    }
    if (m[1] !== "where") {
      const args = splitList(s.slice(m.index + m[0].length, end)).map((a) => specificity(a.replace(/^[>+~]\s*/, "")));
      const top = args.reduce((a, b) => (a[0] !== b[0] ? (a[0] > b[0] ? a : b) : a[1] !== b[1] ? (a[1] > b[1] ? a : b) : a[2] >= b[2] ? a : b), [0, 0, 0] as [number, number, number]);
      total[0] += top[0]; total[1] += top[1]; total[2] += top[2];
    }
    s = `${s.slice(0, m.index)} ${s.slice(end + 1)}`;
  }
  s = s.replace(/[>+~]/g, " ");
  total[0] += (s.match(/#[\w-]+/g) ?? []).length;
  total[1] += (s.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):[\w-]+/g) ?? []).length;
  total[2] += (s.match(/(^|\s)[a-z][\w-]*/gi) ?? []).length + (s.match(/::[\w-]+/g) ?? []).length;
  return total;
}

const RULES = parseRules(GIFT_GUIDES_CSS);

const SIDES = ["top", "right", "bottom", "left"] as const;
/** The `side` value of a 1-4 value box shorthand (margin, padding, inset). */
const sideOf = (v: string, side: (typeof SIDES)[number]) => {
  const p = v.split(/\s+/);
  const four = [p[0], p[1] ?? p[0], p[2] ?? p[0], p[3] ?? p[1] ?? p[0]];
  return four[SIDES.indexOf(side)];
};
/** The declarations that can set `prop`: itself, plus its box shorthand (margin-bottom <- margin, top <- inset). */
const setters = (prop: string): { name: string; pick: (v: string) => string }[] => {
  const box = /^(margin|padding)-(top|right|bottom|left)$/.exec(prop);
  if (box) return [{ name: prop, pick: (v) => v }, { name: box[1], pick: (v) => sideOf(v, box[2] as (typeof SIDES)[number]) }];
  if ((SIDES as readonly string[]).includes(prop)) return [{ name: prop, pick: (v) => v }, { name: "inset", pick: (v) => sideOf(v, prop as (typeof SIDES)[number]) }];
  return [{ name: prop, pick: (v) => v }];
};

/** The cascaded value of `prop` on `el` at `width`, from the gift-guide stylesheet ("" when no rule sets it). */
function cascaded(el: Element, prop: string, width: number): string {
  let best: { spec: [number, number, number]; order: number; value: string } | null = null;
  for (const r of RULES) {
    if (!mediaHolds(r.media, width)) continue;
    for (const set of setters(prop)) {
      if (!(set.name in r.decls)) continue;
      for (const sel of splitList(r.selector)) {
        if (!el.matches(sel)) continue;
        const spec = specificity(sel);
        const wins = !best || spec[0] !== best.spec[0] ? !best || spec[0] > best.spec[0]
          : spec[1] !== best.spec[1] ? spec[1] > best.spec[1]
          : spec[2] !== best.spec[2] ? spec[2] > best.spec[2]
          : r.order >= best.order;
        if (wins) best = { spec, order: r.order, value: set.pick(r.decls[set.name]) };
      }
    }
  }
  return best?.value ?? "";
}
const px = (v: string) => (v === "0" ? 0 : /^(-?\d+(?:\.\d+)?)px$/.test(v) ? Number(v.slice(0, -2)) : NaN);
const TAP = 44;

async function landing() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T18:00:00Z"));
  await act(async () => { await Promise.all(["her", "him", "kids"].map(loadGuidePicks)); });
  const { container } = render(
    <MemoryRouter initialEntries={["/gift-guides"]}>
      <Routes><Route path="/gift-guides" element={<GiftGuides />} /></Routes>
    </MemoryRouter>,
  );
  return container;
}

describe("Top 10 cards draw nothing but the heart on the photo (flow audit 1123 C12)", () => {
  it("the cascade helper reads the stylesheet (sanity: the guide row's phone cart and the Top 10 heart resolve as written)", () => {
    expect(RULES.length).toBeGreaterThan(200);
    expect(specificity(".gg-list>:where([data-gift-pick])>.gg-cart")).toEqual([0, 2, 0]);
    expect(specificity(".gg-top10>li:has(>.gg-dupe) .gg-nm")).toEqual([0, 3, 1]);
    expect(specificity(".gg-top10>li:has(>.gg-cart,>.gg-dupe) .gg-nm")).toEqual([0, 3, 1]);
    expect(specificity(".gg-list.gg-top10 .gg-dupe")).toEqual([0, 3, 0]);
    expect(mediaHolds("@media (min-width:768px) and (max-width:1023px)", 375)).toBe(false);
    expect(mediaHolds("@media (max-width:767px)", 375)).toBe(true);
    expect(sideOf("9px 9px 0", "bottom")).toBe("0");
    expect(sideOf("1px 2px", "left")).toBe("2px");
  });

  it.each([375, 1440])("at %ipx every control that shows text ('shop similar') sits on the card's bottom line, under the price, never on the photo", async (width) => {
    const c = await landing();
    const cards = [...c.querySelectorAll<HTMLElement>("[data-gift-top10] ul.gg-top10 > li[data-gift-pick]")];
    expect(cards).toHaveLength(10);
    let words = 0;
    let carts = 0;
    for (const li of cards) {
      const name = li.querySelector(".gg-nm-name")?.textContent ?? "?";
      const item = li.querySelector<HTMLElement>(":scope > a.gg-item")!;
      const photo = item.querySelector(".gg-photo, img.gg-thumb")!;
      const nm = item.querySelector<HTMLElement>(":scope > .gg-nm")!;
      // The photo comes before the name column, and the name column is the last thing in the card's link.
      expect(photo.compareDocumentPosition(nm) & Node.DOCUMENT_POSITION_FOLLOWING, name).toBeTruthy();
      expect(nm.nextElementSibling?.classList.contains("sr-only") ?? true, name).toBe(true);
      expect(cascaded(li, "position", width), name).toBe("relative");
      for (const p of ["padding-bottom", "margin-bottom"]) {
        const v = cascaded(item, p, width);
        expect(v === "" || px(v) === 0, `${name}: the card link's ${p} is ${v}`).toBe(true);
      }
      const strip = px(cascaded(nm, "padding-bottom", width) || "0");
      for (const el of li.querySelectorAll<HTMLElement>(":scope > :not(a.gg-item)")) {
        const shown = [...el.childNodes].map((n) => (n instanceof HTMLElement && n.classList.contains("sr-only") ? "" : n.textContent ?? "")).join("").trim();
        const at = `${width}px #${cards.indexOf(li) + 1} ${name}`;
        if (!shown) {
          // An icon-only control: the heart (top-right) or the cart right under it (owner 2026-11-22), nothing else.
          const spot = [cascaded(el, "top", width), cascaded(el, "right", width)];
          if (el.matches(".gg-heart-pick")) expect(spot, `${at}: heart`).toEqual(["2px", "2px"]);
          else if (el.matches(".gg-cart")) { carts++; expect(spot, `${at}: cart`).toEqual([`${2 + TAP}px`, "2px"]); }
          else throw new Error(`${at}: an unknown icon-only control (${el.className}) on the card`);
          continue;
        }
        words++;
        const what = `${at}: "${shown}"`;
        expect(cascaded(el, "position", width), what).toBe("absolute");
        expect(cascaded(el, "top", width), `${what} is pinned from the top (onto the photo)`).toBe("auto");
        const bottom = px(cascaded(el, "bottom", width));
        expect(bottom >= 0 && bottom + TAP <= strip, `${what}: bottom ${bottom}px, strip ${strip}px under the price`).toBe(true);
      }
    }
    // The landing's Top 10 has similar-item words and an Amazon cart today (floors; read from the rendered cards).
    expect(words).toBeGreaterThan(3);
    expect(carts).toBeGreaterThan(0);
  });

  it("the heart keeps its corner of the photo (owner 11-21 evening), clear of the rank on the top-left", async () => {
    const c = await landing();
    for (const heart of c.querySelectorAll("[data-gift-top10] ul.gg-top10 > li > .gg-heart-pick")) {
      for (const w of [375, 1440]) {
        expect([cascaded(heart, "top", w), cascaded(heart, "right", w), cascaded(heart, "bottom", w)]).toEqual(["2px", "2px", "auto"]);
      }
    }
  });
});
