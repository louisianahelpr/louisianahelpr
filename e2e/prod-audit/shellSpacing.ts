/**
 * Phone-width page-shell spacing — the measurement shared by
 * shell-spacing.spec.ts (Q176, owner 2026-09-23: "too much space above and
 * below for phone width … fix these page shells for public and authed so they
 * are all consistent on phone width").
 *
 * Three numbers per screen, all read off the RENDERED page (the source cannot
 * say them: the gap above a title is a nav's height, a spacer's calc(), the
 * header's padding and the back button's 44px tap floor, in four files):
 *
 *   headerToTitle   top chrome's bottom edge → the title block's top edge
 *   titleToContent  the title block's bottom edge → the first painted thing below it
 *   bottomGap       last painted content's bottom → the bottom nav's top (or the
 *                   viewport bottom when there is no nav), scrolled to the end
 *
 * "Title block" = the row the page's visible <h1> sits in (the back button and
 * the h1 share one row in PageHeader), or the painted card that row sits
 * inside when there is one (PageScaffold's title card), since the card's edge
 * is what the eye reads as the start of the title.
 *
 * "Painted" = an element with its own non-blank text, a replaced/control
 * element (img, svg, input, button…), or a visible surface (background,
 * border, shadow). Layout-only wrappers are invisible and do not count.
 */
import { ANON_SCREENS, AUTHED_SCREENS, distinctScreens, type ScreenSpec } from "../happy-path/auditRoutes";

export interface SpacingRow {
  headerToTitle: number | null;
  titleToContent: number | null;
  bottomGap: number | null;
  chromeBottom: number;
  title: string | null;
  /** How the title block was found: "row" (PageHeader-style) or "card". */
  titleKind: "row" | "card" | null;
  firstContent: string | null;
  overflow: number;
  pastRightEdge: string[];
  /** Horizontal gutter: title block's left edge. */
  titleLeft: number | null;
  landedOn: string;
}

/** Runs in the page. Self-contained: page.evaluate serialises it. */
export function readShellSpacing(): SpacingRow {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const alpha = (c: string) => {
    if (!c || c === "transparent") return 0;
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return 1;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean);
    return parts.length >= 4 ? parseFloat(parts[3]) : 1;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || parseFloat(s.opacity) === 0) return false;
    if (s.clip === "rect(0px, 0px, 0px, 0px)" || s.clipPath === "inset(50%)") return false;
    return true;
  };
  const surface = (el: Element) => {
    const s = getComputedStyle(el);
    return (
      alpha(s.backgroundColor) > 0.05 ||
      (s.backgroundImage !== "none" && !s.backgroundImage.startsWith("url(")) ||
      (parseFloat(s.borderTopWidth) > 0 && alpha(s.borderTopColor) > 0.05) ||
      (parseFloat(s.borderBottomWidth) > 0 && alpha(s.borderBottomColor) > 0.05) ||
      s.boxShadow !== "none"
    );
  };
  const REPLACED = new Set(["IMG", "SVG", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "CANVAS", "VIDEO", "IFRAME", "svg"]);
  const ownText = (el: Element) =>
    Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 0);
  const painted = (el: Element) => REPLACED.has(el.tagName) || ownText(el) || surface(el);
  const isFixed = (el: Element) => {
    let p: Element | null = el;
    while (p && p !== document.body) {
      const pos = getComputedStyle(p).position;
      // The AppShell frame is itself `fixed inset-0`: it is the page, not chrome.
      // Sticky is NOT chrome here: a sticky tab strip (Legal) is in-flow content.
      if (pos === "fixed" && p.getBoundingClientRect().height < vh * 0.5) return true;
      p = p.parentElement;
    }
    return false;
  };

  // ── top chrome ────────────────────────────────────────────────────────
  let chromeBottom = 0;
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const s = getComputedStyle(el);
    if (s.position !== "fixed" && s.position !== "sticky") continue;
    const r = el.getBoundingClientRect();
    if (r.top > 1 || r.height > 200 || r.height < 4 || r.width < vw * 0.6) continue;
    if (!visible(el)) continue;
    chromeBottom = Math.max(chromeBottom, r.bottom);
  }
  const ash = document.querySelector(".app-shell-header");
  if (ash) chromeBottom = Math.max(chromeBottom, ash.getBoundingClientRect().bottom);

  // ── title block ───────────────────────────────────────────────────────
  const h1s = Array.from(document.querySelectorAll("h1")).filter(
    (h) => (h.textContent || "").trim().length > 0 && h.getBoundingClientRect().top < vh,
  );
  const h1 = h1s.find((h) => visible(h));
  let block: Element | null = null;
  let titleKind: SpacingRow["titleKind"] = null;
  // No visible title: PageScaffold's title card IS the title block (Dashboard's
  // card is the H emblem + actions; its <h1> is screen-reader-only).
  const titleCard = h1 ? null : document.querySelector(".app-shell-frame .liquid-glass.shrink-0");
  if (titleCard && visible(titleCard)) {
    block = titleCard;
    titleKind = "card";
  } else if (h1) {
    let row: Element = h1;
    while (row.parentElement && row.parentElement.getBoundingClientRect().height <= 64) row = row.parentElement;
    block = row;
    titleKind = "row";
    // A painted card wrapping the row, starting below the chrome and not the page itself.
    let p: Element | null = row;
    while (p && p !== document.body) {
      const r = p.getBoundingClientRect();
      if (r.height > vh * 0.45) break;
      if (p !== row && surface(p) && r.top >= chromeBottom - 1) {
        block = p;
        titleKind = "card";
      }
      p = p.parentElement;
    }
  }
  const br = block?.getBoundingClientRect() ?? null;

  // ── first painted content below the title ─────────────────────────────
  let first: { top: number; tag: string } | null = null;
  if (block && br) {
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (block.contains(el) || el.contains(block)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < br.bottom - 2 || r.top > vh * 3) continue;
      if (r.right <= 0 || r.left >= vw) continue;
      if (!visible(el) || !painted(el) || isFixed(el)) continue;
      if (!first || r.top < first.top) {
        const cls = typeof el.className === "string" ? el.className.split(" ")[0] : "";
        first = { top: r.top, tag: `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}> ${(el.textContent || "").trim().slice(0, 30)}` };
      }
    }
  }

  // ── bottom: scroll every scroller to its end, then compare ────────────
  window.scrollTo(0, document.documentElement.scrollHeight);
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (el.scrollHeight > el.clientHeight + 4) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") el.scrollTop = el.scrollHeight;
    }
  }
  let navTop = vh;
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const s = getComputedStyle(el);
    if (s.position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < vh - 2 || r.top < vh * 0.6 || r.height < 20 || !visible(el)) continue;
    if (r.width < vw * 0.5) continue;
    navTop = Math.min(navTop, r.top);
  }
  let lastBottom: number | null = null;
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.bottom > vh + 1 || r.bottom < 0 || r.right <= 0 || r.left >= vw) continue;
    if (!visible(el) || !painted(el) || isFixed(el)) continue;
    // A full-height surface (the page background) is not "content".
    if (r.height > vh * 0.9) continue;
    lastBottom = lastBottom === null ? r.bottom : Math.max(lastBottom, r.bottom);
  }

  const pastRightEdge: string[] = [];
  const clipped = (e: Element): boolean => {
    let p = e.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll") return true;
      p = p.parentElement;
    }
    return false;
  };
  for (const el of Array.from(document.querySelectorAll("button, a, input, h1, h2, h3, p, li, label"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || !visible(el) || clipped(el)) continue;
    if (r.right > vw + 2 && r.left < vw) pastRightEdge.push(`<${el.tagName.toLowerCase()}> right=${Math.round(r.right)}`);
    if (pastRightEdge.length >= 5) break;
  }

  const round = (n: number) => Math.round(n);
  return {
    headerToTitle: br ? round(br.top - chromeBottom) : null,
    titleToContent: br && first ? round(first.top - br.bottom) : null,
    bottomGap: lastBottom === null ? null : round(navTop - lastBottom),
    chromeBottom: round(chromeBottom),
    title: h1 ? (h1.textContent || "").trim().slice(0, 40) : block ? "(title card)" : null,
    titleKind,
    firstContent: first?.tag ?? null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pastRightEdge,
    titleLeft: br ? round(br.left) : null,
    landedOn: location.pathname + location.search,
  };
}

/** Real ids for the catalog's `/user/:id` rows (the catalog's fakes are mock-only). */
const REAL_USER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";

export interface SpacingScreen {
  name: string;
  url: string;
  auth: "guest" | "poster";
}

/**
 * The route inventory: the audit catalog, which src/test/auditCatalogRoutes
 * .test.ts proves is every route in src/App.tsx. Redirect aliases, seeded-only
 * duplicates and rows that need a mock setup step are dropped (they render a
 * screen another row already measures).
 */
export function spacingScreens(): SpacingScreen[] {
  const keep = (s: ScreenSpec) => !s.seededOnly && !s.extraSetup && !s.rules;
  const fix = (url: string) => url.replace(/^\/user\/(?!10000000-)[^/?]+/, `/user/${REAL_USER}`);
  return [
    ...distinctScreens(ANON_SCREENS).filter(keep).map((s) => ({ name: s.name, url: s.url, auth: "guest" as const })),
    ...distinctScreens(AUTHED_SCREENS).filter(keep).map((s) => ({ name: s.name, url: fix(s.url), auth: "poster" as const })),
  ];
}
