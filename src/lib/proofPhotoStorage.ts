import { supabase } from "@/integrations/supabase/client";
import { isStorageObjectPath } from "@/lib/storagePath";
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
const PROOF_PHOTOS_BUCKET = "proof-photos";

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

/**
 * SIGNED URLS ARE BATCHED AND REUSED.
 *
 * #1582 (press-every-control run 36208184593, shard 2): one visit to the
 * poster's job list sent a `createSignedUrl` POST per photo, every time a
 * gallery mounted, and never reused the ten-minute URL it had just been given.
 * That shard's storage requests went from 1,657 to 14,095, storage answered
 * `429` on `/object/sign/proof-photos/…`, and the photo that got the 429 did
 * not render. A person scrolling a long list pays the same cost.
 *
 * Now every call signs the paths it does not already hold in ONE
 * `createSignedUrls` request, several galleries asking at once share that
 * request, and a signed URL is handed out again while at least half of its
 * life is left. A path that cannot be signed (deleted object, RLS) still comes
 * back null and is still reported, per path.
 */
type SignedEntry = { url: string; expiresAt: number };
const signed = new Map<string, SignedEntry>();
const inFlight = new Map<string, Promise<void>>();

/** Test hook: forget every signed URL and pending batch. */
export function resetProofPhotoSignCache(): void {
  signed.clear();
  inFlight.clear();
}

function usable(path: string, expiresInSeconds: number, now: number): string | null {
  const hit = signed.get(path);
  return hit && hit.expiresAt - now >= (expiresInSeconds * 1000) / 2 ? hit.url : null;
}

async function signBatch(paths: string[], expiresInSeconds: number): Promise<void> {
  // Only storage object paths are ever signed (signedUrlOnlyForStoragePaths).
  const objectPaths = paths.filter((p) => isStorageObjectPath(p));
  if (objectPaths.length === 0) return;
  const requestedAt = Date.now();
  try {
    const { data, error } = await supabase.storage
      .from(PROOF_PHOTOS_BUCKET)
      .createSignedUrls(objectPaths, expiresInSeconds);
    if (error) {
      // NOT a silent catch: signing can legitimately fail and the caller's
      // answer is to render nothing, but a reader seeing nothing is a real
      // symptom, so it is reported rather than swallowed.
      report(error, { tags: { source: "proofPhotoStorage.createSignedUrls" } });
      return;
    }
    for (const row of data ?? []) {
      if (row.error || !row.signedUrl || !row.path) {
        // One missing object (deleted, RLS) does not fail the batch; it is
        // reported on its own, the way the per-path call reported it.
        report(new Error(`proof photo not signed: ${row.error ?? "no url"} (${row.path ?? "?"})`), {
          tags: { source: "proofPhotoStorage.createSignedUrls" },
        });
        continue;
      }
      signed.set(row.path, { url: row.signedUrl, expiresAt: requestedAt + expiresInSeconds * 1000 });
    }
  } catch (err) {
    // A throw here (offline, a storage client that is not there) must degrade
    // to an unrendered photo, never to an unhandled rejection inside a React
    // effect — which is how this surfaced in the component tests.
    report(err, { tags: { source: "proofPhotoStorage.createSignedUrls" } });
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
  // `data:`/`blob:` values pass extractProofPhotoPath unchanged (it only
  // strips http(s) URLs); isStorageObjectPath rejects them.
  const paths = values.map((v) => {
    const p = extractProofPhotoPath(v);
    return isStorageObjectPath(p) ? p : "";
  });
  const now = Date.now();
  const toSign = [...new Set(paths.filter((p) => p && !usable(p, expiresInSeconds, now) && !inFlight.has(p)))];
  if (toSign.length) {
    const batch = signBatch(toSign, expiresInSeconds).finally(() => {
      for (const p of toSign) if (inFlight.get(p) === batch) inFlight.delete(p);
    });
    for (const p of toSign) inFlight.set(p, batch);
  }
  await Promise.all([...new Set(paths.filter((p) => p && inFlight.has(p)).map((p) => inFlight.get(p)))]);
  const at = Date.now();
  return values.map((value, i) => {
    const url = paths[i] ? signed.get(paths[i])?.url ?? null : null;
    if (url && (signed.get(paths[i])?.expiresAt ?? 0) > at) return url;
    return /^https?:\/\//i.test(value ?? "") ? value : null;
  });
}
