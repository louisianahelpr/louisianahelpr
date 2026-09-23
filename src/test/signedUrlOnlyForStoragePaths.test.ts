// @mutate src/lib/messageAttachments.ts | if (!isStorageObjectPath(path)) return null; | if (false) return null;
/**
 * ONLY A STORAGE PATH GETS SIGNED — the class guard for "a stored value that is
 * already a URL was sent to Storage as if it were an object path".
 *
 * `supabase.storage.from(b).createSignedUrl(p)` is a POST to
 * `/storage/v1/object/sign/<b>/<p>`. When `p` is `data:image/png;base64,…`
 * (or `https://…`, or `blob:…`) Storage answers HTTP 400 and the caller shows a
 * spinner or an error for a value that was viewable all along.
 *
 * The original: admin → People → open any seed profile. 52 prod profiles carry
 * `id_document_url = 'data:image/png;base64,iVBOR…'` (measured 2026-09-22,
 * `select left(id_document_url,40), count(*) from profiles …`), and
 * useOpenProfile signed it unconditionally → `400 POST data:image/png;base64,…`
 * in press-every-control run 35805671843 (issue #1582), Documents tab stuck on
 * "Loading document…".
 *
 * The inventory is every `createSignedUrl(` / `createSignedUrls(` call in
 * `src/` outside tests, found by walking the tree — not a hand list. Each one
 * must be gated by `isStorageObjectPath` (src/lib/storagePath.ts) within the
 * few lines above it, so a new call site that forgets the gate fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isStorageObjectPath } from "@/lib/storagePath";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
/** How far above the call the gate may sit (a guard clause + a comment). */
const WINDOW_LINES = 12;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "test" || entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

type Site = { file: string; line: number; gated: boolean };

function signSites(files: { file: string; text: string }[]): Site[] {
  const sites: Site[] = [];
  for (const { file, text } of files) {
    const lines = text.split("\n");
    lines.forEach((l, i) => {
      // A real call: `.createSignedUrl(` / `.createSignedUrls(` — not a mention
      // in a comment (`// … createSignedUrl(path) …`) or a type.
      if (!/\.createSignedUrls?\(/.test(l)) return;
      const trimmed = l.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      const window = lines.slice(Math.max(0, i - WINDOW_LINES), i + 1).join("\n");
      sites.push({ file, line: i + 1, gated: /isStorageObjectPath\(/.test(window) });
    });
  }
  return sites;
}

describe("createSignedUrl is only ever handed a storage path", () => {
  const files = sourceFiles(SRC).map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, "utf8") }));
  const sites = signSites(files);

  it("finds the sign calls (the walk is not vacuous)", () => {
    // 9 call sites on 2026-09-22; 8 on 2026-09-23 after Q40 deleted the
    // admin id-document signer in useOpenProfile. A sharp drop means the walk
    // broke, not that the app stopped signing.
    expect(sites.length).toBeGreaterThanOrEqual(8);
    expect(sites.map((s) => s.file)).toContain("src/components/admin/AdminCredentialQueue.tsx");
  });

  it("every call site gates its argument with isStorageObjectPath", () => {
    const ungated = sites.filter((s) => !s.gated).map((s) => `${s.file}:${s.line}`);
    expect(ungated, "sign only a storage path — gate with isStorageObjectPath (src/lib/storagePath.ts)").toEqual([]);
  });

  it("the gate can fail: the original useOpenProfile shape is caught", () => {
    const original = [
      "    if (profile.id_document_url) {",
      "      const { data: signedData, error: signedError } = await supabase.storage",
      '        .from("id-documents")',
      "        .createSignedUrl(profile.id_document_url, 3600); // 1 hour",
    ].join("\n");
    const [site] = signSites([{ file: "original.ts", text: original }]);
    expect(site.gated).toBe(false);
  });
});

describe("isStorageObjectPath", () => {
  it("rejects the exact prod value that 400'd", () => {
    expect(
      isStorageObjectPath(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      ),
    ).toBe(false);
  });

  it("rejects every other URL form", () => {
    for (const v of ["https://x.supabase.co/storage/v1/object/public/a/b.png", "http://a/b", "blob:https://a/1", "//cdn/x.png", "", "   ", null, undefined]) {
      expect(isStorageObjectPath(v), String(v)).toBe(false);
    }
  });

  it("accepts real object paths, including the prod id-documents shape", () => {
    for (const v of ["76b07824-9b41-4741-a4c4-4f8de362f682/id-front.jpg", "uid/job/file.pdf", "uid/support/1726000000.png", "a/b:c.png"]) {
      expect(isStorageObjectPath(v), v).toBe(true);
    }
  });
});
