// "Download My Data" (GDPR Art. 15/20, CCPA): everything the account holds,
// as one JSON document (docs/OPEN.md Q290).
//
// Two halves, and why they live here rather than in the browser:
//   1. The rows. `export_my_data()` (SECURITY DEFINER, migration
//      20260925232153) returns the caller's rows from every table with a
//      column that references a person. It is called with the CALLER's JWT,
//      so auth.uid() inside it is the person asking, never a parameter anyone
//      can set. The table list is guarded two-way against the schema by
//      src/test/dataExportCoversEveryUserTable.test.ts.
//   2. The files. The person's stored objects (the identity buckets under
//      `<uid>/`, and the chat attachments on the messages in their export) are
//      handed over as signed links. The identity buckets are listed and signed
//      with the service role under the caller's own <uid>/ prefix; chat
//      attachments (paths read from client-written message rows) are signed
//      with the caller's JWT so message-attachments' read policy applies.
//
// Fail closed: if any table read, any listing or any signature fails, the
// caller gets an error, never a file that silently leaves something out.
import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { listAllObjects } from "../_shared/accountPurge.ts";
import { IDENTITY_BUCKETS } from "../_shared/purgeBuckets.ts";

/** How long each file link in the export works. */
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7;
const MESSAGE_BUCKET = "message-attachments";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** `messages.attachment_url` is a bare object path or a full public/signed URL. */
function attachmentPath(url: string): string | null {
  const marker = `/${MESSAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  const raw = idx >= 0 ? url.slice(idx + marker.length).split("?")[0] : url;
  if (!raw || /^https?:/i.test(raw)) return null;
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // A malformed `%` escape in client-supplied text: use the path as stored.
    path = raw;
  }
  // The row's INSERT policy checked the RAW text; a decoded `..` or `\` is a
  // path it never saw. Refuse those outright. Everything else is signed as the
  // user (below), so message-attachments' read policy has the final say.
  if (/(^|\/)\.\.(\/|$)|\\/.test(path)) return null;
  return path;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rl = await checkRateLimit(req, { windowMs: 600_000, maxRequests: 5, keyPrefix: "export-my-data" });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 600, corsHeaders);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const publishable = (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!;
    const admin = createClient(url, (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!);
    // The caller's own client: every read below runs as them.
    const asUser = createClient(url, publishable, { global: { headers: { Authorization: authHeader } } });

    const { data: { user } } = await asUser.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: exported, error: rpcError } = await asUser.rpc("export_my_data");
    // export_my_data() carries its own per-user limiter (Q408, SQLSTATE P0429)
    // so a direct PostgREST call is capped too. It is a 429, not a failure.
    if (rpcError?.code === "P0429") return rateLimitResponse(600, corsHeaders);
    if (rpcError || !exported || typeof exported !== "object") {
      console.error("[export-my-data] export_my_data failed:", rpcError?.code, rpcError?.message);
      return json({ error: "We couldn't put your data together just now. Try again, or email support." }, 500);
    }

    // What to sign: every object under <uid>/ in the identity buckets, plus the
    // attachments on the messages this export contains.
    const targets: { bucket: string; paths: string[] }[] = [];
    for (const bucket of IDENTITY_BUCKETS) {
      targets.push({ bucket, paths: await listAllObjects(admin, bucket, user.id) });
    }
    const messages = ((exported as { messages?: { attachment_url?: string | null }[] }).messages) ?? [];
    const attachments = new Set<string>();
    for (const m of messages) {
      const p = m.attachment_url ? attachmentPath(m.attachment_url) : null;
      if (p) attachments.add(p);
    }
    targets.push({ bucket: MESSAGE_BUCKET, paths: [...attachments] });

    const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString();
    const storageObjects: { bucket: string; path: string; signed_url: string; expires_at: string }[] = [];
    for (const { bucket, paths } of targets) {
      if (paths.length === 0) continue;
      // Chat attachments are signed AS THE USER, so the bucket's own read policy
      // (job + sender segments, 20260914200051) decides; a legacy or forged
      // attachment_url naming someone else's object gets no link. The identity
      // buckets were listed under the caller's own <uid>/ prefix above, so the
      // service role signs those.
      const signer = bucket === MESSAGE_BUCKET ? asUser : admin;
      const { data, error } = await signer.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_SECONDS);
      if (error || !data) throw new Error(`sign ${bucket}: ${error?.message ?? "no data"}`);
      for (const row of data as { path: string | null; signedUrl: string | null; error: string | null }[]) {
        // A chat attachment whose object is gone, or that the read policy
        // refuses, is not handed over; every other signing failure fails the
        // export.
        if (!row.signedUrl) {
          if (bucket === MESSAGE_BUCKET) continue;
          throw new Error(`sign ${bucket}/${row.path}: ${row.error ?? "no url"}`);
        }
        storageObjects.push({ bucket, path: row.path ?? "", signed_url: row.signedUrl, expires_at: expiresAt });
      }
    }

    return json({
      ...(exported as Record<string, unknown>),
      storage_objects: storageObjects,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[export-my-data] failed:", message);
    return json({ error: "We couldn't put your data together just now. Try again, or email support." }, 500);
  }
});
