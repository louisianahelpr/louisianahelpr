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
