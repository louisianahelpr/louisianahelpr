/**
 * Storage's answer to a second upload of a path it already holds: 409 "Duplicate", "The resource already exists".
 * PhotoProof retries a failed upload on the SAME path once; this answer means the first try had landed (a
 * "Load failed" can arrive after the server saved the file: prod, 2026-10-22 14:40Z, job 7c6deb77).
 * Guard: src/test/proofPhotosAppend.test.tsx.
 */
export function isAlreadyStored(error: { message?: string; statusCode?: string | number; error?: string } | null | undefined): boolean {
  if (!error) return false;
  return String(error.statusCode ?? "") === "409" || /duplicate|already exists/i.test(`${error.error ?? ""} ${error.message ?? ""}`);
}
