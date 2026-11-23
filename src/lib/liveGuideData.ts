/**
 * Live gift-guide data, page side (owner 2026-11-23 ~11:15 AM: "make the app's guides pull the latest gifts, prices and
 * deals from the website, so later edits show up without new reviews"). Same code on the web and in the installed app.
 *
 * 1. A page draws its BUNDLED copy at once (liveCopy returns it, or a newer copy this device already saved).
 * 2. After that, off the first paint, the manifest is read once per session from the live site (relative on the web;
 *    https://www.louisianahelpr.com in the app, whose origin is capacitor://localhost or https://localhost). A file is
 *    fetched only when the site was built after this bundle AND its hash differs from the copy in use.
 * 3. The new copy is VALIDATED against the shape the bundled data has (the caller's validator; JSON.parse only, never
 *    eval), relative photo paths are pointed at the live site when this page is not on it, the copy is saved
 *    (localStorage, try/catch) and handed to the page's listener, which swaps it in.
 * Offline or any failure keeps the bundled or saved copy; a failure that is not "offline" is reported (errorLogger).
 * Data only: no code is ever downloaded (App Store guideline 2.5.2). Guard: src/test/liveGuideData1123.test.ts.
 */
import { report } from "@/lib/errorLogger";
import { LIVE_DATA_MANIFEST, LIVE_DATA_ORIGIN, LIVE_DATA_VERSION, liveDataHash } from "@/lib/giftGuideLiveDataShared.mjs";

export type LiveValidator<T> = (value: unknown) => value is T;
interface Manifest { v: number; builtAt: string; files: Record<string, { hash: string; path: string }> }
interface Saved { hash: string; builtAt: string; value: unknown }
interface Entry { bundled: unknown; valid: LiveValidator<unknown>; inUse: { hash: string | null; builtAt: string; value: unknown } }

const CACHE_PREFIX = "lh-live-guide-data:";
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<(value: unknown) => void>>();
let manifestLoad: Promise<Manifest | null> | null = null;
let bundleBuiltAtOverride: string | null = null;
let originOverride: string | null = null;

/** This bundle's build stamp (vite define); "" when unknown (tests, dev), so any built site is newer. */
const bundleBuiltAt = (): string => bundleBuiltAtOverride ?? (typeof __APP_BUILT_AT__ === "string" ? __APP_BUILT_AT__ : "");

/**
 * The origin the data is read from: "" (same site) on the web, the live site in the installed app. A genuine platform
 * difference (the app's own origin serves only the bundled files), never a layout branch.
 */
function liveDataOrigin(): string {
  if (originOverride !== null) return originOverride;
  if (typeof window === "undefined") return LIVE_DATA_ORIGIN;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true ? LIVE_DATA_ORIGIN : "";
}

const readSaved = (name: string): Saved | null => {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + name);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Saved>;
    return typeof s?.hash === "string" && typeof s.builtAt === "string" && "value" in s ? (s as Saved) : null;
  } catch {
    // No storage (private mode, blocked): the bundled copy stands.
    return null;
  }
};
const writeSaved = (name: string, s: Saved) => {
  try {
    window.localStorage.setItem(CACHE_PREFIX + name, JSON.stringify(s));
  } catch {
    // Full or blocked storage: the new copy still shows this session; the next one starts from the bundle again.
  }
};

/**
 * The copy of `name` a page draws now: a saved copy from a site built after this bundle (and still valid), else the
 * bundled one. Registers `name` for the background refresh, which starts off the first paint.
 */
export function liveCopy<T>(name: string, bundled: T, valid: LiveValidator<NoInfer<T>>): T {
  const have = entries.get(name);
  if (have && have.bundled === bundled) {
    scheduleRefresh();
    return have.inUse.value as T;
  }
  const saved = readSaved(name);
  const useSaved = saved !== null && saved.builtAt > bundleBuiltAt() && valid(saved.value);
  const inUse = useSaved ? { hash: saved.hash, builtAt: saved.builtAt, value: saved.value } : { hash: null, builtAt: bundleBuiltAt(), value: bundled };
  entries.set(name, { bundled, valid: valid as LiveValidator<unknown>, inUse });
  scheduleRefresh();
  return inUse.value as T;
}

/** Call `cb` with each newer copy of `name` this session fetches. Returns the unsubscribe. */
export function onLiveUpdate<T>(name: string, cb: (value: T) => void): () => void {
  const set = listeners.get(name) ?? new Set();
  listeners.set(name, set);
  const l = cb as (value: unknown) => void;
  set.add(l);
  return () => {
    set.delete(l);
  };
}

const isManifest = (m: unknown): m is Manifest => {
  if (!m || typeof m !== "object") return false;
  const o = m as Partial<Manifest>;
  if (o.v !== LIVE_DATA_VERSION || typeof o.builtAt !== "string" || !o.files || typeof o.files !== "object") return false;
  return Object.values(o.files).every((f) => !!f && typeof f.hash === "string" && /^\/gift-guides\/data\/[\w.-]+\.json$/.test(String(f.path)));
};

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const fail = (what: string, err: unknown) => {
  if (isOffline()) return;
  report(err instanceof Error ? err : new Error(`live guide data: ${what}: ${String(err)}`), { severity: "warning", tags: { source: "liveGuideData", what } });
};

const getJson = async (url: string, cache: RequestCache): Promise<unknown> => {
  const res = await fetch(url, { cache, credentials: "omit" });
  if (!res.ok) throw new Error(`live guide data: ${url} answered ${res.status}`);
  // JSON.parse only: the body is data, never run.
  return JSON.parse(await res.text()) as unknown;
};

/** Relative photo paths in a copy read from the live site point back at it (the app's own origin lacks new photos). */
const absolutePhotos = (value: unknown, origin: string): unknown => {
  if (!origin) return value;
  if (Array.isArray(value)) return value.map((v) => absolutePhotos(v, origin));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === "image" && typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? origin + v : absolutePhotos(v, origin);
    return out;
  }
  return value;
};

const loadManifest = () =>
  (manifestLoad ??= getJson(`${liveDataOrigin()}${LIVE_DATA_MANIFEST}`, "no-cache").then(
    (m) => {
      if (isManifest(m)) return m;
      fail("manifest", new Error("live guide data: malformed manifest"));
      return null;
    },
    (e: unknown) => {
      fail("manifest", e);
      return null;
    },
  ));

const refreshOne = async (name: string, m: Manifest) => {
  const e = entries.get(name);
  const file = m.files[name];
  if (!e || !file) return;
  // Only a site built after the copy in use (never a downgrade from a lagging deploy), and only when the data changed.
  if (!(m.builtAt > e.inUse.builtAt)) return;
  if (file.hash === (e.inUse.hash ??= liveDataHash(e.bundled))) return;
  let value: unknown;
  try {
    value = await getJson(`${liveDataOrigin()}${file.path}`, "default");
  } catch (err) {
    // Reported through fail() (errorLogger, unless offline); the copy in use stays.
    fail(name, err);
    return;
  }
  const fixed = absolutePhotos(value, liveDataOrigin());
  if (!e.valid(fixed)) {
    fail(name, new Error(`live guide data: ${name} failed validation; kept the copy in use`));
    return;
  }
  e.inUse = { hash: file.hash, builtAt: m.builtAt, value: fixed };
  writeSaved(name, { hash: file.hash, builtAt: m.builtAt, value: fixed });
  listeners.get(name)?.forEach((l) => l(fixed));
};

/** Read the manifest (once per session) and refresh every registered name. Tests await it; pages never need to. */
export async function refreshLiveGuideData(): Promise<void> {
  if (typeof fetch !== "function") return;
  const m = await loadManifest();
  if (!m) return;
  await Promise.all([...entries.keys()].map((n) => refreshOne(n, m)));
}

let scheduled = false;
/** The refresh runs after the page has drawn its bundled copy (a timer, so never on the first paint's path). */
function scheduleRefresh() {
  if (scheduled || import.meta.env.MODE === "test") return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    void refreshLiveGuideData();
  }, 0);
}

/** Tests only: forget every copy, listener and manifest; pin the bundle stamp and the origin. */
export function _resetLiveGuideDataForTests(opts: { builtAt?: string; origin?: string | null } = {}) {
  entries.clear();
  listeners.clear();
  manifestLoad = null;
  bundleBuiltAtOverride = opts.builtAt ?? null;
  originOverride = opts.origin === undefined ? null : opts.origin;
}

// ---- Validators: the shape the bundled data has; anything else is refused. ----
const str = (v: unknown) => typeof v === "string" && v.length > 0;
const optStr = (v: unknown) => v === undefined || typeof v === "string";
const okLink = (v: unknown) => typeof v === "string" && /^https:\/\//.test(v);
const okPhoto = (v: unknown) => v === undefined || (typeof v === "string" && (/^https:\/\//.test(v) || (v.startsWith("/") && !v.startsWith("//"))));
const okPrice = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v) && v > 0);

const isPick = (p: unknown): boolean => {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return str(o.name) && typeof o.brand === "string" && typeof o.line === "string" && okLink(o.href) && okPhoto(o.image) && okPrice(o.price) && optStr(o.priceAt) && optStr(o.section) && optStr(o.sectionId) && optStr(o.code) && optStr(o.store);
};

/** A guide's picks chunk (src/content/giftGuidePicks/<slug>.json): at least one valid pick, optional deal sections. */
export function isLivePickChunk<T>(v: unknown): v is T {
  if (!v || typeof v !== "object") return false;
  const o = v as { picks?: unknown; deals?: unknown };
  if (!Array.isArray(o.picks) || o.picks.length === 0 || !o.picks.every(isPick)) return false;
  if (o.deals === undefined) return true;
  return Array.isArray(o.deals) && o.deals.every((d) => !!d && typeof d === "object" && typeof (d as { title?: unknown }).title === "string" && okLink((d as { href?: unknown }).href));
}

/** The deals days' cards (src/content/giftGuideDeals.json). */
export function isLiveDeals<T>(v: unknown): v is T {
  return (
    Array.isArray(v) &&
    v.every((d) => {
      if (!d || typeof d !== "object") return false;
      const o = d as Record<string, unknown>;
      return str(o.event) && str(o.brand) && str(o.deal) && okLink(o.href) && okPhoto(o.image) && optStr(o.ends) && optStr(o.starts) && optStr(o.status);
    })
  );
}
