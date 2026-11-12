// digitalFileCheck — what a Shops digital download may be (owner 11-08: PDF, ZIP, PNG or JPG, at most 100 MB, never
// a program), decided from the file's own bytes. The extension and the browser's declared type are never trusted
// alone: shop-digital reads the uploaded object's first bytes (and, for a ZIP, its central directory) and refuses a
// file whose bytes do not match its extension. A Windows/Mac/Linux program (MZ, ELF, Mach-O) never matches any of the
// four signatures, and a ZIP whose entries include a program or script is refused by name.
// Pure functions only (no Deno, no network) so vitest can prove them: src/test/digitalFileCheck.test.ts.

export type DigitalExt = "pdf" | "zip" | "png" | "jpg";

export const DIGITAL_MAX_BYTES = 100 * 1024 * 1024;
export const DIGITAL_MAX_FILES = 5;

/** The extension a seller's file name maps to, or null when it is not one of the four. */
export function digitalExtFromName(name: string): DigitalExt | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name.trim());
  if (!m) return null;
  const e = m[1].toLowerCase();
  if (e === "pdf" || e === "zip" || e === "png" || e === "jpg") return e;
  if (e === "jpeg") return "jpg";
  return null;
}

/** The download's saved name: no path parts, no control characters, at most 120 characters, ending in its ext. */
export function cleanDownloadName(name: string, ext: DigitalExt): string {
  // eslint-disable-next-line no-control-regex
  const base = name.replace(/[/\\\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  if (!base) return `download.${ext}`;
  return base;
}

const SIGNATURES: Record<DigitalExt, ReadonlyArray<ReadonlyArray<number>>> = {
  // "%PDF-"
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  // "PK\x03\x04" (a local file header) or "PK\x05\x06" (an empty archive)
  zip: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]],
  // "\x89PNG\r\n\x1a\n"
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // JPEG SOI + the next marker's 0xFF
  jpg: [[0xff, 0xd8, 0xff]],
};

/** The first bytes needed to decide (the longest signature). */
export const SNIFF_BYTES = 16;

/** True when the file's first bytes are the signature of its extension. */
export function bytesMatchExt(ext: DigitalExt, head: Uint8Array): boolean {
  return SIGNATURES[ext].some((sig) => head.length >= sig.length && sig.every((b, i) => head[i] === b));
}

export type PhotoKind = "png" | "jpg" | "webp";

/**
 * Q1956: what a shop photo really is, from its first bytes (shop-photo-check reads them; the uploaded mimetype is only what
 * the browser said). PNG and JPEG use the download signatures above; WebP is "RIFF" + 4 size bytes + "WEBP".
 */
export function imageKindFromBytes(head: Uint8Array): PhotoKind | null {
  if (bytesMatchExt("png", head)) return "png";
  if (bytesMatchExt("jpg", head)) return "jpg";
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  if (head.length >= 12 && riff.every((b, i) => head[i] === b) && webp.every((b, i) => head[8 + i] === b)) return "webp";
  return null;
}

// Entry names a ZIP may not carry: programs, installers, scripts and disk images on Windows, Mac, Linux and Android.
const EXECUTABLE_EXT = new Set([
  "exe", "com", "scr", "msi", "msp", "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "cpl",
  "dll", "sys", "lnk", "reg", "jar", "app", "dmg", "pkg", "command", "sh", "bash", "zsh", "csh", "run", "bin",
  "elf", "so", "dylib", "apk", "ipa", "deb", "rpm", "appimage", "iso", "img", "vhd", "py", "pl", "rb", "php",
]);

/** The End Of Central Directory record, read from the archive's last bytes. */
export interface ZipDirectory {
  entries: number;
  cdSize: number;
  cdOffset: number;
}

/**
 * Finds the EOCD record (signature PK\x05\x06) in the archive's tail. `tail` is the last bytes of the file and
 * `fileSize` the whole size. Returns null when there is none, or when the archive is ZIP64 (0xFFFF/0xFFFFFFFF
 * markers) or its directory points outside the file: such a file is refused, never guessed at.
 */
export function findZipDirectory(tail: Uint8Array, fileSize: number): ZipDirectory | null {
  const tailStart = fileSize - tail.length;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      const dv = new DataView(tail.buffer, tail.byteOffset + i, 22);
      const entries = dv.getUint16(10, true);
      const cdSize = dv.getUint32(12, true);
      const cdOffset = dv.getUint32(16, true);
      if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null;
      if (cdOffset + cdSize > tailStart + i) return null;
      return { entries, cdSize, cdOffset };
    }
  }
  return null;
}

/** The ZIP central directory's largest size shop-digital reads (enough for tens of thousands of names). */
export const ZIP_DIRECTORY_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Reads the central directory's entry names. Returns the first entry that is a program or script (by its extension,
 * or a nested archive name hiding one), "unreadable" when the directory is malformed, or null when all entries are
 * fine.
 */
export function zipProgramEntry(cd: Uint8Array, expectedEntries: number): string | null {
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  let p = 0;
  let seen = 0;
  const dec = new TextDecoder("utf-8", { fatal: false });
  while (p + 46 <= cd.length) {
    if (dv.getUint32(p, true) !== 0x02014b50) return "unreadable";
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    if (p + 46 + nameLen > cd.length) return "unreadable";
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
    const leaf = name.split(/[/\\]/).pop() ?? "";
    const m = /\.([A-Za-z0-9]{1,10})$/.exec(leaf);
    if (m && EXECUTABLE_EXT.has(m[1].toLowerCase())) return name;
    seen++;
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (seen !== expectedEntries) return "unreadable";
  return null;
}
