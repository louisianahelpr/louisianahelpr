/**
 * The REAL _shared/rate-limit.ts (the edge harness replaces it with a double): a server-set `subject` is what reaches
 * rate_limit_hit, in place of a token's forgeable `sub`. Added for contact-support's guest limit (10-30).
 *
 * @mutate supabase/functions/_shared/rate-limit.ts |   const subject = options.subject ?? jwtSubject(req); |   const subject = jwtSubject(req);
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "../../../supabase/functions/_shared/rate-limit";

const SUB = "11111111-1111-4111-8111-111111111111";
const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const forged = `${b64url({ alg: "none" })}.${b64url({ sub: SUB, role: "authenticated" })}.x`;

describe("checkRateLimit: a server-set subject", () => {
  let sent: Record<string, unknown>[];

  beforeEach(() => {
    sent = [];
    vi.stubGlobal("Deno", {
      env: { get: (k: string) => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" })[k] },
    });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ allowed: true, remaining: 1, retry_after: 0 }), { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const req = () => new Request("https://x.test", {
    headers: { Authorization: `Bearer ${forged}`, "x-forwarded-for": "9.9.9.9, 1.2.3.4" },
  });
  const opts = { windowMs: 3_600_000, maxRequests: 5, ipMaxRequests: 10, keyPrefix: "b" };

  it("replaces the token's sub, and the platform's IP and both caps still go", async () => {
    await checkRateLimit(req(), { ...opts, subject: "email:abc" });
    expect(sent[0]).toMatchObject({ p_bucket: "b", p_subject: "email:abc", p_ip: "1.2.3.4", p_max: 5, p_ip_max: 10, p_window_seconds: 3600 });
  });

  it("without one, every other caller keeps keying on the token", async () => {
    await checkRateLimit(req(), opts);
    expect(sent[0]).toMatchObject({ p_subject: `u:${SUB}` });
  });
});
