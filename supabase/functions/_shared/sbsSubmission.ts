// Small Business Saturday "Featured local": the ONE validator for a free listing request (owner 2026-11-20).
//
// Pure TypeScript with no imports, so the page (src/pages/info/giftGuides/SmallBizSubmitForm.tsx, for instant error
// messages) and the server (supabase/functions/sbs-featured, which is what decides) run the same rules. The server
// re-runs this on the raw request, then checks that the link loads, and sbs_service_create checks the town against
// louisiana_zip_parishes, the duplicate and the per-email cap again.
// Guard: src/test/sbsFeaturedLocal1120.test.tsx.

export const SBS_LIMITS = {
  name: 80,
  town: 60,
  deal: 200,
  email: 254,
  url: 300,
  logoBytes: 2 * 1024 * 1024,
} as const;

/** The page's category sections (kept equal to SMALL_BIZ_CATEGORIES in src/content/giftGuideSmallBiz.mjs; the test checks). */
export const SBS_CATEGORIES = [
  "Food & Sweets",
  "Home & Decor",
  "Art & Gifts",
  "Fashion & Accessories",
  "Beauty & Wellness",
  "Kids",
  "Experiences & Tours",
  "Services",
] as const;
type SbsCategory = (typeof SBS_CATEGORIES)[number];

const SBS_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type SbsLogoType = (typeof SBS_LOGO_TYPES)[number];

interface SbsSubmission {
  businessName: string;
  town: string;
  category: SbsCategory;
  link: string;
  deal: string | null;
  contactEmail: string;
  participating: true;
}

export type SbsFieldError = "required" | "tooLong" | "email" | "url" | "category" | "participating" | "profanity" | "spam" | "lodging" | "town";

export type SbsValidation =
  | { ok: true; value: SbsSubmission }
  | { ok: false; errors: Partial<Record<keyof SbsSubmission, SbsFieldError>> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Single line: control characters become spaces, runs collapse. */
function cleanLine(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max + 1);
}

/*
 * Words that keep a listing off a family gift guide. Whole words only (so "Scunthorpe"-style names pass), matched
 * after folding look-alike digits. Short on purpose: an admin reviews every listing anyway; this stops the obvious.
 */
const PROFANITY = [
  "fuck", "fucking", "fucker", "motherfucker", "shit", "shitty", "bullshit", "bitch", "bitches", "cunt", "dick", "dickhead",
  "cock", "pussy", "asshole", "bastard", "slut", "whore", "nigger", "nigga", "faggot", "fag", "retard", "porn", "porno",
  "xxx", "viagra", "cialis", "casino", "escort", "escorts", "onlyfans",
];
const PROFANITY_RE = new RegExp(`\\b(?:${PROFANITY.join("|")})\\b`, "i");
const fold = (s: string) => s.toLowerCase().replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/\$/g, "s").replace(/@/g, "a");

export function hasProfanity(text: string): boolean {
  return PROFANITY_RE.test(text) || PROFANITY_RE.test(fold(text));
}

/** A web address inside a text field (the link has its own field): link spam. */
const URL_IN_TEXT_RE = /(?:https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(?:com|net|org|biz|info|ru|cn|xyz|top|io|co|us|site|online|shop|store|click|link|me|ly)\b)/i;
export function hasUrlSpam(text: string): boolean {
  return URL_IN_TEXT_RE.test(text);
}

/** Motels and inns are not listed (owner rule 11-20). Checked on the name and the note. */
const LODGING_RE = /\b(?:motels?|inns?|motor lodge|motor inn)\b/i;
export function isLodging(text: string): boolean {
  return LODGING_RE.test(text);
}

/** Link shorteners hide where a link goes: not accepted. */
const SHORTENER_HOSTS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "tiny.cc", "rb.gy"]);

/**
 * The link as a clean https URL, or null. "facebook.com/x" gains https://; http:// becomes https://. Never an
 * address (IP), a local name, a login, or a shortener.
 */
export function cleanLink(input: unknown): string | null {
  let s = cleanLine(input, SBS_LIMITS.url).replace(/\s/g, "");
  if (!s) return null;
  if (/^http:\/\//i.test(s)) s = `https://${s.slice(7)}`;
  if (!/^https:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/:]+:\d/.test(s)) return null; // another scheme (javascript:, mailto:)
    s = `https://${s.replace(/^\/+/, "")}`;
  }
  if (s.length > SBS_LIMITS.url) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    // Not a URL at all: the caller reports "url".
    return null;
  }
  // A trailing dot ("localhost.", "metadata.google.internal.") is the same host: strip it before every check.
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.includes("[") || host === "localhost" || host.endsWith(".localhost")) return null;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return null;
  // Wildcard-DNS names that point at any address written into them ("127.0.0.1.nip.io"): never a real shop.
  if (/(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me)$/.test(host) || /\d{1,3}[.-]\d{1,3}[.-]\d{1,3}[.-]\d{1,3}/.test(host)) return null;
  if (SHORTENER_HOSTS.has(host.replace(/^www\./, ""))) return null;
  u.hostname = host;
  return u.toString();
}

/**
 * Whether an address the link's name resolved to is private, loopback, link-local or shared (the server must never
 * fetch one): 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, ::1, ::, fc00::/7, fe80::/10, and
 * IPv4-mapped forms of those.
 */
export function isPrivateAddress(ip: string): boolean {
  const a = ip.trim().toLowerCase();
  const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  const v4 = mapped ? mapped[1] : /^\d{1,3}(?:\.\d{1,3}){3}$/.test(a) ? a : null;
  if (v4) {
    const [o1, o2] = v4.split(".").map(Number);
    return o1 === 127 || o1 === 10 || o1 === 0 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 169 && o2 === 254) || (o1 === 100 && o2 >= 64 && o2 <= 127);
  }
  if (a === "::1" || a === "::") return true;
  return /^f[cd][0-9a-f]{0,2}:/.test(a) || /^fe[89ab][0-9a-f]?:/.test(a);
}

/** The town key the server uses (sbs_town_key): "Saint Martinville", "St Martinville, LA" -> "st martinville". */
export function townKey(town: string): string {
  return town
    .trim()
    .toLowerCase()
    .replace(/(,\s*|\s+)(la|louisiana)$/, "")
    .replace(/^(saint|st\.?)\s+/, "st ")
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();
}

/** The business name key for "already a 25 Days sponsor" (one listing, in the sponsor spot). */
export function businessKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/\b(the|llc|inc|co|company)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function validateSbsSubmission(raw: Record<string, unknown>): SbsValidation {
  const errors: Partial<Record<keyof SbsSubmission, SbsFieldError>> = {};
  const name = cleanLine(raw.businessName, SBS_LIMITS.name);
  const town = cleanLine(raw.town, SBS_LIMITS.town);
  const deal = cleanLine(raw.deal, SBS_LIMITS.deal);
  const email = cleanLine(raw.contactEmail, SBS_LIMITS.email).toLowerCase();
  const category = typeof raw.category === "string" ? raw.category : "";

  if (name.length < 2) errors.businessName = "required";
  else if (name.length > SBS_LIMITS.name) errors.businessName = "tooLong";
  else if (hasProfanity(name)) errors.businessName = "profanity";
  else if (hasUrlSpam(name)) errors.businessName = "spam";
  else if (isLodging(name)) errors.businessName = "lodging";

  if (town.length < 2) errors.town = "required";
  else if (town.length > SBS_LIMITS.town) errors.town = "tooLong";
  else if (hasProfanity(town) || hasUrlSpam(town)) errors.town = "town";

  if (!(SBS_CATEGORIES as readonly string[]).includes(category)) errors.category = "category";

  const link = cleanLink(raw.link);
  if (!cleanLine(raw.link, SBS_LIMITS.url)) errors.link = "required";
  else if (!link) errors.link = "url";

  if (deal.length > SBS_LIMITS.deal) errors.deal = "tooLong";
  else if (deal && hasProfanity(deal)) errors.deal = "profanity";
  else if (deal && hasUrlSpam(deal)) errors.deal = "spam";
  else if (deal && isLodging(deal)) errors.deal = "lodging";

  if (!email) errors.contactEmail = "required";
  else if (email.length > SBS_LIMITS.email || !EMAIL_RE.test(email)) errors.contactEmail = "email";

  if (raw.participating !== true) errors.participating = "participating";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { businessName: name, town, category: category as SbsCategory, link: link!, deal: deal || null, contactEmail: email, participating: true },
  };
}

/** Logo check by declared type and size; the server also sniffs the bytes (sniffSbsLogo). */
export function checkSbsLogo(type: string, bytes: number): "logoType" | "logoSize" | null {
  if (!(SBS_LOGO_TYPES as readonly string[]).includes(type)) return "logoType";
  if (bytes <= 0 || bytes > SBS_LIMITS.logoBytes) return "logoSize";
  return null;
}

/** What the file's first bytes say it is (PNG, JPEG or WebP), or null. Never SVG. */
export function sniffSbsLogo(head: Uint8Array): SbsLogoType | null {
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "image/webp";
  return null;
}

/**
 * Whether a link's answer means "this page exists". Only a 404 or 410 says it does not: many real shops sit behind
 * bot walls that answer a server with 403/429/503, and Facebook/Instagram answer with login walls. Every listing is
 * reviewed by an admin anyway, so a doubtful answer is let through (security review 2026-11-20 #2). A network, DNS
 * or TLS failure is decided by the caller (no status at all).
 */
export function linkStatusOk(status: number): boolean {
  return status !== 404 && status !== 410;
}
