import { useEffect } from "react";

/**
 * Audit 11-21 (P14): /search?q= and /post-job are reachable signed out, so a crawler indexed them with the home
 * page's description. A page that is a tool, not content, says noindex for as long as it is mounted (removed on
 * unmount, like usePageMeta's robots, so the next route never inherits it). Guard: src/test/jobsAudit1121Mediums.test.tsx.
 */
export function useNoIndex(active = true) {
  useEffect(() => {
    if (!active) return;
    let el = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const created = !el;
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", "robots");
      document.head.appendChild(el);
    }
    const before = el.getAttribute("content");
    el.setAttribute("content", "noindex, follow");
    return () => {
      if (!el) return;
      if (created) el.remove();
      else if (before !== null) el.setAttribute("content", before);
    };
  }, [active]);
}
