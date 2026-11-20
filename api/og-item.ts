/**
 * A Declutter item's 1200x630 link-preview image (owner 11-20, site polish E: "og:image is a crop of the first photo
 * that's safe at both 1:1 and 1.91:1").
 *
 * The cover photo is drawn WHOLE inside the centre 630x630 square, on a faded, full-width fill of the same photo, so a
 * square crop (iMessage, some Facebook placements) keeps the entire item and the 1.91:1 card has no bars. Before,
 * shop-photo's cover crop to 1200x630 cut a portrait photo to a thin middle band. Layout: src/lib/ogItemCard.mjs.
 *
 * Server only: nothing in src/ imports this file, so it adds nothing to any page's bundle; only link-preview crawlers
 * fetch it (api/share.ts writes its URL as the item page's ONE og:image).
 *
 * Data: the SAME anon read api/share.ts makes (declutter_public_item_card), so a sold, withdrawn, hidden or
 * switched-off item is refused here exactly as there; the photo is fetched only through this project's shop-photo
 * function by photo id (kind=declutter re-checks the item is link-visible), never by URL from the request (no SSRF),
 * and only when it is the item's current cover.
 *
 * Only the canonical URL renders (as api/og-profile.ts): exactly `?id=<item>&p=<cover>&v=<style>`. Any other query is
 * answered with a 302 to the canonical URL (or to the brand image), so nobody can skip the CDN cache to force renders.
 * Any miss or render error answers a 302 to the site's 1200x630 brand image, never a 500, and is never CDN-cached.
 *
 * Renderer: satori + @resvg/resvg-wasm, as og-profile (see its header for why not @vercel/og). No text is drawn, but
 * satori needs one font loaded, so it reads one Montserrat subset (api/_og/, shipped by vercel.json includeFiles).
 */
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { OG_ITEM_HEIGHT, OG_ITEM_WIDTH, isUuid, ogItemImageUrl, ogItemPhotoUrl } from "../src/lib/ogItemCard.mjs";

const SITE_ORIGIN = (process.env.OG_SITE_ORIGIN || "https://www.louisianahelpr.com").replace(/\/$/, "");
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";

const UPSTREAM_TIMEOUT_MS = 2000;
/** Minutes, like the item page's card: a sold or withdrawn item stops previewing soon. Its URL changes with the cover. */
export const OG_ITEM_CDN_CACHE = "public, s-maxage=600, stale-while-revalidate=600";
/** Where every miss goes: the shell's own 1200x630 brand card (index.html og:image). */
export const OG_ITEM_FALLBACK = "/og-image.png?v=h3";
/** The canonical query is under 200 characters; a longer one is refused before any work. */
const MAX_QUERY = 200;
const PARCHMENT = "#F4F2EE";

/** The item's current cover photo id, or null (gone, hidden, no photo, slow database). */
async function fetchCoverId(itemId: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/declutter_public_item_card`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_item_id: itemId }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const card = (await res.json()) as { photo_id?: unknown } | null;
  return card && isUuid(card.photo_id) ? card.photo_id.toLowerCase() : null;
}

/** The photo as a data URI, or null (a JPEG or PNG only). */
async function fetchDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  const res = await fetch(url, { headers: { Accept: "image/jpeg,image/png" }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  if (!res.ok || (type !== "image/jpeg" && type !== "image/png")) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length ? `data:${type};base64,${bytes.toString("base64")}` : null;
}

type Node = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style, children, ...extra },
});

/**
 * The card's element tree (exported for the guard): the photo faded across the whole card (cover), a light wash over
 * it, then the whole photo fitted (contain) in the centre 630x630 square, which is the part a square crop keeps.
 */
export function ogItemTree(photo: string): Node {
  const side = OG_ITEM_HEIGHT;
  return el(
    "div",
    { width: OG_ITEM_WIDTH, height: OG_ITEM_HEIGHT, display: "flex", position: "relative", background: PARCHMENT, alignItems: "center", justifyContent: "center" },
    [
      el("img", { position: "absolute", left: 0, top: 0, width: OG_ITEM_WIDTH, height: OG_ITEM_HEIGHT, objectFit: "cover", opacity: 0.25 }, undefined, { src: photo, width: OG_ITEM_WIDTH, height: OG_ITEM_HEIGHT }),
      el("div", { position: "absolute", left: 0, top: 0, width: OG_ITEM_WIDTH, height: OG_ITEM_HEIGHT, background: "rgba(244, 242, 238, 0.55)", display: "flex" }),
      el("img", { position: "absolute", left: (OG_ITEM_WIDTH - side) / 2, top: 0, width: side, height: side, objectFit: "contain" }, undefined, { src: photo, width: side, height: side }),
    ],
  );
}

let font: Buffer | null = null;
let wasmReady: Promise<void> | null = null;
function ensureRenderer(): Promise<void> {
  font ??= readFileSync(new URL("./_og/Montserrat-400-latin.woff", import.meta.url));
  wasmReady ??= initWasm(readFileSync(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm"))).catch((e: unknown) => {
    // A failed init is retried by the next request instead of poisoning the instance.
    wasmReady = null;
    throw e;
  });
  return wasmReady;
}

async function renderPng(tree: Node): Promise<Uint8Array> {
  await ensureRenderer();
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: OG_ITEM_WIDTH,
    height: OG_ITEM_HEIGHT,
    fonts: font ? [{ name: "Montserrat", data: font, weight: 400, style: "normal" }] : [],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_ITEM_WIDTH } }).render().asPng();
}

function fallback(): Response {
  return new Response(null, { status: 302, headers: { Location: `${SITE_ORIGIN}${OG_ITEM_FALLBACK}`, "Cache-Control": "no-store" } });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.search.length > MAX_QUERY) return fallback();
      const itemId = url.searchParams.get("id") || "";
      // The id is checked BEFORE any read: only a uuid reaches the RPC.
      if (!isUuid(itemId)) return fallback();
      const cover = await fetchCoverId(itemId.toLowerCase());
      if (!cover) return fallback();
      const canonical = ogItemImageUrl(SITE_ORIGIN, itemId, cover);
      if (!canonical) return fallback();
      if (url.search !== canonical.slice(canonical.indexOf("?"))) {
        return new Response(null, {
          status: 302,
          headers: { Location: canonical, "Cache-Control": "public, max-age=300", "Vercel-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=300" },
        });
      }
      const photo = await fetchDataUri(ogItemPhotoUrl(SUPABASE_URL, cover));
      if (!photo) return fallback();
      // Rendered in full before answering, so a render failure lands in the catch (a fallback), never a broken body.
      const png = await renderPng(ogItemTree(photo));
      return new Response(Buffer.from(png), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=600",
          "Vercel-CDN-Cache-Control": OG_ITEM_CDN_CACHE,
          "X-Robots-Tag": "noindex",
        },
      });
    } catch {
      // Silence is the contract: a card that cannot be drawn answers the brand image, never a 500.
      return fallback();
    }
  },
};
