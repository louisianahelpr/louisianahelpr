import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * PROOF PHOTOS ARE STORED AS PATHS, SIGNED AT DISPLAY TIME.
 *
 * `proof-photos` is a private bucket. `createSignedUrl(path, ttl)` returns a
 * URL whose `?token=` is a JWT carrying an `exp`; writing that string into
 * `jobs.proof_before_urls` / `jobs.proof_after_urls` stores a value that is
 * correct on the day it is written and 400s forever after `exp` — with no
 * error at write time and none at read time. The only symptom is an empty box
 * with its alt text, which is the shape of the owner's 2026-09-21 report.
 *
 * The repo already wrote the right pattern down for `user-documents`:
 *
 *   'Storage path within the … bucket …, NOT a full URL. Resolve via
 *    supabase.storage.from(…).createSignedUrl(path, ttl) at display time.'
 *   — supabase/migrations/20260505220000_split_avatars_bucket_private_user_documents.sql
 *
 * This is that pattern for `proof-photos`, shaped like the existing
 * `src/lib/applicationAttachments.ts` so there is one idiom, not two.
 *
 * BOTH SHAPES ARE ACCEPTED ON READ, deliberately and permanently:
 * `extractProofPhotoPath` takes a bare path OR a legacy full signed URL and
 * yields the path either way. That is what lets the code fix stand on its own
 * — old rows render correctly the moment this ships, before the backfill runs
 * and regardless of whether it ever does.
 */
export const PROOF_PHOTOS_BUCKET = "proof-photos";

/** Display-time TTL. Minutes, not months: long enough for the dialog that is
 *  open right now, short enough that nothing is worth storing. */
export const PROOF_PHOTO_SIGN_TTL_SECONDS = 60 * 10;

/**
 * The object path inside `proof-photos` for a stored value.
 *
 * - a bare path (`<jobId>/before-….png`) comes back unchanged;
 * - a legacy signed URL (`…/object/sign/proof-photos/<jobId>/before-….png?token=…`)
 *   has everything up to the bucket, and the whole query string, stripped;
 * - anything else — a URL that does not name this bucket, e.g. the
 *   `https://example.invalid/…` placeholders in seed rows — returns "", which
 *   tells the caller "this is not mine to sign" rather than guessing.
 */
export function extractProofPhotoPath(urlOrPath: string | null | undefined): string {
  if (!urlOrPath) return "";
  if (!/^https?:\/\//i.test(urlOrPath)) return urlOrPath.replace(/^\/+/, "");
  const match = urlOrPath.match(new RegExp(`/${PROOF_PHOTOS_BUCKET}/(.+)$`));
  if (!match) return "";
  return match[1].split("?")[0];
}

/** A short-lived URL for one stored value, or null if it cannot be signed. */
export async function getProofPhotoSignedUrl(
  urlOrPath: string | null | undefined,
  expiresInSeconds: number = PROOF_PHOTO_SIGN_TTL_SECONDS,
): Promise<string | null> {
  const path = extractProofPhotoPath(urlOrPath);
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage
      .from(PROOF_PHOTOS_BUCKET)
      .createSignedUrl(path, expiresInSeconds);
    if (error) {
      // NOT a silent catch: signing can legitimately fail (the object was
      // deleted, RLS says no) and the caller's answer to that is to render
      // nothing — but a reader seeing nothing is a real symptom, so it is
      // reported rather than swallowed.
      report(error, { tags: { source: "proofPhotoStorage.createSignedUrl" } });
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (err) {
    // A throw here (offline, a storage client that is not there) must degrade
    // to an unrendered photo, never to an unhandled rejection inside a React
    // effect — which is how this surfaced in the component tests.
    report(err, { tags: { source: "proofPhotoStorage.createSignedUrl" } });
    return null;
  }
}

/**
 * Signs a batch, preserving order and length so a caller can zip the result
 * against the array it passed. An entry that cannot be signed comes back null;
 * a value that was already an unsignable absolute URL comes back as itself, so
 * a seed row keeps rendering exactly what it rendered before.
 */
export async function signProofPhotoUrls(
  values: readonly string[],
  expiresInSeconds: number = PROOF_PHOTO_SIGN_TTL_SECONDS,
): Promise<(string | null)[]> {
  return Promise.all(
    values.map(async (value) => {
      const signed = await getProofPhotoSignedUrl(value, expiresInSeconds);
      if (signed) return signed;
      return /^https?:\/\//i.test(value ?? "") ? value : null;
    }),
  );
}
