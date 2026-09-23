/**
 * `complete-signup` ignores the retired ID-document and portfolio uploads (Q40).
 *
 * Users never send an ID to Helpr: Stripe Identity collects it (owner,
 * 2026-09-23). complete-signup used to accept `idBase64` (-> the private
 * id-documents bucket + profiles.id_document_url, a column now dropped) and
 * `portfolioFiles` (-> user-documents + bare storage paths in
 * profiles.portfolio_urls, the only writer of paths there, Q23). No client sent
 * either. A stale or hand-rolled caller that still sends them must store
 * nothing, write neither column, and hand no path back.
 *
 * A DENIED account used to be re-approved by any call carrying `idBase64`;
 * with the ID upload gone, it is refused (403 denied_resubmission) and nothing
 * is written.
 *
 * These execute the real function through the edge harness; the double's
 * bucket is a real key set, so "was anything stored?" is answered by the same
 * upload() the function would make.
 */
//
// Registered mutations - each turns this guard RED on its own:
//   (1) writing the retired column again from the body;
//   (2) storing a portfolio path again;
//   (3) letting a denied account through the resubmission refusal.
// @mutate supabase/functions/complete-signup/index.ts | if (phone) updateData.phone = phone; | if (phone) updateData.phone = phone; if (body.idBase64) updateData.id_document_url = "x";
// @mutate supabase/functions/complete-signup/index.ts | if (phone) updateData.phone = phone; | if (phone) updateData.phone = phone; if (Array.isArray(body.portfolioFiles)) updateData.portfolio_urls = ["u/p.png"];
// @mutate supabase/functions/complete-signup/index.ts | if (isResubmission) { | if (isResubmission && !body.idBase64) {
// @mutate supabase/functions/complete-signup/index.ts | .or("approval_status.is.null,approval_status.neq.denied") | .select("user_id")
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const USER_ID = "22222222-2222-2222-2222-222222222222";
const BYTES = "AAAAAAAA";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("complete-signup");
}

/** A fresh, never-signed-in account inside the 30-minute completion window. */
function seed(approvalStatus: "pending" | "denied") {
  scenario.adminUsers = {
    [USER_ID]: {
      email: "retired-id@test.com",
      email_confirmed_at: null,
      created_at: new Date().toISOString(),
      last_sign_in_at: null,
    } as unknown as { email?: string; email_confirmed_at?: string | null },
  };
  scenario.reads.profiles = {
    rows: [{ bio: null, approval_status: approvalStatus, full_name: "Dana R", location: "Baton Rouge", user_id: USER_ID }],
  };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}

/** Everything the retired path took, and nothing else that uploads. */
const retiredBody = {
  userId: USER_ID,
  location: "Baton Rouge",
  zipCode: "70802",
  parish: "East Baton Rouge",
  phone: "(225) 555-0142",
  ageAttested: true,
  termsAccepted: true,
  idBase64: BYTES,
  idExt: "png",
  idContentType: "image/png",
  portfolioFiles: [{ base64: BYTES, ext: "png", contentType: "image/png" }],
};

describe("complete-signup — the retired ID / portfolio uploads (Q40)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("stores nothing, writes neither column and returns no path", async () => {
    seed("pending");
    const fn = await load();
    const res = await fn.fetch(fn.request({ body: retiredBody }));
    expect(res.status).toBe(200);

    // Nothing was uploaded to any bucket.
    expect([...scenario.storage.objects]).toEqual([]);

    // The approving UPDATE ran (not vacuous) and carries neither column.
    const update = scenario.writes.find((w) => w.table === "profiles" && w.op === "update");
    const payload = update?.payload as Record<string, unknown> | undefined;
    expect(payload?.approval_status).toBe("approved");
    expect(payload).not.toHaveProperty("id_document_url");
    expect(payload).not.toHaveProperty("portfolio_urls");
    // A denial landing mid-request must not be overwritten: not-denied is in
    // the UPDATE's own WHERE, not only in the earlier read.
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "or", value: "approval_status.is.null,approval_status.neq.denied" }),
      ]),
    );

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(json).not.toHaveProperty("idDocumentUrl");
    expect(json).not.toHaveProperty("portfolioUrls");
  });

  it("a DENIED account sending an ID is refused, and nothing is written", async () => {
    // Resubmission is the LOGGED-IN path (the unauthenticated one refuses a
    // denied row earlier, before any of this), so: a JWT, no body userId.
    seed("denied");
    scenario.authUser = { id: USER_ID, email: "retired-id@test.com" };
    const { userId: _drop, ...jwtBody } = retiredBody;
    const fn = await load();
    const res = await fn.fetch(
      fn.request({ body: jwtBody, headers: { Authorization: "Bearer user-jwt" } }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("denied_resubmission");
    expect(scenario.writes.some((w) => w.table === "profiles" && w.op === "update")).toBe(false);
    expect([...scenario.storage.objects]).toEqual([]);
  });
});
