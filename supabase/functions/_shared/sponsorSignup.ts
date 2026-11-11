// 25 Days of Louisiana Giveaways: the ONE validator for a sponsor sign-up.
//
// Pure TypeScript with no imports, so the page (src/components/sponsor/
// ClaimForm.tsx, for instant error messages) and the server
// (supabase/functions/sponsor-25days, which is what actually decides) run the
// exact same rules. The server never trusts the page's check: it re-runs this
// on the raw request, and the database function sponsor_create_signup checks
// the days, the cap and the lengths again.

export const SPONSOR_LIMITS = {
  brandName: 120,
  contactName: 100,
  email: 254,
  phone: 40,
  url: 300,
  handle: 100,
  prizeDescription: 1000,
  notes: 2000,
  prizeValueMax: 100_000,
  logoBytes: 5 * 1024 * 1024,
  firstDay: 1,
  lastDay: 25,
} as const;

/**
 * The last day to sign up, Louisiana time (src/content/sponsorPage.ts event.signup_deadline says the same date).
 * Owner 2026-11-11: moved from Nov 30 to Nov 22. Late November is Central Standard Time (UTC-6), so sign-ups
 * close at 06:00 UTC on the next day (2026-11-23T06:00:00Z).
 */
export const SPONSOR_SIGNUP_DEADLINE = "2026-11-22";

/** Are sign-ups still open at `nowMs`? Open through the whole deadline day in Louisiana. */
export function sponsorSignupsOpen(nowMs: number, deadline: string = SPONSOR_SIGNUP_DEADLINE): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline);
  if (!m) return false;
  // Midnight starting the next day in Louisiana: 06:00 UTC (CST) in late November / December.
  const closesAt = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 6, 0, 0);
  return nowMs < closesAt;
}

const SPONSOR_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"] as const;
export type SponsorLogoType = (typeof SPONSOR_LOGO_TYPES)[number];

export type SponsorShipTo = "winner" | "helpr";

interface SponsorSignupInput {
  brandName: string;
  contactName: string;
  email: string;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  prizeDescription: string;
  /** Whole dollars, or null: the form no longer asks it (owner 11-10). A value that IS sent must still be 1..100000. */
  prizeValue: number | null;
  shipTo: SponsorShipTo | null;
  notes: string | null;
  days: number[];
  anyDay: boolean;
  agree: true;
  showOnWall: boolean;
  /** The invite link the visitor came from, if any (?ref=). */
  ref: string | null;
}

export type SponsorFieldError =
  | "required"
  | "email"
  | "days"
  | "prizeValue"
  | "agree"
  | "url"
  | "tooLong";

export type SponsorValidation =
  | { ok: true; value: SponsorSignupInput }
  | { ok: false; errors: Partial<Record<keyof SponsorSignupInput, SponsorFieldError>> };

// Same shape contact-support uses: rejects garbage and anything with
// whitespace (header-injection shapes); real deliverability is Resend's job.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Single line: every control character becomes a space, runs collapse. */
function cleanLine(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max + 1);
}

/** Multi-line: keeps tab and newline, drops other control characters. */
function cleanText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "").trim().slice(0, max + 1);
}

/** A ref code as the admin generates it: lowercase letters, digits and dashes. */
export function normalizeRef(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(v) ? v : null;
}

/** "Cajun Candle Co." -> "cajun-candle-co". */
export function slugifyBrand(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function optionalUrl(input: unknown): { value: string | null; error?: SponsorFieldError } {
  const v = cleanLine(input, SPONSOR_LIMITS.url);
  if (!v) return { value: null };
  if (v.length > SPONSOR_LIMITS.url) return { value: null, error: "tooLong" };
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".")) return { value: null, error: "url" };
    return { value: u.toString() };
  } catch {
    // An unparseable address is the visitor's typo, reported on the field.
    return { value: null, error: "url" };
  }
}

function optionalLine(input: unknown, max: number): { value: string | null; error?: SponsorFieldError } {
  const v = cleanLine(input, max);
  if (!v) return { value: null };
  if (v.length > max) return { value: null, error: "tooLong" };
  return { value: v };
}

/** Days 1-25, each once, sorted. Anything else in the list fails the whole list. */
export function cleanDays(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null;
  const out = new Set<number>();
  for (const d of input) {
    const n = typeof d === "string" && /^\d+$/.test(d) ? Number(d) : d;
    if (typeof n !== "number" || !Number.isInteger(n) || n < SPONSOR_LIMITS.firstDay || n > SPONSOR_LIMITS.lastDay) return null;
    out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function validateSponsorSignup(raw: Record<string, unknown>): SponsorValidation {
  const errors: Partial<Record<keyof SponsorSignupInput, SponsorFieldError>> = {};
  const req = (key: keyof SponsorSignupInput, input: unknown, max: number, multi = false): string => {
    const v = multi ? cleanText(input, max) : cleanLine(input, max);
    if (!v) errors[key] = "required";
    else if (v.length > max) errors[key] = "tooLong";
    return v;
  };

  const brandName = req("brandName", raw.brandName, SPONSOR_LIMITS.brandName);
  const contactName = req("contactName", raw.contactName, SPONSOR_LIMITS.contactName);
  const email = req("email", raw.email, SPONSOR_LIMITS.email).toLowerCase();
  if (email && !errors.email && !EMAIL_RE.test(email)) errors.email = "email";
  const prizeDescription = req("prizeDescription", raw.prizeDescription, SPONSOR_LIMITS.prizeDescription, true);

  // Optional (owner 11-10: "I don't like asking the approximate value of the gift"): absent or blank is null.
  let prizeValue: number | null = null;
  const pv = typeof raw.prizeValue === "number" ? String(raw.prizeValue) : cleanLine(raw.prizeValue, 20);
  const pvClean = pv.replace(/[$,\s]/g, "");
  if (!pvClean) {
    // Not given: stays null (sponsor_signups.prize_value is nullable since 20261110171648).
  } else if (!/^\d+(\.\d{1,2})?$/.test(pvClean)) errors.prizeValue = "prizeValue";
  else {
    prizeValue = Math.round(Number(pvClean));
    if (prizeValue < 1 || prizeValue > SPONSOR_LIMITS.prizeValueMax) errors.prizeValue = "prizeValue";
  }

  const anyDay = raw.anyDay === true;
  const days = cleanDays(raw.days ?? []);
  if (days === null) errors.days = "days";
  else if (!anyDay && days.length === 0) errors.days = "days";

  if (raw.agree !== true) errors.agree = "agree";

  const phone = optionalLine(raw.phone, SPONSOR_LIMITS.phone);
  if (phone.error) errors.phone = phone.error;
  const website = optionalUrl(raw.website);
  if (website.error) errors.website = website.error;
  const instagram = optionalLine(raw.instagram, SPONSOR_LIMITS.handle);
  if (instagram.error) errors.instagram = instagram.error;
  const facebook = optionalLine(raw.facebook, SPONSOR_LIMITS.handle);
  if (facebook.error) errors.facebook = facebook.error;
  const tiktok = optionalLine(raw.tiktok, SPONSOR_LIMITS.handle);
  if (tiktok.error) errors.tiktok = tiktok.error;
  const notesRaw = cleanText(raw.notes, SPONSOR_LIMITS.notes);
  if (notesRaw.length > SPONSOR_LIMITS.notes) errors.notes = "tooLong";

  const shipTo: SponsorShipTo | null = raw.shipTo === "winner" || raw.shipTo === "helpr" ? raw.shipTo : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      brandName,
      contactName,
      email,
      phone: phone.value,
      website: website.value,
      instagram: instagram.value,
      facebook: facebook.value,
      tiktok: tiktok.value,
      prizeDescription,
      prizeValue,
      shipTo,
      notes: notesRaw || null,
      // "Any day is fine" with days picked keeps the picks; with none it is any day.
      days: days ?? [],
      anyDay: anyDay && (days ?? []).length === 0,
      agree: true,
      showOnWall: raw.showOnWall === true,
      ref: normalizeRef(raw.ref),
    },
  };
}

/** Logo check by declared type and size; the server also sniffs the bytes (sniffLogoType). */
export function checkLogo(type: string, bytes: number): "logoType" | "logoSize" | null {
  if (!(SPONSOR_LOGO_TYPES as readonly string[]).includes(type)) return "logoType";
  if (bytes <= 0 || bytes > SPONSOR_LIMITS.logoBytes) return "logoSize";
  return null;
}

/** What the file's first bytes say it is (PNG, JPEG or SVG), or null. */
export function sniffLogoType(head: Uint8Array): SponsorLogoType | null {
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head.slice(0, 1024)).replace(/^﻿/, "").trimStart();
  // A linear scan, not one regex (CodeQL js/redos: a nested "(<!--[\s\S]*?-->\s*)*" backtracks on "<!--" + many
  // "--><!--"): an optional <?xml ...>, any number of comments, an optional <!DOCTYPE svg ...>, then <svg.
  let t = text;
  if (/^<\?xml/i.test(t)) {
    const end = t.indexOf(">");
    if (end < 0) return null;
    t = t.slice(end + 1).trimStart();
  }
  while (t.startsWith("<!--")) {
    const end = t.indexOf("-->", 4);
    if (end < 0) return null;
    t = t.slice(end + 3).trimStart();
  }
  if (/^<!DOCTYPE svg/i.test(t)) {
    const end = t.indexOf(">");
    if (end < 0) return null;
    t = t.slice(end + 1).trimStart();
  }
  return /^<svg[\s>]/i.test(t) ? "image/svg+xml" : null;
}
