/**
 * wish-link-pages (gift lists lane, 2026-11-21): Admin -> Wish list links' "Get shop details". An admin's tap reads up
 * to BATCH waiting pasted links' pages (title, photo, USD price) so the queue shows what each gift is before the admin
 * makes our link. Admin only (has_role, checked here: the button is never the protection).
 *
 * Which rows: wish_link_pages_due (service role only) hands back open link rows not checked yet, one per page key,
 * never an Amazon one and never a test row. Each is read by pageDetails.ts (a fixed list of shops, never Amazon, never a
 * short or affiliate link, the str-ical-sync SSRF gate on every hop, size and time caps) and its outcome is stored by
 * wish_link_page_save (service role only), which also stamps every other unchecked row for the same page.
 * The answer is counts only: nothing about a page that failed (no host or port oracle).
 * Migration: 20261122034304_wish_link_page_details.sql. Tests: src/test/edge/wishLinkPages.test.ts,
 * src/test/pglite/wishLinkPageDetails.pglite.mjs.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { fetchPageDetails } from "./pageDetails.ts";

const BATCH = 8;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))!;
  const serviceKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

  const service = createClient(supabaseUrl, serviceKey);
  const { data: isAdmin, error: roleErr } = await service.rpc("has_role", { _user_id: userRes.user.id, _role: "admin" });
  if (roleErr) {
    // Fail closed, but truthfully: a check that could not run is not "Forbidden".
    console.error("[wish-link-pages] has_role check failed:", roleErr.message);
    return json({ error: "Couldn't verify permissions. Please retry." }, 503);
  }
  if (isAdmin !== true) return json({ error: "Forbidden" }, 403);

  // One more than a run reads, so "more" is known, not guessed (lh-silent-failure review).
  const { data: due, error: dueErr } = await service.rpc("wish_link_pages_due", { p_limit: BATCH + 1 });
  if (dueErr) {
    console.error("[wish-link-pages] wish_link_pages_due failed:", dueErr.message);
    return json({ error: "Couldn't read the waiting links. Please retry." }, 503);
  }
  const all = Array.isArray(due) ? (due as { id?: unknown; url?: unknown }[]) : [];
  const rows = all.slice(0, BATCH);
  const counts = { checked: 0, ok: 0, none: 0, skipped: 0, blocked: 0, failed: 0, unsaved: 0 };
  for (const r of rows) {
    if (typeof r.id !== "string" || typeof r.url !== "string") {
      console.error("[wish-link-pages] a due row had no id or url");
      counts.unsaved++;
      continue;
    }
    const outcome = await fetchPageDetails(r.url);
    const details = outcome.status === "ok" || outcome.status === "none" ? outcome.details : null;
    const { data: saved, error: saveErr } = await service.rpc("wish_link_page_save", {
      p_id: r.id,
      p_status: outcome.status,
      p_title: details?.title ?? null,
      p_image: details?.image ?? null,
      p_price: details?.price ?? null,
    });
    // A save that wrote nothing (the row went away meanwhile) or failed is counted, never reported as checked.
    if (saveErr || typeof saved !== "number" || saved < 1) {
      console.error("[wish-link-pages] wish_link_page_save wrote nothing:", saveErr?.message ?? `answer ${JSON.stringify(saved)}`);
      counts.unsaved++;
      continue;
    }
    counts.checked++;
    counts[outcome.status]++;
  }
  return json({ ...counts, more: all.length > BATCH });
});
