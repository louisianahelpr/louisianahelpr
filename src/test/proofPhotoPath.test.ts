/**
 * THE READ HALF OF THE SIGNED-URL FIX.
 *
 * `noPersistedSignedUrls.test.ts` stops a new call site from WRITING a token
 * down. This pins the other half: that the values already written down — 93 of
 * them in prod on 2026-09-22, 85 full signed URLs and 8 seed placeholders —
 * still resolve, and that the backfill's extraction and the client's agree on
 * exactly what the path is.
 *
 * The prod shape, verified read-only against fncmgoasalhdgfwzhsqa by decoding
 * the JWT in each `?token=` and comparing its `url` claim with the extracted
 * path: 85/85 identical, 0 mismatches. The literals below are that shape.
 */
import { describe, it, expect } from "vitest";
import { extractProofPhotoPath } from "@/lib/proofPhotoStorage";

const JOB = "b5e7aaa2-8383-4858-83f5-928946352b5c";
const FILE = "before-1790092567342-quenxezebj.png";
/** Verbatim prod shape (token elided). */
const LEGACY_SIGNED = `https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/proof-photos/${JOB}/${FILE}?token=eyJhbGciOiJIUzI1NiJ9.e30.x`;

describe("proof photo path extraction", () => {
  it("pulls the path out of a legacy signed URL — the 85 rows in prod", () => {
    // This is the whole fix: the same path the token's own `url` claim names,
    // recovered from the URL without trusting the token.
    expect(extractProofPhotoPath(LEGACY_SIGNED)).toBe(`${JOB}/${FILE}`);
  });

  it("drops the whole query string, not just the token parameter", () => {
    expect(
      extractProofPhotoPath(`${LEGACY_SIGNED}&download=1`),
    ).toBe(`${JOB}/${FILE}`);
  });

  it("leaves a bare path alone, so it is safe to run on converted rows", () => {
    // Idempotence on the client side, mirroring the migration's own.
    expect(extractProofPhotoPath(`${JOB}/${FILE}`)).toBe(`${JOB}/${FILE}`);
    expect(extractProofPhotoPath(extractProofPhotoPath(LEGACY_SIGNED))).toBe(
      `${JOB}/${FILE}`,
    );
  });

  it("refuses to guess at a URL that does not name the bucket", () => {
    // The 8 `example.invalid` seed values. "" means "not mine to sign", and
    // the caller falls back to rendering the URL as given — today's behaviour
    // for those rows, unchanged.
    expect(extractProofPhotoPath(`https://example.invalid/${JOB}/before.png`)).toBe("");
    expect(extractProofPhotoPath("")).toBe("");
    expect(extractProofPhotoPath(null)).toBe("");
    expect(extractProofPhotoPath(undefined)).toBe("");
  });
});

// SHOWN ABLE TO FAIL: an extractor that hands the bucket prefix back with the
// path signs `proof-photos/<job>/<file>` inside the `proof-photos` bucket —
// a 404 on every photo, and the exact empty box this whole fix is about.
// @mutate src/lib/proofPhotoStorage.ts | return match[1].split("?")[0]; | return match[0].split("?")[0];
