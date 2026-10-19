// Strips every metadata segment from a JPEG, server-side (Q2212).
//
// WHY: a listing photo is cleaned of its location tags in the app
// (cleanListingPhoto re-encodes it), but that is not enforcement: a crafted
// upload keeps its GPS EXIF. The listing-photo proxy therefore runs every byte
// it serves through this, the re-encoded render and the capped original alike,
// so what leaves the server carries no EXIF/GPS, XMP, IPTC or comment, whatever
// was uploaded.
//
// What is DROPPED: APP1 (EXIF, which holds the GPS block, and XMP), APP2
// segments that are not an ICC colour profile (MPF: the extra pictures a phone
// appends, each with its own EXIF), APP3-APP13 (APP13 = Photoshop/IPTC, which
// can name a place), APP15, COM, and anything after the end-of-image marker
// (where MPF puts those extra pictures). What is KEPT: APP0 (JFIF), the ICC
// profile (colour only) and APP14 (Adobe colour transform), without which the
// picture's colours would be wrong, plus every table and the image data.
//
// Zero imports, pure: unit-tested in src/test/edge/listing-photo.test.ts.

/** True when the bytes start like a JPEG (SOI followed by a marker). */
export function isJpeg(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

const ICC_ID = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00]; // "ICC_PROFILE\0"

function startsWith(b: Uint8Array, at: number, id: number[]): boolean {
  if (at + id.length > b.length) return false;
  for (let i = 0; i < id.length; i++) if (b[at + i] !== id[i]) return false;
  return true;
}

function dropSegment(marker: number, b: Uint8Array, dataAt: number): boolean {
  if (marker === 0xe1) return true; // APP1: EXIF (GPS) / XMP
  if (marker === 0xe2) return !startsWith(b, dataAt, ICC_ID); // APP2: keep the ICC profile only
  if (marker >= 0xe3 && marker <= 0xed) return true; // APP3-APP13 (APP13 = IPTC)
  if (marker === 0xef) return true; // APP15
  if (marker === 0xfe) return true; // COM
  return false;
}

/**
 * The JPEG without its metadata, or null when the bytes are not a well-formed
 * JPEG (the caller refuses to serve those: never "serve it as is").
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array | null {
  if (!isJpeg(b)) return null;
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let pos = 2;
  const n = b.length;
  while (pos < n) {
    if (b[pos] !== 0xff) return null;
    // Fill bytes (0xFF repeated) before a marker are allowed.
    let m = pos + 1;
    while (m < n && b[m] === 0xff) m++;
    if (m >= n) return null;
    const marker = b[m];
    const segStart = m - 1;
    if (marker === 0xd9) {
      // End of image: everything after it (MPF's appended pictures) is dropped.
      out.push(b.subarray(segStart, m + 1));
      return concat(out);
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // A marker with no length outside entropy data: a second SOI is malformed, the rest are kept.
      if (marker === 0xd8) return null;
      out.push(b.subarray(segStart, m + 1));
      pos = m + 1;
      continue;
    }
    if (m + 2 >= n) return null;
    const len = (b[m + 1] << 8) | b[m + 2];
    if (len < 2 || m + 1 + len > n) return null;
    const segEnd = m + 1 + len;
    if (!dropSegment(marker, b, m + 3)) out.push(b.subarray(segStart, segEnd));
    pos = segEnd;
    if (marker === 0xda) {
      // Start of scan: entropy-coded data follows until the next real marker
      // (0xFF then anything but a stuffed 0x00 or a restart marker).
      let e = pos;
      while (e < n) {
        if (b[e] === 0xff && e + 1 < n) {
          const nx = b[e + 1];
          if (nx === 0x00 || (nx >= 0xd0 && nx <= 0xd7) || nx === 0xff) {
            e += nx === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        e++;
      }
      if (e >= n) return null; // no end-of-image marker
      out.push(b.subarray(pos, e));
      pos = e;
    }
  }
  return null; // ran out of bytes before the end-of-image marker
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const r = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    r.set(p, at);
    at += p.length;
  }
  return r;
}
