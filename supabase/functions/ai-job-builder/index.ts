import { serve } from "../_shared/buildStamp.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { JOB_DAYS, keepStatedFacts, sanitizeJob } from "./sanitize.ts";
import { fetchWithRetry } from "./retry.ts";
import { claudeFetch, claudeJson } from "../_shared/claudeMessages.ts";

// The job posting's shape (Claude structured output). sanitizeJob still
// whitelists and bounds whatever comes back.
const JOB_POSTING_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Job title, target 24 chars or fewer, hard cap 32" },
    description: { type: "string", description: "Detailed job description" },
    category: {
      type: "string",
      enum: ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "pet_care", "assembly", "storm_prep", "events", "electrical", "plumbing", "hvac", "roofing", "welding", "carpentry", "auto_repair", "appliance_repair", "flooring", "concrete_masonry", "fencing", "pressure_washing", "declutter_help", "other"],
      description: "Best matching job category"
    },
    estimated_hours: { type: "number", description: "Estimated hours to complete" },
    budget_min: { type: "number", description: "Minimum suggested budget in USD" },
    budget_max: { type: "number", description: "Maximum suggested budget in USD" },
    special_requirements: { type: "string", description: "Any special requirements or notes" },
    is_group_job: { type: "boolean", description: "Whether multiple helprs are needed" },
    helpers_needed: { type: "number", description: "Number of helprs needed if group job" },
    preferred_day: { type: "string", enum: [...JOB_DAYS, "none"], description: "The day the person asked for, or none" },
    start_time: { type: "string", description: "The start time the person asked for, 24-hour HH:MM, or empty" },
  },
  required: ["title", "description", "category", "estimated_hours", "budget_min", "budget_max"],
  additionalProperties: false,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Rate limit: 10 requests per minute per IP
  const { allowed, remaining, retryAfter } = await checkRateLimit(req, {
    windowMs: 60_000, maxRequests: 10, keyPrefix: "ai-job-builder",
  });
  if (!allowed) return rateLimitResponse(retryAfter!, corsHeaders);

  // This endpoint spends real money on every call (the AI model). It previously had
  // NO auth check — only the per-IP rate limit — and the publishable key it
  // accepts ships inside the public client bundle, so anyone could pull a full
  // completion billed to us. Verified against prod before this guard:
  // `curl -H "apikey: <publishable>" -d '{"messages":[...]}'` returned a
  // complete job posting. Require a real signed-in user first.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Q837: an unconfirmed-email caller is refused here, as Q807 refuses at
  // the table (that gate cannot see the caller behind a service-role write).
  const unconfirmedEmail = refuseUnconfirmedEmail(authData.user, corsHeaders);
  if (unconfirmedEmail) return unconfirmedEmail;

  try {
    const body = await req.json().catch(() => ({}));
    const { messages, jobContext } = body ?? {};
    // Was `messages is not iterable` — a raw internal error handed to the
    // caller. Validate the shape and answer 400 instead.
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "`messages` must be an array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bound the payload on BOTH axes and validate each item (EF-3, hole hunt
    // 2026-09-15). The rate limit above caps request COUNT, not token SPEND: a
    // single call could previously carry hundreds of KB of `messages` spread
    // straight into the model request, turning this into a general-purpose LLM
    // relay billed to our AI key. `role` was never checked either, so a
    // caller could inject a second `system` turn after ours to steer the model.
    // Cap the item count and total content bytes, require string content, and
    // allow only conversational roles — an item is one turn of THIS form's
    // back-and-forth, so 8 turns and ~8 KB total is generous for the real use.
    const MAX_MESSAGES = 8;
    const MAX_TOTAL_CONTENT_BYTES = 8 * 1024;
    const ALLOWED_ROLES = new Set(["user", "assistant"]);
    if (messages.length > MAX_MESSAGES) {
      return new Response(JSON.stringify({ error: `Too many messages (max ${MAX_MESSAGES})` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let totalContentBytes = 0;
    for (const m of messages) {
      if (
        typeof m !== "object" || m === null ||
        typeof (m as { role?: unknown }).role !== "string" ||
        !ALLOWED_ROLES.has((m as { role: string }).role) ||
        typeof (m as { content?: unknown }).content !== "string"
      ) {
        return new Response(
          JSON.stringify({ error: "Each message must be { role: 'user'|'assistant', content: string }" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      totalContentBytes += new TextEncoder().encode((m as { content: string }).content).length;
    }
    if (totalContentBytes > MAX_TOTAL_CONTENT_BYTES) {
      return new Response(
        JSON.stringify({ error: "Message content too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // jobContext is client input interpolated into OUR system turn (A-002):
    // a plain string, one line, bounded, or nothing.
    const rawLocation = (jobContext as { location?: unknown } | null | undefined)?.location;
    const location = typeof rawLocation === "string"
      ? rawLocation.replace(/[\r\n]+/g, " ").trim().slice(0, 80)
      : "";

    const systemPrompt = `You are Helpr's AI Job Builder. You help users create job postings on Helpr, a local services marketplace.

CANONICAL NOUNS — house style, follow exactly: the person who does the job is
always "Helpr", capitalized, and never any other common noun for that role;
the person who posted the job is "the person who posted this job" — never "customer"
or "client". Use these exact terms in the title, description and any special
requirements text you write.

WRITE IN THE THIRD PERSON. The description is read by the Helprs deciding whether
to take the job, so describe the job itself ("The front and back lawn need mowing…",
"Looking for a Helpr to…"). Never address the person who posted it as "you" and
never write "You need…".

KEEP WHAT THE PERSON SAID. If they name a price, set budget_min and budget_max both
to exactly that number; never raise or lower it. If they name a day, set
preferred_day to it (a weekday, today or tomorrow); if they name a start time, set
start_time to it in 24-hour HH:MM ("Saturday morning around 9" is saturday and
09:00). If they name neither, use "none" and an empty start_time; never invent one.

Given a brief description of what the user needs help with, generate a complete job posting with:
1. A clear, concise title (target 24 chars or fewer — the form's title field hard-caps at exactly 32 and rejects anything longer, so aim well under the cap rather than skimming it)
2. A detailed description (2-3 paragraphs) covering scope, expectations, and any relevant details
3. A recommended category from: cleaning, yard_work, moving, errands, handyman, painting, delivery, pet_care, assembly, storm_prep, events, electrical, plumbing, hvac, roofing, welding, carpentry, auto_repair, appliance_repair, flooring, concrete_masonry, fencing, pressure_washing, declutter_help, other
4. Estimated hours needed
5. A suggested budget range (min and max in USD), or exactly the price they named
6. Any special requirements or notes

${location ? `Additional context: Location is ${location}` : ''}`;
    const CLAUDE_CLOSING = "\n\nAnswer only with the job posting as JSON in the required shape.";

    // Owner 2026-10-22: Claude (Sonnet 5.5) only; Gemini removed.
      // The Messages API refuses: no turns, an empty
      // turn, or a last turn that is not the poster's (review 2026-10-22).
      const turns = messages as Array<{ role: "user" | "assistant"; content: string }>;
      if (turns.length === 0 || turns.some((t) => t.content.trim() === "") || turns[turns.length - 1].role !== "user") {
        return new Response(JSON.stringify({ error: "Describe the job in a message first" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
      if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
      const claudeRes = await fetchWithRetry((signal) => claudeFetch(ANTHROPIC_API_KEY, {
        system: systemPrompt + CLAUDE_CLOSING,
        turns,
        schema: JOB_POSTING_SCHEMA,
      }, signal), { onRetry: (attempt, status) => console.warn(`Claude ${status}; retry ${attempt}`) });
      if (!claudeRes.ok) {
        if (claudeRes.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again in a moment." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const detail = await claudeRes.text();
        console.error("Claude error:", claudeRes.status, detail);
        // An empty credit balance comes back as a 400; answer 402, so it is
        // never mistaken for a broken request.
        if (claudeRes.status === 400 && /credit balance/i.test(detail)) {
          return new Response(JSON.stringify({ error: "AI usage limit reached." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: `AI service error (${claudeRes.status})` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const answer = claudeJson(await claudeRes.json());
      const job = sanitizeJob(answer);
      // A2-C25: the poster's own price, day and time win over the model's (sanitize.ts keepStatedFacts).
      const jobData = job ? keepStatedFacts(job, answer, turns.filter((t) => t.role === "user").map((t) => t.content).join("\n")) : null;
      if (!jobData) {
        return new Response(JSON.stringify({ error: "Failed to generate job posting" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(jobData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
  } catch (e) {
    console.error("ai-job-builder error:", e);
    // Generic client-safe message; detail is logged above (EF-5, 2026-09-15).
    return new Response(JSON.stringify({ error: "Something went wrong generating your job. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
