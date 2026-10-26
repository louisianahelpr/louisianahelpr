/**
 * iOS-style large titles (owner 2026-10-18, tweak 4). A page's big title
 * shrinks into a compact bar once its scroller moves past 24px:
 * - `html.page-scrolled` is toggled for any scroller; the CSS in index.css
 *   ("T4") shrinks `.page-title-card` into a slim frosted bar.
 * - AppPage screens (`[data-app-page-scroll]`, whose h1 scrolls away with the
 *   content) get a fixed compact bar showing the page's title past 56px.
 * Installed once from main.tsx. The bar is aria-hidden: the real h1 stays the
 * page's heading for assistive tech.
 */
/**
 * A route change starts the new page unscrolled, so its title is large again
 * (Cowork design audit 2026-10-20, D4). Without this, scrolling Declutter's
 * Browse past 56px and tapping an item left Browse's "Declutter" compact bar
 * (and `page-scrolled`) on top of the item page, covering its back, share and
 * heart buttons: the new page's scroller never fired a scroll event to turn
 * them off. ScrollToTop calls this on every pathname change; a restored scroll
 * (Back) fires its own scroll event, which turns them on again if it should.
 */
export function resetLargeTitles(doc: Document = document): void {
  doc.documentElement.classList.remove("page-scrolled");
  doc.querySelectorAll(".compact-title-bar.on").forEach((b) => b.classList.remove("on"));
}

export function installLargeTitles(doc: Document = document): () => void {
  let bar: HTMLDivElement | null = null;
  const ensureBar = (): HTMLDivElement => {
    if (bar) return bar;
    bar = doc.createElement("div");
    bar.className = "compact-title-bar";
    bar.setAttribute("aria-hidden", "true");
    doc.body.appendChild(bar);
    return bar;
  };
  const onScroll = (e: Event) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    // A sideways scroller (chip rows) has no vertical travel; it must not reset the page's state.
    // Only a SIDEWAYS one is skipped: a page scroller whose new screen is too short to scroll
    // (Post a job's "What kind of home job?", owner iPhone 2026-10-26) still reports its return to
    // the top here, and skipping it left the compact bar on over the back button with nothing to scroll.
    if (t.scrollHeight <= t.clientHeight + 1 && t.scrollWidth > t.clientWidth + 1) return;
    doc.documentElement.classList.toggle("page-scrolled", t.scrollTop > 24);
    if (t.matches("[data-app-page-scroll]")) {
      const h1 = t.querySelector("h1.text-page-title");
      const b = ensureBar();
      b.textContent = h1?.textContent ?? "";
      b.classList.toggle("on", t.scrollTop > 56);
    }
  };
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    doc.removeEventListener("scroll", onScroll, { capture: true });
    bar?.remove();
    bar = null;
    doc.documentElement.classList.remove("page-scrolled");
  };
}
