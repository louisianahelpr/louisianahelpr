/**
 * The desktop Declutter Browse map column's height (DeclutterBrowseView useFillHeight): the scroll column's visible
 * height minus the padding that sits above and below the list in it (the column's own bottom padding and its inner
 * wrapper's top and bottom padding: SectionScreen's `pb-safe-nav` and `pt-1 pb-6`).
 *
 * DA-8 (Declutter audit 10-29): it was `clientHeight - 24`, and the 44px of padding around it made a short Browse
 * list with the map beside it scroll 20px at 1440 (scrollHeight 791 vs clientHeight 771).
 * Guard: src/lib/declutter/mapFillHeight.test.ts.
 */
export function mapFillHeight(scroller: HTMLElement): number {
  const px = (el: Element | null, prop: "paddingTop" | "paddingBottom") => (el ? parseFloat(getComputedStyle(el)[prop]) || 0 : 0);
  const inner = scroller.firstElementChild;
  const around = px(scroller, "paddingBottom") + px(inner, "paddingTop") + px(inner, "paddingBottom");
  return Math.max(320, scroller.clientHeight - around);
}
