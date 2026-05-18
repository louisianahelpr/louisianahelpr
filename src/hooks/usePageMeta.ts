import { useEffect } from "react";

interface PageMeta {
  title: string;
  description: string;
  keywords?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogUrl?: string;
  geoRegion?: string;
  geoPlacename?: string;
  /** When "noindex", emits <meta name="robots" content="noindex"> for the
   *  page lifetime. Used on error/utility pages the SPA serves as 200s. */
  robots?: string;
}

export const usePageMeta = (meta: PageMeta) => {
  useEffect(() => {
    document.title = meta.title;

    const setMeta = (name: string, content: string, attr = "name") => {
      let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("description", meta.description);
    if (meta.keywords) setMeta("keywords", meta.keywords);
    if (meta.canonical) {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.rel = "canonical";
        document.head.appendChild(link);
      }
      link.href = meta.canonical;
    }
    if (meta.ogTitle) setMeta("og:title", meta.ogTitle, "property");
    if (meta.ogDescription) setMeta("og:description", meta.ogDescription, "property");
    // og:url falls back to the canonical so social unfurls always point at
    // the indexable URL even when only `canonical` is supplied.
    const ogUrl = meta.ogUrl ?? meta.canonical;
    if (ogUrl) setMeta("og:url", ogUrl, "property");
    if (meta.geoRegion) setMeta("geo.region", meta.geoRegion);
    if (meta.geoPlacename) setMeta("geo.placename", meta.geoPlacename);

    // Robots: only emit the tag while a page explicitly opts out of
    // indexing, and remove it on unmount so the next (indexable) route
    // doesn't inherit a stale noindex.
    let robotsEl: HTMLMetaElement | null = null;
    if (meta.robots) {
      robotsEl = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
      if (!robotsEl) {
        robotsEl = document.createElement("meta");
        robotsEl.setAttribute("name", "robots");
        document.head.appendChild(robotsEl);
      }
      robotsEl.setAttribute("content", meta.robots);
    }

    return () => {
      document.title = "Helpr";
      if (robotsEl && robotsEl.parentNode) robotsEl.parentNode.removeChild(robotsEl);
    };
  }, [meta.title, meta.description, meta.keywords, meta.canonical, meta.ogTitle, meta.ogDescription, meta.ogUrl, meta.geoRegion, meta.geoPlacename, meta.robots]);
};
