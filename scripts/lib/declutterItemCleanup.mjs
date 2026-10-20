/**
 * Remove Declutter test items (and their photo files) that a test run could not
 * remove itself. Node/Storage-REST twin of the undo in
 * e2e/prod-audit/declutterFixture.ts, for the two places that left items on
 * prod when their last attempt died before its own cleanup ran:
 *   - e2e/prod-audit "Fixture rocking chair / side table <E2E-PRODAUDIT>" (the final
 *     attempt of a timed-out leg never reaches test.afterAll), swept by
 *     scripts/e2e/prod-audit-sweeper.mjs;
 *   - scripts/e2e/declutterPayoutProof.mjs "Payout proof lamp <runId>" (a failed run
 *     left it live for sale), removed by its own finally / unlink.
 *
 * SAFETY, the same shape as the job sweeper's:
 *   - service role only (the caller passes headers it built from the service key);
 *   - an item is touched only when declutterItemMatches() says so: title carries
 *     the marker, seller is one of the named test sellers, is_seed is true and
 *     the status is one no buyer holds. The REST query is a pre-filter, the
 *     client-side re-check is the gate;
 *   - the DELETE itself repeats seller_id and is_seed, and must remove exactly one row;
 *   - photo objects are removed only AFTER the row (a seller can delete only an
 *     unattached photo, and the row's cascade is what detaches it), only from
 *     paths that sit under `<seller>/declutter/<item>/`, and the count removed
 *     is read from the response, never assumed.
 * Never throws: failures come back as strings for the caller to print or fail on.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses a test item sits in before anyone buys it; `reserved`, `completed` and the rest are a buyer's or a record. */
export const SWEEPABLE_ITEM_STATUSES = ["draft", "pending_review", "live"];
// Declutter photos live in the job-photos bucket (declutter_add_item_photo takes a path in it). The bucket is a
// LITERAL in the delete URL below, so avatarRowObjectAgreement B2 can see this never touches the avatars bucket.

/** Pure: the REST query for items whose title carries `marker`, owned by `sellerIds`, is_seed, still unsold. */
export function candidateDeclutterItemsQuery(marker, sellerIds) {
  const titleLike = encodeURIComponent(`*${marker}*`);
  const sellers = encodeURIComponent(`(${sellerIds.join(",")})`);
  const statuses = encodeURIComponent(`(${SWEEPABLE_ITEM_STATUSES.join(",")})`);
  return (
    "declutter_items?select=id,title,seller_id,is_seed,status,created_at" +
    `&title=ilike.${titleLike}` +
    `&seller_id=in.${sellers}` +
    "&is_seed=is.true" +
    `&status=in.${statuses}` +
    "&order=created_at.asc" +
    "&limit=500"
  );
}

/** Pure: the client-side re-check of one row against the same conditions the query encodes. */
export function declutterItemMatches(item, { marker, sellerIds }) {
  return (
    !!item &&
    typeof item.id === "string" &&
    UUID_RE.test(item.id) &&
    typeof item.title === "string" &&
    !!marker &&
    item.title.includes(marker) &&
    Array.isArray(sellerIds) &&
    sellerIds.includes(item.seller_id) &&
    item.is_seed === true &&
    SWEEPABLE_ITEM_STATUSES.includes(item.status)
  );
}

/** Pure: a photo path counts only when it sits under this seller's own folder for this item. */
export function photoPathBelongsTo(storagePath, item) {
  return typeof storagePath === "string" && storagePath.startsWith(`${item.seller_id}/declutter/${item.id}/`) && !storagePath.includes("..");
}

async function rest(base, headers, method, query) {
  // return=representation without select= is RETURNING *, which authenticated cannot read on some tables (403).
  const path = method === "DELETE" && !/[?&]select=/.test(query) ? `${query}${query.includes("?") ? "&" : "?"}select=id` : query;
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: { ...headers, "Content-Type": "application/json", ...(method === "DELETE" ? { Prefer: "return=representation" } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let rows = null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    /* non-array body */
  }
  return { ok: res.ok, status: res.status, rows, body: text.slice(0, 200) };
}

/**
 * Delete `items` (already matched by the caller) and their photo files.
 * Order: read the photo paths, delete the item row (photos cascade), then the objects.
 */
export async function removeDeclutterItemsRest({ base, headers, items, source = "declutter-cleanup" }) {
  const failures = [];
  let removedItems = 0;
  let removedObjects = 0;
  for (const item of items) {
    try {
      const photos = await rest(base, headers, "GET", `declutter_item_photos?item_id=eq.${item.id}&select=storage_path`);
      if (!photos.ok || !photos.rows) {
        failures.push(`photos of ${item.id}: HTTP ${photos.status} ${photos.body}`);
        continue;
      }
      const paths = photos.rows.map((r) => r.storage_path).filter((p) => photoPathBelongsTo(p, item));
      const del = await rest(base, headers, "DELETE", `declutter_items?id=eq.${item.id}&seller_id=eq.${item.seller_id}&is_seed=eq.true&select=id`);
      // A DELETE matching zero rows answers 200 with []: a silent non-deletion, so it is a failure.
      if (!del.ok || del.rows?.length !== 1) {
        failures.push(`declutter_items/${item.id}: HTTP ${del.status} removed=${del.rows?.length ?? "?"} ${del.body}`);
        continue;
      }
      removedItems += 1;
      if (paths.length === 0) continue;
      const res = await fetch(`${base}/storage/v1/object/job-photos`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      let n = 0;
      try {
        const parsed = JSON.parse(text);
        n = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        /* not JSON */
      }
      removedObjects += n;
      if (!res.ok || n < paths.length) failures.push(`photos of ${item.id}: removed ${n} of ${paths.length} (HTTP ${res.status})`);
    } catch (e) {
      failures.push(`${item.id}: ${String(e?.message ?? e)}`);
    }
  }
  if (failures.length) console.warn(`[${source}] declutter cleanup incomplete: ${failures.join("; ")}`);
  return { removedItems, removedObjects, failures };
}
