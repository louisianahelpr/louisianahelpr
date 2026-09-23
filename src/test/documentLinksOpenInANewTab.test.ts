// @mutate src/components/admin/AdminCredentialQueue.tsx |       const safe = openableDocumentUrl(path);\n      if (safe) window.open(safe, "_blank", "noopener"); |       const safe = safeDocumentUrl(path);\n      if (safe) window.open(safe, "_blank", "noopener");
// @mutate src/components/profile/CredentialsTab.tsx | const safe = openableDocumentUrl(path); | const safe = safeDocumentUrl(path);
// @mutate src/components/activity/JobCardPhotoStrip.tsx | href={openableDocumentUrl(url) ?? undefined} | href={safeDocumentUrl(url) ?? undefined}
// @mutate src/lib/storagePath.ts |   if (!safe \|\| !safe.startsWith("data:")) return safe; |   if (!safe \|\| safe) return safe;
/*
 * CLASS GUARD (docs/OPEN.md Q295): a stored document the app offers to OPEN in
 * a new tab actually opens.
 *
 * Browsers refuse a top-level navigation to a `data:` URL. Measured in
 * Chromium 2026-09-23 (Playwright, this repo's browser): `window.open(<data:
 * image/png>, "_blank", "noopener")` and a `target="_blank"` link to one open
 * NO page and log nothing; the same bytes as a `blob:` URL open and render.
 * safeDocumentUrl() allows `data:image/…` on purpose (seed fixtures, legacy
 * rows), so every "Open" fed by it was dead for such a value: press run
 * 35837735324 scored /admin?view=credentials "Open" as "no observable change",
 * when the seeded licence's document was still a data: PNG (Q130 moved the
 * seed to a storage object later that day). openableDocumentUrl() re-serves a
 * data: image as a blob: of the same bytes; every open sink uses it.
 *
 * Inventory: every source file that opens a document (href on a link, or
 * window.open) with a value from safeDocumentUrl / openableDocumentUrl.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { openableDocumentUrl } from "@/lib/storagePath";

const SRC = resolve(__dirname, "..");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "test") walk(p, out); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Q295: an opened document never goes to a data: URL", () => {
  it("re-serves a data: image as a blob: of the same bytes, passes https through, refuses the rest", async () => {
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => { blobs.push(b); return `blob:http://localhost/${blobs.length}`; });
    Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true, writable: true });
    const opened = openableDocumentUrl(PNG);
    expect(opened).toMatch(/^blob:/);
    expect(blobs[0].type).toBe("image/png");
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // \x89PNG
    // A re-render keeps the same URL (one blob per document, not one per render).
    expect(openableDocumentUrl(PNG)).toBe(opened);
    expect(create).toHaveBeenCalledTimes(1);
    expect(openableDocumentUrl("https://example.com/doc.pdf")).toBe("https://example.com/doc.pdf");
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "data:image/svg+xml;base64,PHN2Zz4=", "http://x/doc.png", "blob:http://x/1", null, undefined, ""]) {
      expect(openableDocumentUrl(bad), String(bad)).toBeNull();
    }
  });

  it("every link or window.open that opens a stored document goes through openableDocumentUrl", () => {
    const offenders: string[] = [];
    let sinks = 0;
    for (const file of walk(SRC)) {
      const raw = readFileSync(file, "utf8");
      if (!/(safe|openable)DocumentUrl/.test(raw)) continue;
      const src = blankComments(raw);
      const rel = file.slice(SRC.length + 1);
      sinks += (src.match(/href=\{openableDocumentUrl\(|window\.open\(\s*\w+/g) ?? []).length;
      for (const m of src.matchAll(/href=\{safeDocumentUrl\(/g)) offenders.push(`${rel}@${m.index}: href={safeDocumentUrl(…)} (a data: document opens nothing)`);
      for (const m of src.matchAll(/const (\w+) = safeDocumentUrl\([^)]*\);[\s\S]{0,240}?window\.open\(\s*\1\b/g)) offenders.push(`${rel}@${m.index}: window.open(${m[1]}) of a safeDocumentUrl value`);
      for (const m of src.matchAll(/window\.open\(\s*safeDocumentUrl\(/g)) offenders.push(`${rel}@${m.index}: window.open(safeDocumentUrl(…))`);
    }
    expect(sinks, "found almost no document-opening sinks — the scan is broken").toBeGreaterThan(8);
    expect(offenders.join("\n")).toBe("");
  });
});
