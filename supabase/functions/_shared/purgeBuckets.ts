/**
 * The buckets account deletion erases, and the check that each one EXISTS.
 *
 * Q219: a service-role `storage.from(b).list(prefix)` against a bucket that
 * does not exist answers `{ data: [], error: null }` (HTTP 200). A misspelled
 * or dropped name in the list below therefore made account deletion report
 * `storage ok` while erasing nothing there, and the re-list verification could
 * not see it either (it lists the same nothing). The old "not found|does not
 * exist → skip" branches never fired for the same reason. The only way to tell
 * "missing" from "empty" is to ask Storage which buckets exist, so the purge
 * does that first and fails the step on any name it does not know.
 *
 * Kept in its own dependency-free module so vitest can run it
 * (src/test/purgeBucketsAreDeclared.test.ts); accountPurge.ts itself imports
 * Deno-only modules.
 */

/**
 * Buckets holding media that identifies the PERSON. These are erased.
 *
 * Deliberately NOT in this list: `job-photos`, `proof-photos`,
 * and `message-attachments`. Those are keyed by job, not by user, and they are
 * evidence attached to a record that
 * survives — a completed job, a settled dispute. Deleting them would destroy
 * the counterparty's evidence to satisfy this user's request, which is the
 * same mistake as cascading their reviews away.
 *
 * That reasoning holds only while the job row exists. The jobs
 * `purge_user_data()` itself deletes have their media removed afterwards by
 * `removeMediaOfDeletedJobs` (accountPurge.ts), never blocking.
 *
 * Every name here must be a bucket the migrations still declare
 * (src/test/purgeBucketsAreDeclared.test.ts), and at run time must exist
 * (`missingBuckets` below). `id-documents` (Q196) and `profile-videos`
 * (20260921212141) were removed with their buckets.
 */
export const IDENTITY_BUCKETS = [
  "avatars",
  "user-documents",
  "application-attachments",
] as const;

/**
 * Per-user FOLDERS inside an otherwise job-keyed bucket that hold the person's
 * own media and are erased with the account. Declutter listing photos
 * (docs/specs/declutter-auctions.md B4) live at `job-photos/<uid>/declutter/`:
 * they belong to the seller's listings, which CASCADE away with the account,
 * so nothing survives that would need them as evidence. Quote past-work
 * photos live at `job-photos/<uid>/quotes/` (src/lib/quotes/api.ts
 * quotePhotoPath): when the quoter's account goes, the
 * quote_follows_quoter_deletion trigger (20261015091114_job_quotes.sql)
 * already empties job_quotes.photo_paths, so the objects are referenced by
 * nothing and would otherwise sit in a PUBLIC bucket forever. The rest of
 * job-photos stays out, for the reason above.
 */
export const IDENTITY_SUBFOLDERS = [
  { bucket: "job-photos", folder: "declutter" },
  // Porch and problem photos (20261017055502): the PRIVATE declutter-handover
  // bucket, same <uid>/declutter/ folder, erased with the account as before.
  { bucket: "declutter-handover", folder: "declutter" },
  { bucket: "job-photos", folder: "quotes" },
  // A Helpr's truck photo (20261017055505, row 41; it may show a plate): the
  // PRIVATE helpr-tasks bucket at <uid>/vehicle/. The task photos beside it
  // (<uid>/task/<task>/) stay: they are the pickup and door evidence of a
  // delivery whose task row survives the account (helpr_id SET NULL), the
  // buyer's and seller's record of the handover, as proof-photos are.
  { bucket: "helpr-tasks", folder: "vehicle" },
  // Shop logos, covers and photos (20261017061155): the shop CASCADEs away
  // with the account, so nothing survives that would need them.
  { bucket: "job-photos", folder: "shops" },
  // Shop item photos (20261017061157, <uid>/shop-items/<item>/): the items
  // CASCADE away with the shop and the account.
  { bucket: "job-photos", folder: "shop-items" },
  // NOT here on purpose: Shops ready photos (20261018211820, the PRIVATE shop-handover
  // bucket, <uid>/shops/handover/<order>/) are the handover evidence of an order that
  // survives the account (parties SET NULL), as the helpr-tasks task photos are.
  // Homes -> Rent listing photos (20261019043000,
  // <uid>/rental-listings/<listing>/): the listings CASCADE away with the
  // account, so nothing survives that would need them.
  { bucket: "job-photos", folder: "rental-listings" },
  // Since 20261019071203 listing photos live in the PRIVATE listing-photos
  // bucket, same <uid>/rental-listings/<listing>/ folder (Q2211). The job-photos
  // entry above stays for any photo uploaded before the move.
  { bucket: "listing-photos", folder: "rental-listings" },
] as const;

/**
 * Subfolder buckets whose ABSENCE means "nothing to erase", never a failed
 * deletion. Each is created by a migration newer than the purge code that
 * names it, and the purge can run before that migration does:
 * functions-deploy.yml waits for the same commit's db-deploy run but then
 * ships whatever its conclusion (and a hand-run functions deploy waits for
 * nothing). Without this, every account deletion in that window failed its
 * storage step on a bucket that holds nothing. A bucket that does not exist
 * cannot hold an object (no upload can land in it), so its absence is logged
 * and the step stays ok. Q219 still holds for every other name: a misspelled
 * or dropped bucket fails the step, and every name here must also be declared
 * by the migrations (src/test/purgeBucketsAreDeclared.test.ts), so a typo
 * here fails CI rather than skipping the purge.
 *
 * TEMPORARY: an entry is retired once its bucket exists on prod (for
 * declutter-handover: `select id from storage.buckets where id =
 * 'declutter-handover'` returns a row, i.e. 20261017055502 applied; for
 * helpr-tasks the same with 20261017055505). Then
 * empty this list and set the EXACT check in
 * src/test/declutterPhotosPurged.test.ts to [] in the same commit.
 */
export const SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET: readonly string[] = ["declutter-handover", "helpr-tasks", "listing-photos"];

/**
 * Splits the subfolder buckets Storage does not have into the ones whose
 * absence is nothing to erase (SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET) and the
 * ones that fail the storage step (Q219).
 */
export function classifyMissingSubfolderBuckets(missing: readonly string[]): { notCreatedYet: string[]; failing: string[] } {
  return {
    notCreatedYet: missing.filter((b) => SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET.includes(b)),
    failing: missing.filter((b) => !SUBFOLDER_BUCKETS_MAY_NOT_EXIST_YET.includes(b)),
  };
}

/** `<uid>/<folder>` for each IDENTITY_SUBFOLDERS entry. */
export function identitySubfolderPrefixes(userId: string): { bucket: string; prefix: string }[] {
  return IDENTITY_SUBFOLDERS.map(({ bucket, folder }) => ({ bucket, prefix: `${userId}/${folder}` }));
}

/** The one Storage call this module needs. */
export interface BucketListingClient {
  storage: {
    // deno-lint-ignore no-explicit-any
    listBuckets(): any;
  };
}

/**
 * The names in `wanted` that Storage does not have. Throws when Storage cannot
 * be asked at all: "could not check" must never read as "none missing".
 */
export async function missingBuckets(
  admin: BucketListingClient,
  wanted: readonly string[],
): Promise<string[]> {
  const { data, error }: {
    data: { id?: string; name?: string }[] | null;
    error: { message: string } | null;
  } = await admin.storage.listBuckets();
  if (error) throw new Error(`listBuckets failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error("listBuckets returned no bucket list");
  const have = new Set<string>();
  for (const b of data) {
    if (b.id) have.add(b.id);
    if (b.name) have.add(b.name);
  }
  return wanted.filter((b) => !have.has(b));
}

/**
 * LEAD-LIST-FOR-SELLER (20261101034159): a hired Helpr writes Declutter listings on the SELLER's account, and the photos
 * are uploaded into the HELPR's folder (`job-photos/<helpr>/declutter/<item>/...`, the storage policy lets a member
 * write only their own folder). So the `<uid>/declutter` sweep alone gets both sides wrong:
 *  - the SELLER deletes their account: the photos of their listings in the Helpr's folder are theirs and must go too
 *    (`sellerExtra`, removed by exact path);
 *  - the HELPR deletes theirs: those photos are the seller's listing photos, not the Helpr's, and must stay
 *    (`helprKeep`, skipped by the sweep and by its re-list check).
 * Only a photo under `<that link's helpr>/declutter/<that link's item>/` counts, so a row naming any other path is
 * ignored either way (never a primitive to delete someone else's files).
 */
export interface ListedForSellerLink { item_id: string; helpr_id: string; seller_id: string }
export interface ListingPhotoRow { item_id: string; storage_path: string }

export function listedForSellerPhotoPlan(
  userId: string,
  links: readonly ListedForSellerLink[],
  photos: readonly ListingPhotoRow[],
): { sellerExtra: string[]; helprKeep: Set<string> } {
  const byItem = new Map(links.map((l) => [l.item_id, l]));
  const sellerExtra: string[] = [];
  const helprKeep = new Set<string>();
  for (const p of photos) {
    const l = byItem.get(p.item_id);
    if (!l || l.helpr_id === l.seller_id || !p.storage_path.startsWith(`${l.helpr_id}/declutter/${l.item_id}/`)) continue;
    if (l.seller_id === userId) sellerExtra.push(p.storage_path);
    else if (l.helpr_id === userId) helprKeep.add(p.storage_path);
  }
  return { sellerExtra, helprKeep };
}
