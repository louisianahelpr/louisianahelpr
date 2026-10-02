// @mutate src/components/admin/userDetail/DocumentsTab.tsx | <SignedPortfolioTile key={i} path={url} fileName={fileName} /> | null
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * docs/OPEN.md: "Admin DocumentsTab can't open a portfolio STORAGE PATH."
 * complete-signup stores some `portfolio_urls` entries as bare `user-documents`
 * storage paths (src/lib/portfolioStorage.ts's `portfolioObjectName` doc
 * comment), not public URLs. Before this fix those rows fell through
 * safeDocumentUrl() to "Link withheld (not https)" forever, with no way for an
 * admin to ever open them — a legacy upload nobody could review.
 *
 * This guard proves the branch that signs a storage-path portfolio entry (via
 * SignedPortfolioTile, the same createSignedUrl-on-click pattern
 * AdminCredentialQueue.tsx already uses for id/license/insurance documents in
 * the same bucket) is present, instead of unconditionally showing the
 * withheld message.
 */
const SRC = join(__dirname, "..", "components", "admin", "userDetail", "DocumentsTab.tsx");

describe("admin DocumentsTab signs a storage-path portfolio entry instead of withholding it", () => {
  const text = readFileSync(SRC, "utf8");

  it("renders a SignedPortfolioTile when a portfolio entry is a storage path", () => {
    expect(text).toMatch(/isStorageObjectPath\(url\)/);
    expect(text).toMatch(/<SignedPortfolioTile key=\{i\} path=\{url\} fileName=\{fileName\} \/>/);
  });

  it("gates its createSignedUrl call with isStorageObjectPath (signedUrlOnlyForStoragePaths)", () => {
    const lines = text.split("\n");
    const signIdx = lines.findIndex((l) => /\.createSignedUrl\(/.test(l));
    expect(signIdx, "no createSignedUrl call found").toBeGreaterThan(-1);
    const window = lines.slice(Math.max(0, signIdx - 12), signIdx + 1).join("\n");
    expect(window).toMatch(/isStorageObjectPath\(/);
  });
});
