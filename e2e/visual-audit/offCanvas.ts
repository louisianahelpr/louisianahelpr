/**
 * The responsive audit's "element past the right edge" check, as one
 * self-contained function so the spec can hand it to `page.evaluate` and
 * src/test/responsiveOffCanvasClip.test.ts can run it in jsdom.
 *
 * It measures what the member can SEE: each element's box is cut to every
 * ancestor that clips its content (overflow-x other than `visible`). A chip in
 * a sideways scroll strip (StatusBoxes: Jobs > Posted/Working, Declutter) runs
 * past the phone's edge inside its strip, and the strip clips it. That is the
 * strip working, not a page that does not fit. Reading the raw box called it
 * overflow on every 06-activity run from 2026-10-20 on (e2e-real-backend
 * 41330878323: "<button .inline-flex> right=382" at 375). An element that a
 * clipping ancestor does NOT contain, or a strip that itself pokes past the
 * edge, is still reported.
 *
 * Self-contained on purpose: Playwright serializes the function's source, so
 * it may not call anything defined outside it.
 */
export interface OffCanvasHit {
  tag: string;
  cls: string;
  id: string;
  rect: { x: number; y: number; w: number; h: number };
}

export function findOffCanvas(): OffCanvasHit[] {
  const viewportW = window.innerWidth;
  const hits: OffCanvasHit[] = [];
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, a, input, textarea, select, [role=button], h1, h2, h3, p, li, label",
    ),
  );
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    // The part of the box no clipping ancestor hides.
    let left = r.left;
    let right = r.right;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox === "visible" || ox === "") continue;
      const ar = a.getBoundingClientRect();
      left = Math.max(left, ar.left);
      right = Math.min(right, ar.right);
    }
    if (right <= left) continue; // scrolled fully out of its strip: not on screen
    if (right > viewportW + 2 && left < viewportW) {
      hits.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 60),
        id: el.id || "",
        rect: { x: Math.round(left), y: Math.round(r.top), w: Math.round(right - left), h: Math.round(r.height) },
      });
      if (hits.length >= 5) break;
    }
  }
  return hits;
}
