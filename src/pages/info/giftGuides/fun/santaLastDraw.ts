/**
 * The organizer's last Secret Santa draw, kept on this device (holiday audit C2, 11-20: the private links lived only
 * in page memory, so a reload lost them and the only way back was a new draw, which made a second, conflicting set of
 * matches while the first links kept working). Saved right after secret_santa_create answers, read when the drawer
 * opens, dropped once the group has expired. Only the organizer's own browser holds it: the names they typed and the
 * tokens the server handed back to them, nothing else (no email, phone or account). "Start a new group" cancels the
 * draw on the server first (secret_santa_cancel, every token), then clears this.
 * Guard: src/test/secretSantaLastDraw1120.test.tsx.
 */
import { SANTA_CODE, SANTA_TOKEN } from "@/content/giftGuideFun1120";

export const SANTA_LAST_KEY = "lh-santa-last";
/** A group lives at most 90 days on the server (secret_santa_create caps expires_at), never past this here. */
const MAX_DAYS = 90;

export interface SantaLastDraw {
  code: string;
  names: string[];
  tokens: string[];
  /** When it was drawn (ISO). */
  createdAt: string;
  /** When the server deletes the group (ISO): the coming Jan 16 (Louisiana), or the exchange day + 31, at most 90 days. */
  expiresAt: string;
  /** Which people's links were sent or copied (slot numbers). */
  sent: number[];
}

/** The coming Jan 16, midnight Louisiana time (06:00 UTC), after `from`. */
const nextJan16 = (from: Date): Date => {
  const y = from.getUTCFullYear();
  const thisYear = new Date(Date.UTC(y, 0, 16, 6));
  return thisYear > from ? thisYear : new Date(Date.UTC(y + 1, 0, 16, 6));
};

/** When a group drawn at `now` with exchange day `day` (YYYY-MM-DD) expires, the server's rule (20261120062334). */
export function santaExpiry(now: Date, day?: string): Date {
  let at = nextJan16(now);
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const afterDay = new Date(`${day}T06:00:00Z`);
    afterDay.setUTCDate(afterDay.getUTCDate() + 31);
    if (afterDay > at) at = afterDay;
  }
  const cap = new Date(now.getTime() + MAX_DAYS * 86400000);
  return at < cap ? at : cap;
}

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage blocked (private mode, site data off): the draw still works, it just isn't kept.
    return null;
  }
};

/** The kept draw, or null (none, unreadable, junk, or past its expiry: then it is removed). */
export function readSantaLast(now: Date = new Date()): SantaLastDraw | null {
  const s = storage();
  if (!s) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(s.getItem(SANTA_LAST_KEY) ?? "null");
  } catch {
    // A broken value is treated as none and replaced on the next draw.
    return null;
  }
  const d = raw as Partial<SantaLastDraw> | null;
  const ok = !!d && typeof d.code === "string" && SANTA_CODE.test(d.code)
    && Array.isArray(d.names) && Array.isArray(d.tokens) && d.names.length >= 3 && d.names.length === d.tokens.length
    && d.names.every((n) => typeof n === "string" && n.length > 0 && n.length <= 60)
    && d.tokens.every((t) => typeof t === "string" && SANTA_TOKEN.test(t))
    && typeof d.createdAt === "string" && typeof d.expiresAt === "string" && !Number.isNaN(Date.parse(d.expiresAt));
  if (!ok) return null;
  if (Date.parse(d.expiresAt as string) <= now.getTime()) {
    clearSantaLast();
    return null;
  }
  const sent = Array.isArray(d.sent) ? d.sent.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < (d.names as string[]).length) : [];
  return { code: d.code as string, names: d.names as string[], tokens: d.tokens as string[], createdAt: d.createdAt as string, expiresAt: d.expiresAt as string, sent };
}

/** Keep the draw on this device. False when the browser would not store it. */
export function saveSantaLast(draw: SantaLastDraw): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(SANTA_LAST_KEY, JSON.stringify(draw));
    return true;
  } catch (e) {
    // Quota or blocked storage: the organizer still sees the links on screen (and the leave warning).
    console.warn("secret santa: last draw not kept", e);
    return false;
  }
}

export function clearSantaLast(): void {
  try {
    storage()?.removeItem(SANTA_LAST_KEY);
  } catch {
    // Silence is correct: storage is blocked, so nothing was kept and there is nothing to clear.
  }
}
