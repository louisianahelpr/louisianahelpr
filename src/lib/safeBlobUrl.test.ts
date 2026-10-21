/**
 * safeBlobUrl: only a "blob:" URL (URL.createObjectURL of a picked File) reaches an <img src>.
 *
 * @mutate src/lib/safeBlobUrl.ts |   return typeof url === "string" && url.startsWith("blob:") ? url : null; |   return url ?? null;
 * @mutate src/components/declutter/DeclutterHandoverSheets.tsx |   const preview = safeBlobUrl(url); |   const preview = url;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { safeBlobUrl } from "./safeBlobUrl";

describe("safeBlobUrl", () => {
  it("passes a blob: URL through unchanged", () => {
    expect(safeBlobUrl("blob:http://localhost/1b2c")).toBe("blob:http://localhost/1b2c");
  });
  it("refuses anything else: script, data, remote, empty, missing", () => {
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "https://evil.example/x.png", " blob:x", "", null, undefined]) {
      expect(safeBlobUrl(bad)).toBeNull();
    }
  });

  it("the porch preview <img> draws only what safeBlobUrl let through", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeclutterHandoverSheets.tsx"), "utf8"));
    expect(src).toContain("const preview = safeBlobUrl(url);");
    expect(src).toMatch(/<img src=\{preview\} alt="Your porch photo"/);
  });
});
