/**
 * MOCK-UP ONLY (wip/design-small-mocks + wip/design-tweaks-mock, 2026-10-18):
 * never lands. Lets one build show today's look (no flag) and each owner
 * option side by side.
 * localStorage "lh-mock" = {"bar":"A"|"B","gloss":"A"|"B","words":true,"more":true,"t":[1..8]}
 *   t = the eight "small modern tweaks" (design-tweaks lane): 1 plain titles,
 *   2 cleaner cards, 3 simpler job cards, 4 iOS big titles, 5 skeletons,
 *   6 bottom sheets, 7 pill chips, 8 press + haptics.
 */
export type MockFlags = { bar?: "A" | "B"; gloss?: "A" | "B"; words?: boolean; more?: boolean; t?: number[] };

function read(): MockFlags {
  try {
    return JSON.parse(window.localStorage.getItem("lh-mock") || "{}") as MockFlags;
  } catch {
    // Mock-only: unreadable storage or bad JSON simply means "no mock flags".
    return {};
  }
}

export const MOCK: MockFlags = typeof window === "undefined" ? {} : read();

/** True when tweak `n` (1-8) is switched on for this mock build. */
export const tweak = (n: number): boolean => Array.isArray(MOCK.t) && MOCK.t.includes(n);

if (typeof document !== "undefined" && MOCK.gloss) {
  document.documentElement.classList.add(`mock-gloss-${MOCK.gloss.toLowerCase()}`);
}
if (typeof document !== "undefined" && Array.isArray(MOCK.t)) {
  for (const n of MOCK.t) document.documentElement.classList.add(`mock-t${n}`);
}

/* T4 — iOS large titles. Any scroller past 24px marks <html> scrolled; the
   CSS shrinks the title into the bar. AppPage screens (title scrolls away
   with the content) get a compact bar that fades in with the page's h1. */
if (typeof document !== "undefined" && tweak(4)) {
  let bar: HTMLDivElement | null = null;
  const ensureBar = () => {
    if (bar) return bar;
    bar = document.createElement("div");
    bar.className = "mock-compact-bar";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    return bar;
  };
  document.addEventListener(
    "scroll",
    (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const scrolled = t.scrollTop > 24;
      document.documentElement.classList.toggle("mock-scrolled", scrolled);
      if (t.matches("[data-app-page-scroll]")) {
        const h1 = t.querySelector("h1.text-page-title");
        const b = ensureBar();
        b.textContent = h1?.textContent ?? "";
        b.classList.toggle("on", t.scrollTop > 56);
      }
    },
    true,
  );
}
