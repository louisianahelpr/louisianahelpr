/**
 * Shops digital downloads (owner 11-08): a file is a PDF, ZIP, PNG or JPG decided by its own first bytes, never by
 * its name alone; programs (MZ/ELF/Mach-O) match no signature; a ZIP that carries a program or script is refused by
 * entry name; a malformed or ZIP64 directory is refused, never guessed at. shop-digital calls these on every upload.
 */
// @mutate supabase/functions/_shared/digitalFileCheck.ts |   pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]], |   pdf: [[0x25, 0x50]],
// @mutate supabase/functions/_shared/digitalFileCheck.ts |     if (m && EXECUTABLE_EXT.has(m[1].toLowerCase())) return name; |     if (m && EXECUTABLE_EXT.has(m[1])) return name;
// @mutate supabase/functions/_shared/digitalFileCheck.ts |   if (seen !== expectedEntries) return "unreadable"; |   if (false) return "unreadable";
// @mutate supabase/functions/_shared/digitalFileCheck.ts |   if (e === "jpeg") return "jpg"; |   if (e === "jpeg") return null;
import { describe, expect, it } from "vitest";
import { bytesMatchExt, cleanDownloadName, digitalExtFromName, findZipDirectory, zipProgramEntry } from "../../supabase/functions/_shared/digitalFileCheck";

const b = (...xs: number[]) => new Uint8Array(xs);
const ascii = (s: string) => new TextEncoder().encode(s);

/** A minimal stored ZIP: one local header + data per entry, the central directory, and the EOCD. */
function zip(names: string[]): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const name of names) {
    const off = parts.length;
    const nb = [...ascii(name)];
    parts.push(...u32(0x04034b50), ...u16(20), 0, 0, 0, 0, 0, 0, 0, 0, ...u32(0), ...u32(1), ...u32(1), ...u16(nb.length), ...u16(0), ...nb, 0x41);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), 0, 0, 0, 0, 0, 0, 0, 0, ...u32(0), ...u32(1), ...u32(1),
      ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...nb);
  }
  const cdOffset = parts.length;
  const eocd = [...u32(0x06054b50), 0, 0, 0, 0, ...u16(names.length), ...u16(names.length), ...u32(central.length), ...u32(cdOffset), 0, 0];
  return new Uint8Array([...parts, ...central, ...eocd]);
}
function checkZip(file: Uint8Array): string | null {
  const dir = findZipDirectory(file.subarray(Math.max(0, file.length - 65_557)), file.length);
  if (!dir) return "unreadable";
  return zipProgramEntry(file.subarray(dir.cdOffset, dir.cdOffset + dir.cdSize), dir.entries);
}

describe("digital download file check", () => {
  it("names map to the four types (jpeg is jpg); anything else is refused", () => {
    expect(digitalExtFromName("Bayou Book.PDF")).toBe("pdf");
    expect(digitalExtFromName("pages.zip")).toBe("zip");
    expect(digitalExtFromName("cover.jpeg")).toBe("jpg");
    expect(digitalExtFromName("cover.png")).toBe("png");
    for (const n of ["setup.exe", "book.pdf.exe", "noext", "a.docx", "run.sh"]) expect(digitalExtFromName(n), n).toBeNull();
  });

  it("the bytes must be the extension's signature", () => {
    expect(bytesMatchExt("pdf", ascii("%PDF-1.7\n"))).toBe(true);
    expect(bytesMatchExt("png", b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(bytesMatchExt("jpg", b(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(bytesMatchExt("zip", b(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    // A JPG renamed .pdf, and a too-short head.
    expect(bytesMatchExt("pdf", b(0xff, 0xd8, 0xff, 0xe0))).toBe(false);
    expect(bytesMatchExt("pdf", ascii("%P"))).toBe(false);
    expect(bytesMatchExt("pdf", ascii("%PD-"))).toBe(false);
  });

  it("programs match no signature (Windows MZ, Linux ELF, Mac Mach-O)", () => {
    const programs = [ascii("MZ\x90\x00"), b(0x7f, 0x45, 0x4c, 0x46), b(0xcf, 0xfa, 0xed, 0xfe), b(0xca, 0xfe, 0xba, 0xbe)];
    for (const head of programs) for (const ext of ["pdf", "zip", "png", "jpg"] as const) expect(bytesMatchExt(ext, head)).toBe(false);
  });

  it("a ZIP of pages passes; a ZIP carrying a program or script is refused by name", () => {
    expect(checkZip(zip(["page1.pdf", "art/page2.PNG", "readme.txt"]))).toBeNull();
    expect(checkZip(zip(["page1.pdf", "tools/Setup.EXE"]))).toBe("tools/Setup.EXE");
    expect(checkZip(zip(["install.sh"]))).toBe("install.sh");
    expect(checkZip(zip(["App.app/Contents/x.dylib"]))).toBe("App.app/Contents/x.dylib");
  });

  it("a malformed or truncated directory is refused, never guessed at", () => {
    const z = zip(["a.pdf", "b.pdf"]);
    const dir = findZipDirectory(z, z.length);
    expect(dir?.entries).toBe(2);
    // The directory claims one more entry than it holds.
    expect(zipProgramEntry(z.subarray(dir!.cdOffset, dir!.cdOffset + dir!.cdSize), 3)).toBe("unreadable");
    // A directory cut short.
    expect(zipProgramEntry(z.subarray(dir!.cdOffset, dir!.cdOffset + 20), 2)).toBe("unreadable");
    // No EOCD at all.
    expect(findZipDirectory(ascii("PK\x03\x04 not really a zip"), 20)).toBeNull();
  });

  it("the saved name keeps no path parts or control characters", () => {
    expect(cleanDownloadName("../../etc/pass\\wd.pdf", "pdf")).toBe("....etcpasswd.pdf");
    expect(cleanDownloadName("\u0000\u001f", "zip")).toBe("download.zip");
    expect(cleanDownloadName("x".repeat(300), "pdf").length).toBe(120);
  });
});
