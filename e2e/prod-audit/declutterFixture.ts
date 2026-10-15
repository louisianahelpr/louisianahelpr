/**
 * DECLUTTER FIXTURE for the messy-input FORMS sweep (messyInputForms.ts:
 * declutter-ask, declutter-review). The ask-a-question field renders only on
 * a LIVE item the viewer does not sell, and the admin review card's reason
 * field only on a listing WAITING for a review, so each run mints both, as the
 * shared helper (a tester while the 'declutter' switch is at testers):
 *
 *   live    — a draft with 3 photos, the four confirmations and a pickup time,
 *             published (a new seller's listing waits for a review) and then
 *             approved by the shared admin, so it is for sale;
 *   pending — the same, published and left waiting.
 *
 * Everything goes through the app's own RPCs with the test accounts' sessions
 * (declutter_create_item, declutter_add_item_photo, declutter_attest_item,
 * declutter_set_pickup_windows, declutter_publish_item,
 * declutter_admin_review_item); photos are a 1x1 PNG in the seller's own
 * `<uid>/declutter/<item>/` folder. The undo removes the storage objects as the
 * seller and the item rows with the service role (photos, private row,
 * confirmations, questions and watches cascade). Rows are deleted rather than
 * withdrawn so the helper's approved-listing count never reaches 3: past 3 a
 * new listing goes live without a review and the review card would be empty.
 * The items carry MARKER in their title and are is_seed (the seller is a test
 * account: declutter_items_seed_from_seller).
 */
import type { APIRequestContext } from "@playwright/test";
import { srFetch } from "../serviceRoleFetch";
import { SUPABASE_URL, rest, type Session } from "../journeys/fixtures";

const BUCKET = "job-photos";
/** A 1x1 PNG (the same pixel harness.ts seeds avatars with). */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

export interface DeclutterFixture {
  liveId: string | null;
  pendingId: string | null;
  log: string[];
  undo: (api: APIRequestContext) => Promise<string[]>;
}

async function rpc<T>(api: APIRequestContext, s: Session, name: string, args: Record<string, unknown>): Promise<T> {
  const r = await api.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { headers: rest(s), data: args });
  const body = await r.text();
  if (!r.ok()) throw new Error(`${name}: ${r.status()} ${body.slice(0, 300)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function mintItem(api: APIRequestContext, seller: Session, marker: string, label: string, paths: string[]): Promise<{ id: string; status: string }> {
  const id = await rpc<string>(api, seller, "declutter_create_item", {
    p_title: `${label} ${marker}`.slice(0, 80),
    p_description: `${marker} messy-input fixture. Not for sale.`,
    p_category: "furniture",
    p_condition_stars: 4,
    p_delivery_size: "small",
    p_price_cents: 4000,
    p_floor_price_cents: 2000,
    p_area_label: "Downtown, Baton Rouge",
    p_pickup_address: "900 North 3rd Street, Baton Rouge, LA 70802",
    p_pickup_lat: 30.4571,
    p_pickup_lng: -91.1874,
  });
  for (let i = 0; i < 3; i++) {
    const path = `${seller.user.id}/declutter/${id}/fixture${i}.png`;
    const up = await api.post(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      headers: { ...rest(seller, { "Content-Type": "image/png", "x-upsert": "false" }) },
      data: PIXEL,
    });
    if (!up.ok()) throw new Error(`upload ${path}: ${up.status()} ${(await up.text()).slice(0, 200)}`);
    paths.push(path);
    await rpc(api, seller, "declutter_add_item_photo", { p_item_id: id, p_storage_path: path });
  }
  await rpc(api, seller, "declutter_attest_item", {
    p_item_id: id,
    p_bought_for_personal_use: true,
    p_not_in_the_business: true,
    p_not_a_frequent_seller: true,
    p_keeps_item_until_handover: true,
  });
  const status = await rpc<string>(api, seller, "declutter_publish_item", { p_item_id: id });
  return { id, status };
}

export async function ensureDeclutterFixture(
  api: APIRequestContext,
  s: { helper: Session; admin: Session },
  marker: string,
  serviceKey: string | null,
): Promise<DeclutterFixture> {
  const log: string[] = [];
  const ids: string[] = [];
  const paths: string[] = [];
  const undo = async (a: APIRequestContext): Promise<string[]> => {
    const out: string[] = [];
    if (paths.length) {
      const r = await a.delete(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { headers: rest(s.helper), data: { prefixes: paths } });
      out.push(`declutter photos (${paths.length}): ${r.ok() ? "removed" : `NOT removed (${r.status()})`}`);
    }
    for (const id of ids) {
      if (!serviceKey) {
        out.push(`declutter_items/${id}: NOT removed (no service-role key)`);
        continue;
      }
      const r = await srFetch(serviceKey, "DELETE", `${SUPABASE_URL}/rest/v1/declutter_items?id=eq.${id}&seller_id=eq.${s.helper.user.id}&is_seed=eq.true`);
      out.push(`declutter_items/${id}: ${r.ok() ? "removed" : `NOT removed (${r.status()})`}`);
    }
    return out;
  };
  // Nothing is created that could not be removed.
  if (!serviceKey) return { liveId: null, pendingId: null, log: ["no service-role key: declutter fixture not minted"], undo };
  try {
    await rpc(api, s.helper, "declutter_set_pickup_windows", { p_windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }] });
    const live = await mintItem(api, s.helper, marker, "Fixture rocking chair", paths);
    ids.push(live.id);
    if (live.status === "pending_review") {
      const st = await rpc<string>(api, s.admin, "declutter_admin_review_item", { p_item_id: live.id, p_approve: true, p_note: null });
      log.push(`live item ${live.id}: published, approved -> ${st}`);
    } else {
      log.push(`live item ${live.id}: published -> ${live.status}`);
    }
    const pending = await mintItem(api, s.helper, marker, "Fixture side table", paths);
    ids.push(pending.id);
    log.push(`pending item ${pending.id}: published -> ${pending.status}`);
    return { liveId: live.id, pendingId: pending.status === "pending_review" ? pending.id : null, log, undo };
  } catch (err) {
    // Not swallowed: the failure is printed with the fixture log, the two sweeps that need these
    // items then fail loudly in their prepare ("none was minted"), and the undo still removes
    // whatever was created before the failure (ids/paths are recorded as each one is made).
    log.push(`declutter fixture failed: ${(err as Error).message}`);
    return { liveId: null, pendingId: null, log, undo };
  }
}
