/**
 * Button geometry checks, run INSIDE the page (pass to `page.evaluate`).
 *
 * Two defect classes that no overflow, clipping or axe check can see, both
 * found by the owner on /complete-profile on 2026-09-12:
 *
 *   1. SIBLING MISMATCH. "Enter App" rendered 49.5px directly above a 60px
 *      "Sign Out". Neither overflowed, neither clipped, both passed axe.
 *   2. REQUESTED ≠ RENDERED. The primary carried `min-h-[60px]`, but index.css's
 *      unlayered `button { min-height: 44px }` beats every Tailwind utility, so
 *      the class was on the element and did nothing. A code read sees 60px.
 *
 * Self-contained on purpose: Playwright serialises the function, so it may not
 * close over anything in this module. Only erasable TypeScript, so the Node
 * audit walker (scripts/audit/walk-every-control.mjs) can import it directly.
 */
export interface ButtonGeometryReport {
  siblingMismatch: string[];
  requestedNotRendered: string[];
  /**
   * Controls the global HIG floor applies to (index.css, `@layer base`) that
   * render under 44px on an axis WITHOUT a size class on that axis asking for
   * it. Report-only: it is the before/after measure for moving the floor into
   * the base layer, where an explicit `min-h-0`/`min-w-0` now legitimately wins.
   */
  belowTapFloor: string[];
  /**
   * `h-*` below 44px on a control the floor applies to, rendered at exactly
   * 44px. That is the floor doing its job (`h-7` sets height, not min-height,
   * so `max(28px, 44px)` wins by design), not a class the cascade defeated.
   * Kept out of `requestedNotRendered` and recorded here so it stays visible.
   */
  heightHeldAtFloor: string[];
}

export function detectButtonGeometry(): ButtonGeometryReport {
  const siblingMismatch: string[] = [];
  const requestedNotRendered: string[] = [];
  const belowTapFloor: string[] = [];
  const heightHeldAtFloor: string[] = [];
  const FLOOR_SEL =
    "button:not([role='checkbox']):not([role='radio']):not([role='switch']), [role='button'], input[type='checkbox'], input[type='radio']";

  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05;
  };
  const name = (el: Element) =>
    ((el.getAttribute("aria-label") || (el as HTMLElement).innerText || "").trim().replace(/\s+/g, " ").slice(0, 32)) ||
    el.tagName.toLowerCase();
  // A control that LOOKS like a button: a <button>, or a link painted as one.
  // Bare text links and icon glyphs are excluded — they are sized by their text.
  const painted = (el: Element) => {
    const cs = getComputedStyle(el);
    return (
      cs.backgroundImage !== "none" ||
      (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") ||
      parseFloat(cs.borderTopWidth) > 0
    );
  };
  const isButtonish = (el: Element) =>
    (el.matches("button, [role='button']") || (el.matches("a[href]") && painted(el))) &&
    visible(el) &&
    ((el as HTMLElement).innerText || "").trim().length > 0 &&
    el.getBoundingClientRect().width >= 80;

  // ---- 1. siblings ---------------------------------------------------------
  // Unwrap single-child wrappers (<a><button/></a>, tooltip triggers) so the
  // comparison is between the painted controls, not their wrappers.
  const controlOf = (el: Element): Element | null => {
    let cur: Element | null = el;
    for (let depth = 0; cur && depth < 3; depth++) {
      if (isButtonish(cur)) return cur;
      cur = cur.children.length === 1 ? cur.children[0] : null;
    }
    return null;
  };
  const seen = new Set<string>();
  document.querySelectorAll("body *").forEach((parent) => {
    if (parent.children.length < 2 || parent.children.length > 12) return;
    const ctrls = [...parent.children].map(controlOf).filter((c): c is Element => !!c);
    for (let i = 0; i < ctrls.length; i++) {
      for (let j = i + 1; j < ctrls.length; j++) {
        const a = ctrls[i].getBoundingClientRect();
        const b = ctrls[j].getBoundingClientRect();
        const stacked = Math.abs(a.left - b.left) <= 2 && Math.abs(a.width - b.width) <= 2;
        const row = Math.abs(a.top - b.top) <= 2 || Math.abs(a.bottom - b.bottom) <= 2;
        if (!stacked && !row) continue;
        if (Math.abs(a.height - b.height) <= 1) continue;
        const line = `"${name(ctrls[i])}" ${a.height.toFixed(1)}px vs "${name(ctrls[j])}" ${b.height.toFixed(1)}px (${stacked ? "stacked" : "same row"})`;
        if (!seen.has(line)) { seen.add(line); siblingMismatch.push(line); }
      }
    }
  });

  // ---- 2. requested vs rendered -------------------------------------------
  // Only UNPREFIXED tokens (optionally `!`-important). A responsive or state
  // variant for the same utility makes the requested size conditional, so the
  // element is skipped for that utility rather than guessed at.
  const REM = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const toPx = (v: string): number | null => {
    const arb = /^\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(v);
    if (arb) return parseFloat(arb[1]) * (arb[2] === "rem" ? REM : 1);
    if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v) * 0.25 * REM;
    return null;
  };
  document.querySelectorAll("button, a[href], [role='button'], input, select, textarea").forEach((el) => {
    if (!visible(el)) return;
    const tokens = String((el as HTMLElement).className?.toString?.() ?? "").split(/\s+/);
    for (const util of ["min-h", "h", "min-w"] as const) {
      const variant = tokens.some((t) => new RegExp(`^[^\\s]+:!?${util}-`).test(t));
      if (variant) continue;
      const tok = tokens.find((t) => new RegExp(`^!?${util}-`).test(t));
      if (!tok) continue;
      const want = toPx(tok.replace(/^!?[a-z-]+?-(?=\[|\d)/, ""));
      if (want === null) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const got =
        util === "min-h" ? Math.max(parseFloat(cs.minHeight) || 0, 0) :
        util === "min-w" ? Math.max(parseFloat(cs.minWidth) || 0, 0) :
        r.height;
      // For `h-*`, an explicit `h-auto` also on the element means the author
      // released the height; the class list would contain both only by mistake
      // but is not this check's question.
      if (util === "h" && tokens.includes("h-auto")) continue;
      if (util === "h" && want < 44 && Math.abs(got - 44) <= 1 && el.matches(FLOOR_SEL) && tokens.every((t) => !/^!?min-h-/.test(t))) {
        heightHeldAtFloor.push(`"${name(el)}" asks ${tok} (${want}px), held at 44px`);
        continue;
      }
      if (Math.abs(got - want) > 1) {
        requestedNotRendered.push(`"${name(el)}" asks ${tok} (${want}px), renders ${got.toFixed(1)}px`);
      }
    }
  });

  // ---- 3. tap-target floor -------------------------------------------------
  document.querySelectorAll(FLOOR_SEL).forEach((el) => {
    if (!visible(el)) return;
    const tokens = String((el as HTMLElement).className?.toString?.() ?? "").split(/\s+/);
    const asks = (re: RegExp) => tokens.some((t) => re.test(t.replace(/^[^\s]*:/, "").replace(/^!/, "")));
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const short = r.height < 43.5 && parseFloat(cs.minHeight || "0") < 43.5 && !asks(/^(min-h|h|size)-/);
    const narrow = r.width < 43.5 && parseFloat(cs.minWidth || "0") < 43.5 && !asks(/^(min-w|w|size)-/);
    if (short || narrow) {
      belowTapFloor.push(`"${name(el)}" ${r.width.toFixed(1)}x${r.height.toFixed(1)}px`);
    }
  });

  return { siblingMismatch, requestedNotRendered, belowTapFloor, heightHeldAtFloor };
}
