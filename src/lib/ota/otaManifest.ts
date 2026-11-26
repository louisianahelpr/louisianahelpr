// Self-hosted over-the-air (OTA) web-bundle updates: the pure, testable half.
//
// The native side is @capgo/capacitor-updater in MANUAL mode (autoUpdate off,
// no Capgo cloud, stats off; see capacitor.config.ts). This file decides
// WHETHER a published bundle may be installed. src/lib/ota/otaUpdater.ts does
// the fetching and calls the plugin. docs/OTA_UPDATES.md covers the release side.
//
// Trust chain, every link mandatory:
//   1. The manifest is fetched over HTTPS from OTA_MANIFEST_URL (our domain only).
//   2. It lists every file of the bundle (name, sha256, url). Every url must be
//      HTTPS on OTA_ORIGIN: no code from anywhere else.
//   3. The SHA-256 of that list (filesSha256) and the bundle fields are signed
//      with ECDSA P-256 / SHA-256 by the release key. The private half is never
//      in the repo; the public half is baked in below. A missing or invalid
//      signature, or a list that does not hash to filesSha256, means nothing is
//      installed: fail closed.
//   4. The plugin's native code hashes every file it fetches against that
//      file's sha256 and refuses a mismatch. Files whose hash matches the
//      store build's own copy are reused, never downloaded, so an update only
//      fetches what changed.
//   5. minNativeBuild keeps a bundle that needs newer native code off an older
//      binary.
//   6. The bundle number must be higher than the running bundle's, so a store
//      build never downgrades to an older OTA bundle.

import { otaCanonicalFiles, otaCanonicalPayload } from "./otaCanonical.mjs";

const OTA_PLATFORM = "ios" as const;
const OTA_ORIGIN = "https://www.louisianahelpr.com";
const OTA_PATH_PREFIX = "/ota/ios/";
export const OTA_MANIFEST_URL = `${OTA_ORIGIN}${OTA_PATH_PREFIX}manifest.json`;

/** SPKI (DER, base64) of the OTA release signing key: ECDSA P-256.
 *  Private half: ~/.lh-ota/ota-signing-key.pem on the release Mac, plus the
 *  OTA_SIGNING_KEY GitHub secret. See docs/OTA_UPDATES.md ("Key"). Changing this
 *  value only takes effect with a new store build. */
export const OTA_PUBLIC_KEY_SPKI_B64 =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhW7Vn6rc4X27jaB/fQeCrQJghl1fQ9Md81jdHh2xJrFMUharrfc0+5Gd0BFKMej1+ibjS8wHufuEuMePxx9wFw==";

interface OtaFile {
  /** Path inside the bundle, e.g. "assets/index-abc.js". */
  name: string;
  /** Lower-case hex SHA-256 of the file. */
  sha256: string;
  /** HTTPS URL on OTA_ORIGIN the file downloads from. */
  url: string;
}

export interface OtaManifest {
  platform: typeof OTA_PLATFORM;
  /** Monotonic bundle number: the UTC build time as yyyymmddHHMMSS. */
  bundle: number;
  /** Plugin version label, e.g. "ota-20261125215000". */
  version: string;
  /** Lowest native CFBundleVersion (App.getInfo().build) this bundle runs on. */
  minNativeBuild: number;
  /** Hex SHA-256 of otaCanonicalFiles(files). */
  filesSha256: string;
  files: OtaFile[];
  /** Base64 ECDSA P-256 signature (IEEE P1363 r||s) over otaCanonicalPayload. */
  sig: string;
}

const isPosInt = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0;

const HEX64 = /^[0-9a-f]{64}$/;

/** A bundle-relative path: no leading slash, no "..", no backslash, no NUL. */
function isSafeBundlePath(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 512 &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    !name.split("/").some((seg) => seg === "" || seg === "." || seg === "..")
  );
}

/** Only HTTPS on our own origin, with no credentials and no "..". */
export function isAllowedFileUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false; // not a URL at all: rejected, nothing to log
  }
  return (
    u.protocol === "https:" &&
    u.origin === OTA_ORIGIN &&
    u.username === "" &&
    u.password === "" &&
    !url.includes("..")
  );
}

/** Validates the shape of untrusted JSON. Returns null when anything is off. */
export function parseOtaManifest(raw: unknown): OtaManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.platform !== OTA_PLATFORM) return null;
  if (!isPosInt(m.bundle) || !isPosInt(m.minNativeBuild)) return null;
  if (typeof m.version !== "string" || !/^[0-9A-Za-z.-]{1,64}$/.test(m.version)) return null;
  if (typeof m.filesSha256 !== "string" || !HEX64.test(m.filesSha256)) return null;
  if (typeof m.sig !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.sig)) return null;
  if (!Array.isArray(m.files) || m.files.length === 0 || m.files.length > 20000) return null;
  const files: OtaFile[] = [];
  const seen = new Set<string>();
  for (const f of m.files as unknown[]) {
    if (!f || typeof f !== "object") return null;
    const { name, sha256, url } = f as Record<string, unknown>;
    if (typeof name !== "string" || !isSafeBundlePath(name) || seen.has(name)) return null;
    if (typeof sha256 !== "string" || !HEX64.test(sha256)) return null;
    if (typeof url !== "string" || !isAllowedFileUrl(url)) return null;
    seen.add(name);
    files.push({ name, sha256, url });
  }
  if (!seen.has("index.html")) return null;
  return {
    platform: OTA_PLATFORM,
    bundle: m.bundle,
    version: m.version,
    minNativeBuild: m.minNativeBuild,
    filesSha256: m.filesSha256,
    files,
    sig: m.sig,
  };
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");

/** Verifies the file list against filesSha256 and the signature over the
 *  bundle fields. Fails closed: any error, a missing WebCrypto, or a bad key
 *  all return false. */
export async function verifyOtaManifest(
  m: OtaManifest,
  subtle: SubtleCrypto | undefined,
  publicKeySpkiB64: string = OTA_PUBLIC_KEY_SPKI_B64,
): Promise<boolean> {
  if (!subtle) return false;
  try {
    const enc = new TextEncoder();
    const listHash = toHex(await subtle.digest("SHA-256", enc.encode(otaCanonicalFiles(m.files))));
    if (listHash !== m.filesSha256) return false;
    const key = await subtle.importKey(
      "spki",
      b64ToBytes(publicKeySpkiB64),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64ToBytes(m.sig),
      enc.encode(otaCanonicalPayload(m)),
    );
  } catch (err) {
    console.warn("[ota] signature check failed", err);
    return false;
  }
}

/** The plugin's download() manifest entries. */
export function toPluginManifest(m: OtaManifest): { file_name: string; file_hash: string; download_url: string }[] {
  return m.files.map((f) => ({ file_name: f.name, file_hash: f.sha256, download_url: f.url }));
}

export type OtaDecision =
  | { install: true }
  | { install: false; reason: "not-newer" | "native-too-old" | "bad-native-build" | "already-failed" };

/** Should this (already verified) manifest be installed on this device? */
export function decideOtaUpdate(
  m: OtaManifest,
  ctx: { runningBundle: number; nativeBuild: string | number; failedVersions?: readonly string[] },
): OtaDecision {
  const native = typeof ctx.nativeBuild === "number" ? ctx.nativeBuild : Number.parseInt(ctx.nativeBuild, 10);
  if (!Number.isSafeInteger(native) || native <= 0) return { install: false, reason: "bad-native-build" };
  if (native < m.minNativeBuild) return { install: false, reason: "native-too-old" };
  if (!(m.bundle > ctx.runningBundle)) return { install: false, reason: "not-newer" };
  if (ctx.failedVersions?.includes(m.version)) return { install: false, reason: "already-failed" };
  return { install: true };
}

/** The running bundle's number, baked in by vite.config.ts (__OTA_BUNDLE__).
 *  A non-numeric value reads as +Infinity: a build with no stamp never
 *  replaces itself (fail closed). */
export function parseRunningBundle(stamp: string): number {
  const n = Number(stamp);
  return Number.isSafeInteger(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}
