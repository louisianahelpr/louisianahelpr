// WebP metadata stripper (owner 11-05, share-profile H4: job photos on a public page).
//
// A WebP file is RIFF: "RIFF" <u32 size> "WEBP", then chunks of <fourcc> <u32 size> <data> padded to an even length.
// Metadata lives in the "EXIF" and "XMP " chunks, announced by two flag bits of the "VP8X" header chunk (EXIF 0x08,
// XMP 0x04). This drops those two chunks, clears their flags and rewrites the RIFF size. Anything that is not a
// well-formed WebP (bad magic, a chunk running past the end) returns null so the caller refuses it rather than
// serving unknown bytes.

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

export function isWebp(b: Uint8Array): boolean {
  return b.length >= 12 && ascii(b, 0) === "RIFF" && ascii(b, 8) === "WEBP";
}

export function stripWebpMetadata(b: Uint8Array): Uint8Array | null {
  if (!isWebp(b)) return null;
  const end = Math.min(b.length, 8 + u32(b, 4));
  const keep: Uint8Array[] = [];
  let at = 12;
  while (at < end) {
    if (at + 8 > end) return null;
    const tag = ascii(b, at);
    const size = u32(b, at + 4);
    const next = at + 8 + size + (size & 1);
    if (at + 8 + size > end) return null;
    if (tag !== "EXIF" && tag !== "XMP ") {
      const chunk = b.slice(at, Math.min(next, end));
      if (tag === "VP8X" && chunk.length > 8) chunk[8] &= ~(0x08 | 0x04);
      keep.push(chunk);
    }
    at = next;
  }
  const body = keep.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + body);
  out.set(b.slice(0, 12), 0);
  const riff = 4 + body;
  out[4] = riff & 0xff;
  out[5] = (riff >>> 8) & 0xff;
  out[6] = (riff >>> 16) & 0xff;
  out[7] = (riff >>> 24) & 0xff;
  let w = 12;
  for (const c of keep) {
    out.set(c, w);
    w += c.length;
  }
  return out;
}
