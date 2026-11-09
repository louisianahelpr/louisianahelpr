/**
 * The branded 1200x630 link card for a shareable profile (/u/<handle>).
 *
 * M1 slice 2 (share-profile audit 2026-11-05, Q2759): a pasted /u link used to preview as a bare face crop with no
 * name or brand. api/share.ts now points the /u page's ONE og:image at this function, which draws the member's own
 * photo (or their initial), name, town, rating, counts and the Louisiana Helpr brand into a 1200x630 PNG.
 *
 * Server only: nothing here is imported by src/, so it adds nothing to any page's bundle, and no page loads it; only
 * link-preview crawlers (and the share sheet) fetch it.
 *
 * Data: the SAME anon read the page and api/share.ts make (public_profile_by_handle), so a hidden, banned, deleted or
 * test-hidden profile is refused here exactly as there. The photo is fetched only from this project's own avatars
 * bucket (avatars/<uuid>/avatar.jpg|png, the shape api/share.ts accepts); any other URL is never fetched (no SSRF).
 *
 * Failure: any miss (bad handle, profile gone, database slow, render error) answers a 302 to the site's 1200x630 brand
 * image, never a 500, and is never CDN-cached, so a crawler still shows a branded card and the next fetch retries.
 *
 * Only the canonical URL renders (lh-appsec, 11-05): exactly `?h=<current handle>&v=<tag of what the card draws now>`,
 * the URL api/share.ts writes. Any other query (a random ?v=, an extra parameter, an old handle) is answered with a
 * 302 to the canonical URL, so nobody can skip the CDN cache to force a fresh render.
 *
 * Renderer: satori (element tree -> SVG) + @resvg/resvg-wasm (SVG -> PNG), both pure JS/wasm, no native code.
 * @vercel/og was dropped: 0.11.x pins satori 0.25 (GHSA-wx4j-mvgx-mqwp) and pulls in sharp; 1.0.3's Node build
 * throws at import in plain ESM ("Dynamic require of fs"). The fonts are the site's own (owner's UI audit 11-09, F077: the
 * card was drawn in a generic system-looking face): Montserrat 400/600 for the text and Bodoni Moda 700 for the name,
 * each as its Google Fonts latin + latin-ext WOFF subsets (satori reads WOFF, not WOFF2), then the rating's star from
 * Noto Sans Symbols 2 (a one-glyph subset), with Geist Regular kept last. All SIL OFL 1.1, licences in api/_og/.
 */
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { OG_PROFILE_HEIGHT, OG_PROFILE_WIDTH, ogProfileImageUrl, ogProfileLines, ogProfilePhotoUrl, type OgProfileCard } from "../src/lib/ogProfileCard.mjs";

const SITE_ORIGIN = (process.env.OG_SITE_ORIGIN || "https://www.louisianahelpr.com").replace(/\/$/, "");
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";

/** Each upstream read gets this long; the whole card must stay well inside a crawler's patience. */
const UPSTREAM_TIMEOUT_MS = 1500;
/** The same handle rule the database checks (profiles_handle_format) and api/share.ts uses. */
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;
/**
 * The canonical URL's PNG is cached a day at the CDN: its bytes change only when its tag does, so crawlers and
 * re-shares never re-render it. A day, not a year, so a profile that is hidden, banned or deleted stops being served
 * from the cache within a day even at its old URL (the /u page itself stops pointing at it at once).
 */
export const OG_PROFILE_CDN_CACHE_VERSIONED = "public, s-maxage=86400, stale-while-revalidate=3600";
/** The redirect from a non-canonical query to the canonical one: the /u page's own 5-minute window. */
export const OG_PROFILE_CDN_CACHE = "public, s-maxage=300, stale-while-revalidate=600";
/** No handle is longer than 30 characters (profiles_handle_format); a longer query is refused before any work. */
const MAX_HANDLE_PARAM = 64;
/** Where every miss goes: the shell's own 1200x630 brand card (index.html og:image), the size share.ts declares. */
export const OG_PROFILE_FALLBACK = "/og-image.png?v=h3";

/** Brand tokens (src/index.css): parchment ground, olivewood text, sage accent. */
const PARCHMENT = "#F4F2EE";
const OLIVEWOOD = "#2E2F22";
const SAGE = "#8C947D";
const MUTED = "#5B5D4E";

async function fetchCard(handle: string): Promise<OgProfileCard | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_profile_by_handle`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_handle: handle }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const card = (await res.json()) as OgProfileCard | null;
  return card && typeof card === "object" ? card : null;
}

/** The photo as a data URI, or null: a missing or slow photo draws the initial instead of failing the card. */
async function fetchDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!res.ok || (type !== "image/jpeg" && type !== "image/png")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length ? `data:${type};base64,${bytes.toString("base64")}` : null;
  } catch {
    // A slow or refused photo is not a failed card: the initial is drawn in its place.
    return null;
  }
}

type Node = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style, children, ...extra },
});

/** The card's element tree (exported for the guard, which reads the words without rendering). */
export function ogProfileTree(card: OgProfileCard, photo: string | null, logo: string | null): Node {
  const l = ogProfileLines(card);
  const portrait = photo
    ? el("img", { width: 360, height: 360, flexShrink: 0, borderRadius: 180, objectFit: "cover", border: `8px solid ${SAGE}` }, undefined, { src: photo, width: 360, height: 360 })
    : el(
        "div",
        { width: 360, height: 360, flexShrink: 0, borderRadius: 180, background: SAGE, color: PARCHMENT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 170 },
        l.name.slice(0, 1).toUpperCase(),
      );
  const lines: Node[] = [el("div", { fontFamily: "Bodoni Moda", fontWeight: 700, fontSize: 72, color: OLIVEWOOD, lineHeight: 1.05, display: "flex" }, l.name)];
  if (l.town) lines.push(el("div", { fontSize: 38, color: MUTED, marginTop: 14, display: "flex" }, l.town));
  if (l.rating) lines.push(el("div", { fontSize: 38, color: OLIVEWOOD, marginTop: 30, display: "flex" }, l.rating));
  if (l.facts) lines.push(el("div", { fontSize: 34, color: MUTED, marginTop: l.rating ? 10 : 30, display: "flex" }, l.facts));
  if (l.skills) lines.push(el("div", { fontSize: 30, color: SAGE, marginTop: 18, display: "flex" }, l.skills));
  const brand = el(
    "div",
    { display: "flex", flexShrink: 0, height: 56, alignItems: "center", fontSize: 32, color: OLIVEWOOD },
    [
      ...(logo ? [el("img", { width: 58, height: 50, marginRight: 16 }, undefined, { src: logo, width: 58, height: 50 })] : []),
      el("div", { display: "flex", fontWeight: 600 }, "Louisiana Helpr"),
      el("div", { display: "flex", color: MUTED, marginLeft: 18, fontSize: 26 }, "Hire help or find work. One account, real neighbors."),
    ],
  );
  return el(
    "div",
    { width: OG_PROFILE_WIDTH, height: OG_PROFILE_HEIGHT, boxSizing: "border-box", display: "flex", flexDirection: "column", background: PARCHMENT, padding: "60px 80px 44px", fontFamily: "Montserrat", fontWeight: 400 },
    [el("div", { display: "flex", flexGrow: 1, flexShrink: 1, minHeight: 0, alignItems: "center" }, [portrait, el("div", { display: "flex", flexDirection: "column", marginLeft: 64, flex: 1, minWidth: 0 }, lines)]), brand],
  );
}

/** The card's fonts, in satori's fallback order: a glyph comes from the first one that has it. */
export const OG_PROFILE_FONTS = [
  { name: "Montserrat", file: "Montserrat-400-latin.woff", weight: 400 },
  { name: "Montserrat", file: "Montserrat-400-latin-ext.woff", weight: 400 },
  { name: "Montserrat", file: "Montserrat-600-latin.woff", weight: 600 },
  { name: "Montserrat", file: "Montserrat-600-latin-ext.woff", weight: 600 },
  { name: "Bodoni Moda", file: "BodoniModa-700-latin.woff", weight: 700 },
  { name: "Bodoni Moda", file: "BodoniModa-700-latin-ext.woff", weight: 700 },
  // Only the rating's star (U+2605), a Google Fonts text= subset: no face above has it, and it drew as a box before.
  { name: "Noto Sans Symbols 2", file: "NotoSansSymbols2-star.woff", weight: 400 },
  { name: "Geist", file: "Geist-Regular.ttf", weight: 400 },
] as const;

/** The fonts and the resvg wasm, read once per instance (vercel.json includeFiles ships api/_og/** with the function). */
let fonts: { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" }[] | null = null;
let wasmReady: Promise<void> | null = null;
function ensureRenderer(): Promise<void> {
  fonts ??= OG_PROFILE_FONTS.map((f) => ({ name: f.name, data: readFileSync(new URL(`./_og/${f.file}`, import.meta.url)), weight: f.weight, style: "normal" as const }));
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
    width: OG_PROFILE_WIDTH,
    height: OG_PROFILE_HEIGHT,
    fonts: fonts ?? [],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_PROFILE_WIDTH } }).render().asPng();
}

function fallback(): Response {
  return new Response(null, { status: 302, headers: { Location: `${SITE_ORIGIN}${OG_PROFILE_FALLBACK}`, "Cache-Control": "no-store" } });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const params = url.searchParams;
      const raw = params.get("h") || "";
      // Length and charset are checked BEFORE any read: only a string that can be a handle reaches the RPC.
      if (raw.length > MAX_HANDLE_PARAM) return fallback();
      const handle = raw.trim().toLowerCase();
      if (!HANDLE_RE.test(handle)) return fallback();
      const card = await fetchCard(handle);
      if (!card) return fallback();
      // Only the canonical URL renders; anything else is sent there (and that redirect is cached 5 minutes).
      const current = typeof card.handle === "string" && HANDLE_RE.test(card.handle) ? card.handle : handle;
      const canonical = ogProfileImageUrl(SITE_ORIGIN, current, card);
      if (url.search !== canonical.slice(canonical.indexOf("?"))) {
        return new Response(null, {
          status: 302,
          headers: { Location: canonical, "Cache-Control": "public, max-age=300", "Vercel-CDN-Cache-Control": OG_PROFILE_CDN_CACHE },
        });
      }
      const [photo, logo] = await Promise.all([fetchDataUri(ogProfilePhotoUrl(card.photo_url, SUPABASE_URL)), fetchDataUri(`${SITE_ORIGIN}/helpr-splash-icon.png`)]);
      // Rendered in full before answering, so a render failure lands in the catch (a fallback), never a broken body.
      const png = await renderPng(ogProfileTree(card, photo, logo));
      return new Response(Buffer.from(png), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
          "Vercel-CDN-Cache-Control": OG_PROFILE_CDN_CACHE_VERSIONED,
          "X-Robots-Tag": "noindex",
        },
      });
    } catch {
      // Silence is the contract: a card that cannot be drawn answers the brand image, never a 500.
      return fallback();
    }
  },
};
