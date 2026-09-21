// usePageMeta sets page <title> + <meta name=...> tags for SEO + share
// previews. Bugs here hurt search rankings + render wrong link
// previews on Slack/Twitter/SMS.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePageMeta } from "./usePageMeta";

beforeEach(() => {
  document.title = "Helpr";
  // Clear all meta tags + canonical link
  document.head.querySelectorAll("meta, link[rel='canonical']").forEach((el) => el.remove());
});

afterEach(() => {
  document.title = "Helpr";
  document.head.querySelectorAll("meta, link[rel='canonical']").forEach((el) => el.remove());
});

describe("usePageMeta", () => {
  it("sets document.title to the provided title", () => {
    renderHook(() => usePageMeta({ title: "Browse Jobs · Helpr", description: "..." }));
    expect(document.title).toBe("Browse Jobs · Helpr");
  });

  it("creates a meta description tag and sets content", () => {
    renderHook(() =>
      usePageMeta({
        title: "T",
        description: "Find local help in Louisiana parishes",
      }),
    );
    const desc = document.querySelector('meta[name="description"]');
    expect(desc?.getAttribute("content")).toBe("Find local help in Louisiana parishes");
  });

  it("updates an existing meta description tag in place (no duplication)", () => {
    // Pre-existing tag from index.html
    const existing = document.createElement("meta");
    existing.setAttribute("name", "description");
    existing.setAttribute("content", "Old description");
    document.head.appendChild(existing);

    renderHook(() => usePageMeta({ title: "T", description: "New description" }));

    const all = document.querySelectorAll('meta[name="description"]');
    expect(all).toHaveLength(1); // no duplicate
    expect(all[0].getAttribute("content")).toBe("New description");
  });

  it("creates og:title with property attr (not name) for OpenGraph compliance", () => {
    renderHook(() =>
      usePageMeta({ title: "T", description: "D", ogTitle: "Helpr · Marketplace" }),
    );
    const og = document.querySelector('meta[property="og:title"]');
    expect(og?.getAttribute("content")).toBe("Helpr · Marketplace");
    // Should NOT also create a name="og:title" tag
    expect(document.querySelector('meta[name="og:title"]')).toBeNull();
  });

  it("creates og:description with property attr", () => {
    renderHook(() =>
      usePageMeta({ title: "T", description: "D", ogDescription: "OG description here" }),
    );
    const og = document.querySelector('meta[property="og:description"]');
    expect(og?.getAttribute("content")).toBe("OG description here");
  });

  it("sets canonical link", () => {
    renderHook(() =>
      usePageMeta({
        title: "T",
        description: "D",
        canonical: "https://www.louisianahelpr.com/browse",
      }),
    );
    const link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    expect(link?.href).toBe("https://www.louisianahelpr.com/browse");
  });

  it("does NOT create optional tags when not provided", () => {
    renderHook(() => usePageMeta({ title: "T", description: "D" }));
    expect(document.querySelector('meta[name="keywords"]')).toBeNull();
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[property="og:title"]')).toBeNull();
  });

  it("sets geo.region + geo.placename for local SEO", () => {
    renderHook(() =>
      usePageMeta({
        title: "T",
        description: "D",
        geoRegion: "US-LA",
        geoPlacename: "New Orleans",
      }),
    );
    expect(
      document.querySelector('meta[name="geo.region"]')?.getAttribute("content"),
    ).toBe("US-LA");
    expect(
      document.querySelector('meta[name="geo.placename"]')?.getAttribute("content"),
    ).toBe("New Orleans");
  });

  it("resets document.title to 'Helpr' on unmount", () => {
    const { unmount } = renderHook(() =>
      usePageMeta({ title: "Custom Page Title", description: "D" }),
    );
    expect(document.title).toBe("Custom Page Title");
    unmount();
    expect(document.title).toBe("Helpr");
  });

  // ── og:url ────────────────────────────────────────────────────────────────
  it("falls og:url back to the canonical when only `canonical` is given", () => {
    // Untested until 2026-09-21: deleting the `?? meta.canonical` fallback left
    // every social unfurl without an og:url with the whole file green.
    renderHook(() =>
      usePageMeta({ title: "T", description: "D", canonical: "https://www.louisianahelpr.com/browse" }),
    );
    expect(
      document.querySelector('meta[property="og:url"]')?.getAttribute("content"),
    ).toBe("https://www.louisianahelpr.com/browse");
  });

  it("prefers an explicit ogUrl over the canonical", () => {
    renderHook(() =>
      usePageMeta({
        title: "T",
        description: "D",
        canonical: "https://www.louisianahelpr.com/browse",
        ogUrl: "https://www.louisianahelpr.com/share/browse",
      }),
    );
    expect(
      document.querySelector('meta[property="og:url"]')?.getAttribute("content"),
    ).toBe("https://www.louisianahelpr.com/share/browse");
  });

  // ── robots ────────────────────────────────────────────────────────────────
  // This block covers the "engages but never releases" shape. The noindex tag
  // is appended to a document that OUTLIVES the route, so the release half —
  // removing it on unmount — is the half that matters: a stale noindex
  // inherited by the next route de-indexes an indexable page, and nothing else
  // in the app would ever notice. Neither half was tested until 2026-09-21.
  it("emits no robots tag by default", () => {
    renderHook(() => usePageMeta({ title: "T", description: "D" }));
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("emits <meta name=robots content=noindex> when a page opts out", () => {
    renderHook(() => usePageMeta({ title: "T", description: "D", robots: "noindex" }));
    expect(
      document.querySelector('meta[name="robots"]')?.getAttribute("content"),
    ).toBe("noindex");
  });

  it("REMOVES the robots tag on unmount so the next route is not de-indexed", () => {
    const { unmount } = renderHook(() =>
      usePageMeta({ title: "T", description: "D", robots: "noindex" }),
    );
    expect(document.querySelector('meta[name="robots"]')).not.toBeNull();
    unmount();
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
});

// @mutate src/hooks/usePageMeta.ts | if (robotsEl && robotsEl.parentNode) robotsEl.parentNode.removeChild(robotsEl); | void robotsEl;
// @mutate src/hooks/usePageMeta.ts | const ogUrl = meta.ogUrl ?? meta.canonical; | const ogUrl = meta.ogUrl;
