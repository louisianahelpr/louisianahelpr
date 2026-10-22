/**
 * Claude (Anthropic Messages API) for the app's AI drafting (owner 2026-10-22:
 * "I'd rather just use Claude", model Sonnet 5.5; replaces Gemini, whose key
 * ...XsOQ is on Google's free tier, where Google may use what we send it).
 *
 * Raw HTTP on purpose: the edge harness (src/test/edge/harness.ts) loads these
 * functions with `fetch` stubbed, and every model call goes through the
 * callers' own fetchWithRetry (500/502/503 retried, nothing else). The
 * request asks for a JSON answer that matches `schema` (structured outputs),
 * so no tool call is needed; forced tool_choice is refused by this model.
 *
 * Used by ai-job-builder and declutter-ai-draft; Gemini is gone (owner
 * 2026-10-22: "just get rid of the Gemini one entirely").
 */

const CLAUDE_MODEL = "claude-sonnet-5-5";
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";

export type ClaudeImage = { mediaType: string; base64: string };
type ClaudeTurn = { role: "user" | "assistant"; content: string; images?: ClaudeImage[] };

/** One Messages API request; the caller wraps it in its retry. */
export function claudeFetch(
  apiKey: string,
  opts: { system: string; turns: ClaudeTurn[]; schema: Record<string, unknown>; maxTokens?: number },
  signal: AbortSignal,
): Promise<Response> {
  const messages = opts.turns.map((t) => ({
    role: t.role,
    content: [
      ...(t.images ?? []).map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      })),
      { type: "text", text: t.content },
    ],
  }));
  return fetch(CLAUDE_URL, {
    signal,
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages,
      // Short drafting: low effort keeps it quick and cheap.
      output_config: { effort: "low", format: { type: "json_schema", schema: opts.schema } },
    }),
  });
}

/**
 * The JSON answer, or null when there is none to use: a refusal, a cut-off
 * answer (max_tokens) or text that is not JSON. Never throws.
 */
export function claudeJson(data: unknown): unknown | null {
  const d = data as { stop_reason?: string; content?: Array<{ type?: string; text?: string }> } | null;
  if (!d || d.stop_reason === "refusal" || d.stop_reason === "max_tokens") return null;
  const text = d.content?.find((b) => b?.type === "text")?.text;
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
