/**
 * declutter-ai-reply — Claude drafts the SELLER's answer to a buyer's public
 * question on a Declutter listing (owner 2026-10-29, builder 26 feature 1:
 * "AI answers buyer questions").
 *
 * Declutter has no chat before a purchase: a buyer asks on the item page
 * (declutter_questions) and the seller answers there in public
 * (declutter_answer_question). This reads the question and its listing
 * (title, description, category, condition, price and up to 4 photos) and asks
 * Claude for a short first-person reply from what the listing shows. The
 * seller sees it as "Suggested reply" and posts or edits it; NOTHING is posted
 * or stored here. Only the answer the seller sends is saved, by
 * declutter_answer_question, as before.
 *
 * Gates, in this order (a refused caller spends nothing on the model):
 *   per-IP 6 a minute; signed in (401); confirmed email (Q837); the
 *   'declutter' switch for the VERIFIED caller (requireFeature); the selling
 *   gates as the caller (declutter_assert_can_draft_from_photos: banned,
 *   3 strikes, under 18); the question is unanswered, not removed, and on an
 *   item whose seller IS the caller (anyone else gets question_not_found,
 *   never told it exists); then 30 an hour per IP.
 *
 * Floor mode (smart offers (c), owner 2026-10-29; builder 33): body
 * { mode: "floor", itemId, priceCents? } suggests the LOWEST price the seller
 * might accept ("Lowest you'll take"), from the price, condition, category and
 * our own sold range (declutter_price_hint, called with the CALLER's token).
 * The same gates; the item must be the caller's own (anyone else gets
 * item_not_found). priceCents is the seller's own typed price on a draft
 * (bounded $1-$100,000); otherwise today's price. Nothing is saved: the seller
 * types or taps the number, and declutter_set_listing_price stores it.
 *
 * The buyer's question and the seller's listing are passed as quoted data,
 * never as instructions (reply.ts). The answer is sanitized (reply.ts:
 * bounded, no contact details) before it reaches the app.
 */
import { serve } from "../_shared/buildStamp.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { requireFeature } from "../_shared/featureSwitch.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { claudeFetch, claudeJson, type ClaudeImage } from "../_shared/claudeMessages.ts";
import { fetchModelWithRetry } from "../declutter-ai-draft/modelRetry.ts";
import { FLOOR_SCHEMA, FLOOR_SYSTEM_PROMPT, REPLY_SCHEMA, REPLY_SYSTEM_PROMPT, floorUserText, replyUserText, sanitizeFloor, sanitizeReply } from "./reply.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPLY_PHOTOS = 4;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
/** Gate codes declutter_assert_can_draft_from_photos raises; anything else is ai_unavailable. */
const MEMBER_GATE_CODES = ["feature_disabled", "account_restricted", "declutter_strikes_blocked", "under_18", "not_authenticated"];

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { allowed, retryAfter } = await checkRateLimit(req, {
    windowMs: 60_000, maxRequests: 6, keyPrefix: "declutter-ai-reply",
  });
  if (!allowed) return rateLimitResponse(retryAfter!, corsHeaders);

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await anon.auth.getUser();
  if (authError || !authData?.user) return json({ error: "not_authenticated" }, 401);
  const unconfirmed = refuseUnconfirmedEmail(authData.user, corsHeaders);
  if (unconfirmed) return unconfirmed;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const refused = await requireFeature(admin, "declutter", authData.user, corsHeaders);
  if (refused) return refused;
  const userId = authData.user.id;

  try {
    // The selling gates, as the caller (the same ones the photo draft uses).
    const { error: gateErr } = await anon.rpc("declutter_assert_can_draft_from_photos");
    if (gateErr) {
      const code = MEMBER_GATE_CODES.find((c) => gateErr.message?.includes(c));
      if (!code) console.error("[declutter-ai-reply] gate failed:", gateErr.message);
      return json({ error: code ?? "ai_unavailable" }, code ? 403 : 500);
    }

    const body = await req.json().catch(() => ({}));
    if (body?.mode === "floor") return await suggestFloor(req, anon, admin, userId, body);
    const questionId = typeof body?.questionId === "string" ? body.questionId : "";
    if (!UUID_RE.test(questionId)) return json({ error: "question_not_found" }, 404);

    const { data: q, error: qErr } = await admin.from("declutter_questions")
      .select("id, item_id, question, answer, removed_at").eq("id", questionId).maybeSingle();
    if (qErr) {
      console.error("[declutter-ai-reply] question read failed:", qErr.message);
      return json({ error: "ai_unavailable" }, 500);
    }
    if (!q || q.removed_at || q.answer) return json({ error: "question_not_found" }, 404);

    // The seller of that item only; a stranger is never told it exists.
    const { data: item, error: itemErr } = await admin.from("declutter_items")
      .select("id, title, description, category, condition_stars, current_price_cents")
      .eq("id", q.item_id).eq("seller_id", userId).maybeSingle();
    if (itemErr) {
      console.error("[declutter-ai-reply] item read failed:", itemErr.message);
      return json({ error: "ai_unavailable" }, 500);
    }
    if (!item) return json({ error: "question_not_found" }, 404);

    // Counted after every gate, so a refused caller spends nothing.
    const hourly = await checkRateLimit(req, { windowMs: 3_600_000, maxRequests: 30, keyPrefix: "declutter-ai-reply-hour" });
    if (!hourly.allowed) return rateLimitResponse(hourly.retryAfter!, corsHeaders);

    const { data: photos, error: photoErr } = await admin.from("declutter_item_photos")
      .select("storage_path").eq("item_id", item.id).order("position").limit(REPLY_PHOTOS);
    if (photoErr) {
      console.error("[declutter-ai-reply] photo read failed:", photoErr.message);
      return json({ error: "ai_unavailable" }, 500);
    }
    // Photos help but are not required: the words alone can answer many questions.
    const images: ClaudeImage[] = [];
    for (const p of photos ?? []) {
      const { data: blob, error: dlErr } = await admin.storage.from("job-photos").download(p.storage_path);
      if (dlErr || !blob) {
        console.warn("[declutter-ai-reply] photo download skipped:", dlErr?.message);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) continue;
      images.push({ mediaType: "image/jpeg", base64: toBase64(bytes) });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const userText = replyUserText(q.question, {
      title: item.title,
      description: item.description ?? "",
      category: item.category ?? null,
      conditionStars: item.condition_stars ?? null,
      priceCents: item.current_price_cents ?? null,
    });
    const callModel = async (): Promise<Response> => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25_000);
      try {
        return await claudeFetch(ANTHROPIC_API_KEY, {
          system: `${REPLY_SYSTEM_PROMPT}\n\nAnswer only with JSON in the required shape.`,
          turns: [{ role: "user", content: userText, images }],
          schema: REPLY_SCHEMA,
          maxTokens: 1024,
        }, ctl.signal);
      } finally {
        clearTimeout(timer);
      }
    };
    const response = await fetchModelWithRetry(callModel, {
      onRetry: (status) => console.warn("[declutter-ai-reply] model busy, retrying once:", status),
    });
    if (!response.ok) {
      console.error("[declutter-ai-reply] model error:", response.status, (await response.text()).slice(0, 300));
      return json({ error: "ai_unavailable" }, response.status === 429 ? 429 : 502);
    }
    const suggestion = sanitizeReply(claudeJson(await response.json()));
    if (!suggestion) return json({ error: "ai_unavailable" }, 502);
    return json({ reply: suggestion.reply, needsSeller: suggestion.needsSeller });
  } catch (e) {
    console.error("[declutter-ai-reply] error:", caughtMessage(e));
    return json({ error: "ai_unavailable" }, 500);
  }
});

// createClient(url, key) with no Database type is SupabaseClient<any> (as charge-recurring-visits' AdminClient).
// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any>;

/** Floor mode: Claude's "Lowest you'll take" for the caller's own item. Gates already passed (signed in, email, switch, selling gates). */
async function suggestFloor(req: Request, anon: Db, admin: Db, userId: string, body: Record<string, unknown>): Promise<Response> {
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!UUID_RE.test(itemId)) return json({ error: "item_not_found" }, 404);
  const { data: item, error: itemErr } = await admin.from("declutter_items")
    .select("id, title, category, condition_stars, current_price_cents, area_lat, area_lng")
    .eq("id", itemId).eq("seller_id", userId).maybeSingle();
  if (itemErr) {
    console.error("[declutter-ai-reply] floor item read failed:", itemErr.message);
    return json({ error: "ai_unavailable" }, 500);
  }
  if (!item) return json({ error: "item_not_found" }, 404);
  const typed = typeof body.priceCents === "number" && Number.isInteger(body.priceCents) && body.priceCents >= 100 && body.priceCents <= 10_000_000
    ? body.priceCents : null;
  const priceCents = typed ?? (item.current_price_cents as number | null) ?? 0;
  if (priceCents < 200) return json({ error: "price_too_low" }, 422);

  const hourly = await checkRateLimit(req, { windowMs: 3_600_000, maxRequests: 30, keyPrefix: "declutter-ai-floor-hour" });
  if (!hourly.allowed) return rateLimitResponse(hourly.retryAfter!, corsHeaders);

  // Our own sold range, as the caller (its own switch and sign-in gates). No range is fine: the model works from the listing.
  let soldLowCents: number | null = null;
  let soldHighCents: number | null = null;
  if (item.category && item.condition_stars && item.area_lat != null && item.area_lng != null) {
    const { data: hint, error: hintErr } = await anon.rpc("declutter_price_hint", {
      p_category: item.category, p_condition_stars: item.condition_stars, p_lat: item.area_lat, p_lng: item.area_lng,
    });
    if (hintErr) console.warn("[declutter-ai-reply] price hint skipped:", hintErr.message);
    const row = Array.isArray(hint) ? hint[0] : null;
    if (row && Number.isInteger(row.low_cents) && Number.isInteger(row.high_cents)) {
      soldLowCents = row.low_cents;
      soldHighCents = row.high_cents;
    }
  }

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  const userText = floorUserText({
    title: item.title as string, category: (item.category as string | null) ?? null,
    conditionStars: (item.condition_stars as number | null) ?? null, priceCents, soldLowCents, soldHighCents,
  });
  const callModel = async (): Promise<Response> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000);
    try {
      return await claudeFetch(ANTHROPIC_API_KEY, {
        system: `${FLOOR_SYSTEM_PROMPT}\n\nAnswer only with JSON in the required shape.`,
        turns: [{ role: "user", content: userText, images: [] }],
        schema: FLOOR_SCHEMA,
        maxTokens: 512,
      }, ctl.signal);
    } finally {
      clearTimeout(timer);
    }
  };
  const response = await fetchModelWithRetry(callModel, {
    onRetry: (status) => console.warn("[declutter-ai-reply] floor: model busy, retrying once:", status),
  });
  if (!response.ok) {
    console.error("[declutter-ai-reply] floor model error:", response.status, (await response.text()).slice(0, 300));
    return json({ error: "ai_unavailable" }, response.status === 429 ? 429 : 502);
  }
  const floor = sanitizeFloor(claudeJson(await response.json()), priceCents);
  if (!floor) return json({ error: "ai_unavailable" }, 502);
  return json({ floorCents: floor.floorCents, reason: floor.reason });
}
