/**
 * shop-photo-check (Q1956, migration 20261112095000_shops_photo_byte_check): a shop photo is an image by its own
 * bytes, not by the content type the uploader's browser sent.
 *
 *   POST { path }   path = "<caller uid>/shops/<file>" (logo, cover, gallery) or
 *                          "<caller uid>/shop-items/<item uuid>/<file>" (an item photo), already uploaded to job-photos.
 *
 * Reads the object's first bytes as service_role through a 60-second signed link (the Range read shop-digital uses)
 * and matches them with _shared/digitalFileCheck.ts imageKindFromBytes (PNG, JPEG, WebP). The object's id is taken
 * BEFORE the read (shop_photo_object_id) and a match is stamped for that id only while it is still at the path
 * (shop_photo_stamp), so a delete and re-upload of other bytes never inherits the stamp; shops_attach_photo /
 * shops_add_item_photo then require and use up a stamp for the object now at the path.
 * A mismatch deletes the object (job-photos is public) and answers 400 photo_not_an_image.
 * Who the caller is comes from the token (auth.getUser); a path outside the caller's own folder is refused.
 */
import { serve } from "../_shared/buildStamp.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";
import { imageKindFromBytes, SNIFF_BYTES } from "../_shared/digitalFileCheck.ts";

const BUCKET = "job-photos";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const TRY_AGAIN = "Something went wrong. Please try again.";

/** The two shop photo folders, as the RPCs check them. */
function shopPhotoPathFor(path: string, userId: string): boolean {
  const shop = /^([0-9a-f-]{36})\/shops\/[A-Za-z0-9._-]{1,100}$/.exec(path);
  const item = /^([0-9a-f-]{36})\/shop-items\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}$/.exec(path);
  const owner = (shop ?? item)?.[1];
  return !!owner && owner === userId;
}

async function readHead(admin: SupabaseClient, path: string): Promise<Uint8Array | null> {
  const link = await admin.storage.from(BUCKET).createSignedUrl(path, 60);
  if (link.error || !link.data?.signedUrl) return null;
  const res = await fetch(link.data.signedUrl, { headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` } });
  if ((res.status !== 206 && res.status !== 200) || !res.body) return null;
  // Only the first bytes, even when the server ignores Range and sends the whole object.
  const reader = res.body.getReader();
  const head = new Uint8Array(SNIFF_BYTES);
  let got = 0;
  while (got < SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const take = Math.min(value.length, SNIFF_BYTES - got);
    head.set(value.subarray(0, take), got);
    got += take;
  }
  await reader.cancel().catch(() => undefined);
  return head.subarray(0, got);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 60, keyPrefix: "shop-photo-check" });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "not_authenticated" }, 401);
  const asMember = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await asMember.auth.getUser(authHeader.replace("Bearer ", ""));
  const user = authData?.user;
  if (authError || !user) return json({ error: "not_authenticated" }, 401);
  const unconfirmed = refuseUnconfirmedEmail(user, corsHeaders);
  if (unconfirmed) return unconfirmed;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
  );
  const off = await requireFeature(admin, "shops", user, corsHeaders);
  if (off) return off;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const path = String(body.path ?? "");
    if (!shopPhotoPathFor(path, user.id)) return json({ error: "photo_not_uploaded" }, 400);
    // The object's id first: the stamp is for the object whose bytes are read next, never for the path.
    const found = await admin.rpc("shop_photo_object_id", { p_path: path, p_owner: user.id });
    if (found.error) throw new Error(`object lookup failed: ${found.error.message}`);
    const objectId = typeof found.data === "string" ? found.data : null;
    if (!objectId) return json({ error: "photo_not_uploaded" }, 400);
    const head = await readHead(admin, path);
    if (!head) return json({ error: "photo_not_uploaded" }, 400);
    if (!imageKindFromBytes(head)) {
      const gone = await admin.storage.from(BUCKET).remove([path]);
      if (gone.error) console.error("[shop-photo-check] refused object not removed:", gone.error.message);
      return json({ error: "photo_not_an_image" }, 400);
    }
    const stamp = await admin.rpc("shop_photo_stamp", { p_path: path, p_owner: user.id, p_object_id: objectId });
    if (stamp.error) throw new Error(`stamp failed: ${stamp.error.message}`);
    // false: the object was replaced or removed while it was read; nothing is stamped.
    if (stamp.data !== true) return json({ error: "photo_not_uploaded" }, 400);
    return json({ ok: true });
  } catch (error) {
    console.error("[shop-photo-check] error:", error);
    return json({ error: TRY_AGAIN }, 500);
  }
});
