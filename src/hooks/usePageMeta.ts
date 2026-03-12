import { useEffect } from "react";

interface PageMeta {
  title: string;
  description: string;
  keywords?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  geoRegion?: string;
  geoPlacename?: string;
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
    if (meta.geoRegion) setMeta("geo.region", meta.geoRegion);
    if (meta.geoPlacename) setMeta("geo.placename", meta.geoPlacename);

    return () => {
      document.title = "Helpr";
    };
  }, [meta.title, meta.description, meta.keywords, meta.canonical, meta.ogTitle, meta.ogDescription, meta.geoRegion, meta.geoPlacename]);
};
