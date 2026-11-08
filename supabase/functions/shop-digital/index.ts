/**
 * shop-digital — the files of a Shops DIGITAL DOWNLOAD (owner 11-08: the owner sells coloring books as PDFs;
 * migration 20261108182917_shops_digital_downloads). The files sit in the PRIVATE bucket 'shop-digital', which has
 * no storage policy a member can use (every bucket-less prod policy is RESTRICTIVE, read 2026-11-08), so only this
 * function, with the service role, ever signs a link into it.
 *
 *   upload_url { item_id, file_name, byte_size }  THE SELLER. shops_digital_file_begin runs AS THE SELLER (owner,
 *              Shops switch, ID check, ban and the 5-file cap are SQL's), then a one-time signed UPLOAD link for the
 *              path SQL chose (<owner>/<item>/<file id>.<ext>). Nothing the seller typed is in the path.
 *   confirm    { file_id }  THE SELLER, after the upload. Reads the stored object's size and its first bytes; a PDF,
 *              ZIP, PNG or JPG whose bytes match its extension (a ZIP also: no program or script inside, and a
 *              readable directory) is marked checked; anything else is deleted and refused. The size the browser
 *              claimed is never trusted: the stored size is what is recorded (at most 100 MB).
 *   remove     { file_id }  THE SELLER. The row (a live item keeps its last file) and then the object.
 *   download   { file_id }  THE SELLER or A BUYER whose order for the item is complete and not refunded
 *              (shop_digital_download_path decides). A fresh 10-minute signed link, minted per tap, saved under the
 *              file's own name. Access never expires while the account exists; a refund ends it.
 *
 * Who the caller is comes from the token (auth.getUser), never from the request body.
 * Not here yet (handoff ~/.lh-shots/handoffs-1108/builder4-digital.md): checkout, the 72-hour payout, emails.
 */
import { serve } from "../_shared/buildStamp.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";
import {
  bytesMatchExt,
  cleanDownloadName,
  DIGITAL_MAX_BYTES,
  digitalExtFromName,
  findZipDirectory,
  SNIFF_BYTES,
  ZIP_DIRECTORY_MAX_BYTES,
  zipProgramEntry,
  type DigitalExt,
} from "../_shared/digitalFileCheck.ts";

const BUCKET = "shop-digital";
/** The lead's default: a download link lives about 10 minutes and is minted per tap. */
const DOWNLOAD_LINK_SECONDS = 600;
/** The EOCD record is 22 bytes plus a comment of at most 65,535. */
const ZIP_TAIL_BYTES = 65_557;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRY_AGAIN = "Something went wrong. Please try again.";

function rpcRefusal(error: { message?: string; code?: string; hint?: string }): Response {
  const status = error.code === "P0002" || error.code === "PT404" ? 404 : error.code === "42501" ? 403 : error.code === "22023" || error.code === "23514" ? 400 : 409;
  return json({ error: error.message ?? "refused", hint: error.hint ?? null }, status);
}

async function uploadUrl(body: Record<string, unknown>, userId: string, asMember: SupabaseClient, admin: SupabaseClient): Promise<Response> {
  const itemId = String(body.item_id ?? "");
  const fileName = String(body.file_name ?? "");
  const size = Number(body.byte_size);
  if (!UUID_RE.test(itemId)) return json({ error: "item_not_found" }, 404);
  const ext = digitalExtFromName(fileName);
  if (!ext) return json({ error: "file_type_not_allowed", hint: "Upload a PDF, ZIP, PNG or JPG file." }, 400);
  if (!Number.isInteger(size) || size < 1 || size > DIGITAL_MAX_BYTES) {
    return json({ error: "file_too_big", hint: "Each file can be up to 100 MB." }, 400);
  }
  const { data, error } = await asMember.rpc("shops_digital_file_begin", {
    p_item_id: itemId, p_file_name: cleanDownloadName(fileName, ext), p_ext: ext, p_byte_size: size,
  });
  if (error) return rpcRefusal(error);
  const begun = data as { file_id?: string; storage_path?: string } | null;
  if (!begun?.file_id || !begun.storage_path) return json({ error: TRY_AGAIN }, 500);
  const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(begun.storage_path);
  if (signed.error || !signed.data?.token) {
    // The waiting row would block the listing; take it back so the seller can try again.
    const back = await admin.rpc("shop_digital_file_remove", { p_file_id: begun.file_id, p_owner: userId });
    if (back.error) console.error("[shop-digital] waiting row not taken back:", back.error.message);
    console.error("[shop-digital] signed upload link failed:", signed.error?.message);
    return json({ error: TRY_AGAIN }, 500);
  }
  return json({ file_id: begun.file_id, path: signed.data.path, token: signed.data.token });
}

/** Bytes [start, end] of a stored object, through a 60-second signed link (Range request). */
async function readRange(admin: SupabaseClient, path: string, range: string): Promise<Uint8Array | null> {
  const link = await admin.storage.from(BUCKET).createSignedUrl(path, 60);
  if (link.error || !link.data?.signedUrl) return null;
  const res = await fetch(link.data.signedUrl, { headers: { Range: range } });
  if (res.status !== 206 && res.status !== 200) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf;
}

/** Why a stored file is refused, or null when it is fine. */
async function refusalFor(admin: SupabaseClient, path: string, ext: DigitalExt, size: number): Promise<string | null> {
  const head = await readRange(admin, path, `bytes=0-${SNIFF_BYTES - 1}`);
  if (!head) return "file_unreadable";
  if (!bytesMatchExt(ext, head.subarray(0, SNIFF_BYTES))) return "file_does_not_match_type";
  if (ext !== "zip") return null;
  const tailLen = Math.min(size, ZIP_TAIL_BYTES);
  const tail = await readRange(admin, path, `bytes=${size - tailLen}-${size - 1}`);
  if (!tail || tail.length !== tailLen) return "file_unreadable";
  const dir = findZipDirectory(tail, size);
  if (!dir || dir.cdSize > ZIP_DIRECTORY_MAX_BYTES) return "zip_unreadable";
  if (dir.entries === 0) return "zip_empty";
  const cd = await readRange(admin, path, `bytes=${dir.cdOffset}-${dir.cdOffset + dir.cdSize - 1}`);
  if (!cd || cd.length !== dir.cdSize) return "zip_unreadable";
  const bad = zipProgramEntry(cd, dir.entries);
  if (bad === "unreadable") return "zip_unreadable";
  if (bad) return "zip_has_program";
  return null;
}

const REFUSAL_HINT: Record<string, string> = {
  file_unreadable: "We could not read that file. Please upload it again.",
  file_does_not_match_type: "That file is not really the type its name says. Upload a real PDF, ZIP, PNG or JPG.",
  zip_unreadable: "We could not read that ZIP file. Please make it again and upload it.",
  zip_empty: "That ZIP file is empty.",
  zip_has_program: "That ZIP file has a program or script inside. Shops downloads can't include programs.",
  file_too_big: "Each file can be up to 100 MB.",
};

async function confirm(body: Record<string, unknown>, userId: string, admin: SupabaseClient): Promise<Response> {
  const fileId = String(body.file_id ?? "");
  if (!UUID_RE.test(fileId)) return json({ error: "file_not_found" }, 404);
  const { data: row, error } = await admin.from("shop_item_files")
    .select("id, storage_path, ext, checked_at").eq("id", fileId).eq("owner_id", userId).maybeSingle();
  if (error) throw new Error(`file read failed: ${error.message}`);
  if (!row) return json({ error: "file_not_found" }, 404);
  if (row.checked_at) return json({ ok: true, already: true });
  const folder = row.storage_path.split("/").slice(0, 2).join("/");
  const leaf = row.storage_path.split("/")[2];
  const listed = await admin.storage.from(BUCKET).list(folder, { search: leaf, limit: 2 });
  if (listed.error) throw new Error(`storage list failed: ${listed.error.message}`);
  const obj = (listed.data ?? []).find((o) => o.name === leaf);
  if (!obj) return json({ error: "upload_missing", hint: "The upload did not finish. Please try again." }, 409);
  const size = Number((obj.metadata as { size?: number } | null)?.size);
  let refusal: string | null = null;
  if (!Number.isInteger(size) || size < 1 || size > DIGITAL_MAX_BYTES) refusal = "file_too_big";
  else refusal = await refusalFor(admin, row.storage_path, row.ext as DigitalExt, size);
  if (refusal) {
    const removed = await admin.rpc("shop_digital_file_remove", { p_file_id: fileId, p_owner: userId });
    if (removed.error) console.error("[shop-digital] refused file row not removed:", removed.error.message);
    const gone = await admin.storage.from(BUCKET).remove([row.storage_path]);
    if (gone.error) console.error("[shop-digital] refused file object not removed:", gone.error.message);
    return json({ error: refusal, hint: REFUSAL_HINT[refusal] ?? null }, 400);
  }
  const checked = await admin.rpc("shop_digital_file_checked", { p_file_id: fileId, p_owner: userId, p_byte_size: size });
  if (checked.error) return rpcRefusal(checked.error);
  return json({ ok: true, byte_size: size });
}

async function remove(body: Record<string, unknown>, userId: string, admin: SupabaseClient): Promise<Response> {
  const fileId = String(body.file_id ?? "");
  if (!UUID_RE.test(fileId)) return json({ error: "file_not_found" }, 404);
  const { data: path, error } = await admin.rpc("shop_digital_file_remove", { p_file_id: fileId, p_owner: userId });
  if (error) return rpcRefusal(error);
  if (typeof path === "string") {
    const gone = await admin.storage.from(BUCKET).remove([path]);
    // The row is gone, so nobody can download it; a left-over object is only storage. Logged for the sweep.
    if (gone.error) console.error(JSON.stringify({ event: "shop_digital_orphan_object", path, detail: gone.error.message }));
  }
  return json({ ok: true });
}

async function download(body: Record<string, unknown>, userId: string, admin: SupabaseClient): Promise<Response> {
  const fileId = String(body.file_id ?? "");
  if (!UUID_RE.test(fileId)) return json({ error: "file_not_found" }, 404);
  const { data, error } = await admin.rpc("shop_digital_download_path", { p_file_id: fileId, p_user: userId });
  if (error) throw new Error(`download check failed: ${error.message}`);
  const found = data as { storage_path?: string; file_name?: string } | null;
  // One answer for "no such file" and "not yours": nothing says a file exists to someone who did not buy it.
  if (!found?.storage_path) return json({ error: "file_not_found" }, 404);
  const link = await admin.storage.from(BUCKET).createSignedUrl(found.storage_path, DOWNLOAD_LINK_SECONDS, {
    download: found.file_name ?? true,
  });
  if (link.error || !link.data?.signedUrl) throw new Error(`download link failed: ${link.error?.message}`);
  return json({ url: link.data.signedUrl, expires_in: DOWNLOAD_LINK_SECONDS });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 30, keyPrefix: "shop-digital" });
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
    if (body.action === "upload_url") return await uploadUrl(body, user.id, asMember, admin);
    if (body.action === "confirm") return await confirm(body, user.id, admin);
    if (body.action === "remove") return await remove(body, user.id, admin);
    if (body.action === "download") return await download(body, user.id, admin);
    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    console.error("[shop-digital] error:", error);
    return json({ error: TRY_AGAIN }, 500);
  }
});
