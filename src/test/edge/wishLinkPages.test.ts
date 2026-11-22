/**
 * wish-link-pages (gift lists lane, 2026-11-21): the server read of a pasted link's title, photo and price for Admin ->
 * Wish list links. Unit tests of supabase/functions/wish-link-pages/pageDetails.ts with the resolver and fetch injected,
 * asserting which addresses the module was willing to CONNECT to (as str-ical-safeFetch.test.ts does):
 *   - only a listed shop is ever fetched; never Amazon (in any form), never a short or affiliate link, never http;
 *   - every hop passes the str-ical-sync SSRF gate (a listed name resolving to a private address is blocked) and a
 *     redirect is followed only to another listed shop;
 *   - the page's title / photo / USD price are read from Open Graph and schema.org Product data, cleaned, and a price in
 *     another currency is never taken;
 *   - the body is read up to MAX_PAGE_BYTES only; a non-HTML answer or an error status is "failed".
 *
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts | const AMAZON = /(^\|\.)(amazon\.[a-z.]+\|amzn\.[a-z]+\|a\.co)$/i; | const AMAZON = /^$/;
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts |   if (target.protocol !== "https:" \|\| !isShopHost(target.hostname)) return { status: "skipped" }; |   if (target.protocol !== "https:") return { status: "skipped" };
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts |         if (next.protocol !== "https:" \|\| !isShopHost(next.hostname)) return { status: "skipped" }; |         if (next.protocol !== "https:") return { status: "skipped" };
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts |     target = await checked(target.toString()); |     target = new URL(target.toString());
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts |         target = await checked(next.toString()); |         target = next;
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts |           if (String(of.priceCurrency ?? "").toUpperCase() !== "USD") continue; |           void of.priceCurrency;
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts |     if (cur === "USD") price = | if (cur !== "") price =
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts |     if (u.protocol !== "https:" \|\| u.username \|\| u.password) return null; |     if (u.username \|\| u.password) return null;
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts |     while (total < limit) { |     while (true) {
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts |   return n > 0 && n < 100_000 ? n : null; |   return n;
 * @mutate supabase/functions/wish-link-pages/pageDetails.ts |     if (++blocks > 20) break; |     void blocks;
 */
import { describe, expect, it, vi } from "vitest";

import * as M from "../../../supabase/functions/wish-link-pages/pageDetails";

type DnsResolver = (hostname: string) => Promise<string[]>;

const PUBLIC: DnsResolver = async () => ["151.101.1.1"];
const html = (body: string, type = "text/html; charset=utf-8", status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": type, ...headers } });
const PRODUCT = `<!doctype html><html><head><title>Fallback &amp; title</title>
  <meta property="og:title" content="Hand Knit Scarf &#8211; Cream">
  <meta property="og:image" content="//i.etsystatic.com/il/1.jpg">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":"Product","name":"Scarf","offers":[{"@type":"Offer","price":"38.50","priceCurrency":"USD"}]}]}</script>
</head><body>...</body></html>`;

describe("wish-link-pages: which pages are read", () => {
  it("only listed shops (and their subdomains); never Amazon, short or affiliate links", () => {
    // Inventory floor: the list holds 41 shops today (Zappos, owned by Amazon, is not on it).
    expect(M.SHOP_HOSTS.length).toBeGreaterThan(30);
    expect(M.SHOP_HOSTS.some((h) => h.includes("amazon") || h.includes("amzn") || /(^|\.)a\.co$/.test(h))).toBe(false);
    for (const ok of ["www.etsy.com", "etsy.com", "www.target.com", "shop.lululemon.com"]) expect(M.isShopHost(ok), ok).toBe(true);
    // Even if Amazon were added to the list by mistake, it is never a shop we read.
    (M.SHOP_HOSTS as string[]).push("amazon.com", "amzn.to");
    try {
      expect(M.isShopHost("www.amazon.com")).toBe(false);
      expect(M.isShopHost("amzn.to")).toBe(false);
    } finally {
      (M.SHOP_HOSTS as string[]).splice(-2, 2);
    }
    for (const no of ["www.amazon.com", "amazon.co.uk", "smile.amazon.com", "amzn.to", "a.co", "bit.ly", "go.shopmy.us", "etsy.com.evil.example", "notetsy.com", "www.zappos.com"]) {
      expect(M.isShopHost(no), no).toBe(false);
    }
  });

  it("an Amazon, unlisted, short or http link is never fetched", async () => {
    const fetchImpl = vi.fn(async () => html(PRODUCT));
    for (const u of ["https://www.amazon.com/dp/B000000001", "https://amzn.to/abc", "https://bit.ly/x", "https://go.shopmy.us/p-1", "http://www.etsy.com/listing/1", "https://shop.example.com/x", "not a link"]) {
      expect(await M.fetchPageDetails(u, { resolve: PUBLIC, fetchImpl: fetchImpl as unknown as typeof fetch }), u).toEqual({ status: "skipped" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a listed name that resolves to a private address is blocked before any connection", async () => {
    const fetchImpl = vi.fn(async () => html(PRODUCT));
    const out = await M.fetchPageDetails("https://www.etsy.com/listing/1", { resolve: async () => ["127.0.0.1"], fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toEqual({ status: "blocked" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a redirect is followed only to another listed shop, and re-checked", async () => {
    const seen: string[] = [];
    const hop = (to: string) => vi.fn(async (u: string) => {
      seen.push(u);
      return seen.length === 1 ? new Response(null, { status: 302, headers: { location: to } }) : html(PRODUCT);
    });
    // To a short link: stops, nothing more fetched.
    let f = hop("https://bit.ly/x");
    expect(await M.fetchPageDetails("https://www.etsy.com/listing/1", { resolve: PUBLIC, fetchImpl: f as unknown as typeof fetch })).toEqual({ status: "skipped" });
    expect(seen).toEqual(["https://www.etsy.com/listing/1"]);
    // To a listed shop whose name resolves privately: blocked.
    seen.length = 0;
    f = hop("https://www.target.com/p/x");
    const priv: DnsResolver = async (h) => (h === "www.target.com" ? ["10.0.0.5"] : ["151.101.1.1"]);
    expect(await M.fetchPageDetails("https://www.etsy.com/listing/1", { resolve: priv, fetchImpl: f as unknown as typeof fetch })).toEqual({ status: "blocked" });
    expect(seen).toHaveLength(1);
    // To the same shop (www): followed and read.
    seen.length = 0;
    f = hop("/listing/1/scarf");
    const ok = await M.fetchPageDetails("https://etsy.com/listing/1", { resolve: PUBLIC, fetchImpl: f as unknown as typeof fetch });
    expect(ok.status).toBe("ok");
    expect(seen).toEqual(["https://etsy.com/listing/1", "https://etsy.com/listing/1/scarf"]);
  });

  it("an error status or a page that is not HTML is failed; the body is read up to the cap only", async () => {
    expect(await M.fetchPageDetails("https://www.etsy.com/l/1", { resolve: PUBLIC, fetchImpl: (async () => html("x", "text/html", 403)) as unknown as typeof fetch })).toEqual({ status: "failed" });
    expect(await M.fetchPageDetails("https://www.etsy.com/l/1", { resolve: PUBLIC, fetchImpl: (async () => html("{}", "application/json")) as unknown as typeof fetch })).toEqual({ status: "failed" });
    // An endless body: the read stops at the cap.
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 64 * 1024;
        if (pulled > 50 * 1024 * 1024) return c.close();
        c.enqueue(new TextEncoder().encode(" ".repeat(64 * 1024)));
      },
    });
    const out = await M.fetchPageDetails("https://www.etsy.com/l/1", { resolve: PUBLIC, fetchImpl: (async () => new Response(endless, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch });
    expect(out.status).toBe("none");
    expect(pulled).toBeLessThanOrEqual(M.MAX_PAGE_BYTES + 3 * 64 * 1024);
  });
});

describe("wish-link-pages: what is read from a page", () => {
  it("title, absolute https photo and the Product's USD price", async () => {
    const out = await M.fetchPageDetails("https://www.etsy.com/listing/1", { resolve: PUBLIC, fetchImpl: (async () => html(PRODUCT)) as unknown as typeof fetch });
    expect(out).toEqual({ status: "ok", details: { title: "Hand Knit Scarf – Cream", image: "https://i.etsystatic.com/il/1.jpg", price: 38.5 } });
  });

  it("at most 20 JSON-LD blocks are read (a page of unclosed tags cannot make it slow)", () => {
    const page = new URL("https://www.etsy.com/l/1");
    const junk = `<script type="application/ld+json">{"@type":"Thing"}</script>`.repeat(20);
    const priced = `<script type="application/ld+json">{"@type":"Product","offers":{"price":"9","priceCurrency":"USD"}}</script>`;
    expect(M.readPageDetails(junk.slice(0, -junk.length / 20) + priced, page).price).toBe(9);
    expect(M.readPageDetails(junk + priced, page).price).toBeNull();
  });

  it("a slow address lookup is held to the page's time budget", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => html(PRODUCT));
      const p = M.fetchPageDetails("https://www.etsy.com/l/1", { resolve: () => new Promise(() => undefined), fetchImpl: fetchImpl as unknown as typeof fetch });
      await vi.advanceTimersByTimeAsync(13_000);
      expect(await p).toEqual({ status: "failed" });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a price in another currency is never taken; meta price only with a USD tag", () => {
    const page = new URL("https://www.etsy.com/l/1");
    const eur = `<script type="application/ld+json">{"@type":"Product","offers":{"price":"20","priceCurrency":"EUR"}}</script>`;
    expect(M.readPageDetails(eur, page).price).toBeNull();
    expect(M.readPageDetails(`<meta property="product:price:amount" content="12.00"><meta property="product:price:currency" content="GBP">`, page).price).toBeNull();
    expect(M.readPageDetails(`<meta property="product:price:amount" content="12.00"><meta property="product:price:currency" content="USD">`, page).price).toBe(12);
    expect(M.readPageDetails(`<meta property="product:price:amount" content="12.00">`, page).price).toBeNull();
  });

  it("an http or credentialed photo is dropped; titles are cleaned; odd prices are dropped", () => {
    const page = new URL("https://www.etsy.com/l/1");
    expect(M.readPageDetails(`<meta property="og:image" content="http://x.example.com/a.jpg">`, page).image).toBeNull();
    expect(M.readPageDetails(`<meta property="og:image" content="https://u:p@x.example.com/a.jpg">`, page).image).toBeNull();
    expect(M.cleanTitle("  <b>Big</b>\u202e  Sale\u200b ")).toBe("Big Sale");
    expect(M.cleanTitle("x".repeat(300))!.length).toBe(200);
    for (const bad of ["0", "-3", "100000", "1e3", "abc", "", null]) expect(M.cleanPrice(bad), String(bad)).toBeNull();
    expect(M.cleanPrice("$1,299.99")).toBe(1299.99);
  });
});
