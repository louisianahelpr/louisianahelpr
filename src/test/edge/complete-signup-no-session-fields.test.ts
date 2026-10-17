/**
 * Q?signup-no-session: complete-signup's NO-SESSION path reads ONLY the fields the sign-up
 * form sends there, and runs only once. This is the class guard for every field.
 *
 * THE DEFECT (lh-authz-rls reviews of the Q1804 fix, 2026-10-17). complete-signup
 * accepts a call with no JWT when the body names a `userId` that is under 30
 * minutes old, has never signed in and has an empty bio. That is how the
 * sign-up form finishes an account: auth.signUp returns no session while email
 * confirmation is on. The body was trusted for everything on that path. A
 * stranger who learned a brand-new account's id could set its birthday (Q1804)
 * or phone (the Q1804 follow-up), upload licence/insurance files that set the credential
 * statuses to pending, set skills and emergency contacts, and, for the 30
 * minutes, overwrite the public photo, bio, marketing opt-in (plus a
 * legal_acceptances row with the stranger's IP) and referral.
 *
 * THE FIX, in two parts:
 *   (a) DEFAULT-DENY. Without a valid sign-in the body is cut down to
 *       NO_SESSION_FIELDS (an in-code allowlist, each entry with its reason)
 *       before anything reads it. Any other field, including one added later,
 *       is read only from a signed-in member.
 *   (b) ONE-SHOT. A no-session completion is refused once terms_accepted_at is
 *       set. Every completion that reaches the profile UPDATE sets it, and
 *       handle_new_user leaves it NULL (prod, read-only pg_get_functiondef and
 *       information_schema, 2026-10-17). The form's own call goes out right
 *       after signUp, so a stranger holding only the id meets that refusal.
 *
 * WHY THE ALLOWLIST IS NOT EMPTY. Signup.tsx is the only caller, on main and in
 * iOS build 7119's tree c16b0f0dc (review freeze). Both send the same twelve
 * fields on this path (IOS_7119_BODY_KEYS below, read from `git show
 * c16b0f0dc:src/pages/auth/Signup.tsx`). Gating them would drop every new
 * member's sign-up photo, bio and marketing opt-in, and would stop referrals,
 * which this function is the only place able to record (lead approved, 2026-10-17).
 *
 * The inventory is the function's own destructure of the body. A field added
 * there without a value in FIELD_VALUES fails here first, so nobody can add one
 * without deciding where it belongs. The allowlist is checked against
 * Signup.tsx's body in both directions: a field the form starts sending that
 * is not allowlisted would be silently dropped, and an allowlisted field the
 * form never sends is one a stranger could set.
 *
 * Registered mutations: each of these reopens part of the class.
 * @mutate supabase/functions/complete-signup/index.ts | const body = signedIn ? rawBody : noSessionBody(rawBody); | const body = rawBody;
 * @mutate supabase/functions/complete-signup/index.ts | const NO_SESSION_FIELDS: Readonly<Record<string, string>> = { | const NO_SESSION_FIELDS: Readonly<Record<string, string>> = { licenseBase64: "mutant", licenseExt: "mutant", licenseContentType: "mutant", isLicensed: "mutant",
 * @mutate supabase/functions/complete-signup/index.ts |         existingProfile.terms_accepted_at\n | false\n
 * @mutate supabase/functions/complete-signup/index.ts |   referralCode: "?ref= from a share link; this function is the only place a referral can be recorded",\n | \n
 * @mutate supabase/functions/complete-signup/index.ts |         .is("terms_accepted_at", null)\n | \n
 * @mutate supabase/functions/complete-signup/index.ts | if (claim.release && !res?.ok) await claim.release(); | if (false) await claim.release?.();
 * @mutate supabase/functions/complete-signup/index.ts |           .eq("terms_accepted_at", claimAt)\n | \n
 * @mutate supabase/functions/complete-signup/index.ts | const body = signedIn ? rawBody : noSessionBody(rawBody); | const body = authHeader ? rawBody : noSessionBody(rawBody);
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { blankComments } from "../helpers/blankNonCode";
import { completeSignupErrorCopy, isSignupAlreadyFinished } from "@/pages/auth/signup/completeSignupError";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { claimUpdates, completionUpdate, completionUpdateFails, liveProfileRow, releaseUpdates } from "./mocks/completeSignupWrites";
import { resetSharedMocks } from "./mocks/shared";
import { stubSignupCapRead } from "./mocks/signupCapFetch";

const ROOT = resolve(__dirname, "../../..");
const FN_SRC = blankComments(readFileSync(resolve(ROOT, "supabase/functions/complete-signup/index.ts"), "utf8"));
const SIGNUP_SRC = blankComments(readFileSync(resolve(ROOT, "src/pages/auth/Signup.tsx"), "utf8"));

/**
 * Body keys iOS build 7119 (tree c16b0f0dc, with Apple; REVIEW FREEZE) sends to
 * complete-signup. A dated record (measured 2026-10-17), not an inventory: that
 * build cannot change, so this list does not either.
 */
const IOS_7119_BODY_KEYS = [
  "userId", "avatarBase64", "avatarExt", "avatarContentType", "bio", "location", "zipCode", "parish",
  "marketingConsent", "ageAttested", "termsAccepted", "referralCode",
];

/** The text between the brace at `open` and its partner. */
function braceBody(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

/** Top-level keys of an object literal / destructure body (`a,` `b: c,` `d: e.f(),`). */
function topLevelKeys(objectBody: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null; // inside a string literal: commas and brackets there are text
  for (const ch of objectBody) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    if ("{([".includes(ch)) depth++;
    if ("})]".includes(ch)) depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts
    .map((p) => /^\s*([A-Za-z_$][\w$]*)/.exec(p)?.[1])
    .filter((k): k is string => !!k);
}

/** Every field complete-signup destructures from the request body. */
function destructuredBodyFields(): string[] {
  const m = /const\s*\{([^}]*)\}\s*=\s*body\s*;/.exec(FN_SRC);
  if (!m) throw new Error("complete-signup's body destructure not found");
  return topLevelKeys(m[1]);
}

/** The keys of the function's NO_SESSION_FIELDS allowlist. */
function noSessionFields(): string[] {
  const at = FN_SRC.indexOf("const NO_SESSION_FIELDS");
  if (at < 0) throw new Error("NO_SESSION_FIELDS not found");
  return topLevelKeys(braceBody(FN_SRC, FN_SRC.indexOf("{", FN_SRC.indexOf("=", at))));
}

/** The keys Signup.tsx puts in its complete-signup body. */
function signupBodyKeys(): string[] {
  const call = SIGNUP_SRC.indexOf('functions.invoke("complete-signup"');
  if (call < 0) throw new Error("Signup.tsx's complete-signup call not found");
  const bodyAt = SIGNUP_SRC.indexOf("body:", call);
  return topLevelKeys(braceBody(SIGNUP_SRC, SIGNUP_SRC.indexOf("{", bodyAt)));
}

const USER_ID = "18831883-0002-4883-8883-188318831883";
const BYTES = "AAAAAAAA";

/**
 * A value for EVERY field the function destructures, each one able to have an
 * effect (so the signed-in run below proves the value is live, not ignored).
 * A new destructured field fails the coverage test until it is given one.
 */
const FIELD_VALUES: Record<string, unknown> = {
  userId: USER_ID,
  avatarBase64: BYTES,
  avatarExt: "png",
  avatarContentType: "image/png",
  licenseBase64: BYTES,
  licenseExt: "pdf",
  licenseContentType: "application/pdf",
  isLicensed: true,
  insuranceBase64: BYTES,
  insuranceExt: "pdf",
  insuranceContentType: "application/pdf",
  isInsured: true,
  phone: "+15045550123",
  bio: "I fix fences.",
  location: "Baton Rouge",
  zipCode: "70802",
  parish: "East Baton Rouge",
  skills: ["fencing"],
  dateOfBirth: "1990-01-01",
  availability: "weekends",
  transportation: "truck",
  hearAboutUs: "friend",
  experienceLevel: "expert",
  toolsEquipment: "all",
  emergencyContactName: "Sam R",
  emergencyContactPhone: "+12255550100",
  extraComments: "hello",
  marketingConsent: true,
  ageAttested: true,
  termsAccepted: true,
  referralCode: "ABC123",
};

/** Profile columns the allowlisted fields (and the consent stamps) write. */
const NO_SESSION_COLUMNS = [
  "accepted_terms_at", "avatar_url", "bio", "location", "marketing_consent", "parish",
  "terms_accepted_at", "terms_version_accepted", "zip_code",
];
/** Columns only the session-only fields write: the signed-in run must reach every one. */
const SESSION_ONLY_COLUMNS = [
  "availability", "date_of_birth", "emergency_contact_name", "emergency_contact_phone", "experience_level",
  "extra_comments", "hear_about_us", "insurance_status", "insurance_url", "is_insured", "is_licensed",
  "license_status", "license_url", "phone", "skills", "tools_equipment", "transportation",
];
/** The only RPCs a no-session call may make: no ban, flag or age routine. */
const NO_SESSION_RPCS = new Set(["get_parish_for_zip", "record_referral_signup", "notify_admins_new_member"]);

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("complete-signup");
}

/** A fresh account inside the 30-minute window, never signed in, empty profile. */
function seedFreshSignup(profile: Record<string, unknown> = {}) {
  scenario.adminUsers = {
    [USER_ID]: {
      email: "new@test.com",
      email_confirmed_at: null,
      created_at: new Date().toISOString(),
      last_sign_in_at: null,
    } as unknown as { email?: string; email_confirmed_at?: string | null },
  };
  scenario.reads.profiles = {
    rows: [{ bio: null, date_of_birth: null, terms_accepted_at: null, full_name: "Dana R", user_id: USER_ID, ...profile }],
  };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
  scenario.rpc.enforce_retained_ban = { banned: false };
  scenario.rpc.record_referral_signup = true;
}

function profileUpdate(): Record<string, unknown> | undefined {
  // The completion, not the no-session claim before it (Q?signup-one-shot-atomic).
  const w = completionUpdate();
  return w?.payload as Record<string, unknown> | undefined;
}

const rpcNames = () => (scenario.rpcCalls ?? []).map((c) => c.name);

describe("Q?signup-no-session: complete-signup's no-session path reads only what the sign-up form sends (class guard)", () => {
  let capRead: MockInstance<typeof fetch>;
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    capRead = stubSignupCapRead();
  });
  afterEach(() => capRead.mockRestore());

  describe("the inventory (source)", () => {
    it("finds the function's body fields, its allowlist and the form's body (a scan that finds none checks nothing)", () => {
      expect(destructuredBodyFields().length).toBeGreaterThan(25);
      expect(noSessionFields().length).toBeGreaterThan(8);
      expect(signupBodyKeys().length).toBeGreaterThan(8);
    });

    it("every field the function reads from the body has a test value here (classify a new field first)", () => {
      expect(destructuredBodyFields().sort()).toEqual(Object.keys(FIELD_VALUES).sort());
    });

    it("every allowlisted field is one the function actually reads (no stale entry)", () => {
      const read = new Set(destructuredBodyFields());
      for (const k of noSessionFields()) expect(read.has(k), k).toBe(true);
    });

    it("every allowlist entry gives its reason", () => {
      const at = FN_SRC.indexOf("const NO_SESSION_FIELDS");
      const entries = braceBody(FN_SRC, FN_SRC.indexOf("{", FN_SRC.indexOf("=", at)));
      for (const k of noSessionFields()) {
        expect(new RegExp(`\\b${k}\\s*:\\s*"[^"]{10,}"`).test(entries), `${k} needs a reason string`).toBe(true);
      }
    });

    it("the allowlist is exactly what Signup.tsx sends (two-way), and covers iOS 7119's body", () => {
      expect(noSessionFields().sort()).toEqual(signupBodyKeys().sort());
      for (const k of IOS_7119_BODY_KEYS) expect(noSessionFields(), `7119 sends ${k}`).toContain(k);
    });

    it("the raw body is read in one place only: the signed-in/no-session split, made before the no-session fallback", () => {
      expect((FN_SRC.match(/\brawBody\b/g) ?? []).length).toBe(3); // declared, then `signedIn ? rawBody : noSessionBody(rawBody)`
      expect(FN_SRC).toContain("const body = signedIn ? rawBody : noSessionBody(rawBody);");
      const split = FN_SRC.indexOf("const signedIn = userId !== null;");
      const fallback = FN_SRC.indexOf("userId = bodyUserId;");
      expect(split).toBeGreaterThan(0);
      expect(split, "the split must come before userId takes the body's id").toBeLessThan(fallback);
      expect(FN_SRC.indexOf("const body = signedIn")).toBeLessThan(FN_SRC.search(/const\s*\{[^}]*\}\s*=\s*body\s*;/));
    });
  });

  describe("the behaviour (the real function)", () => {
    it("a no-session call carrying EVERY field writes only the allowlisted ones and runs no ban, flag or age routine", async () => {
      seedFreshSignup();
      const fn = await load();
      const res = await fn.fetch(fn.request({ body: FIELD_VALUES }));
      expect(res.status).toBe(200);
      expect(Object.keys(profileUpdate() ?? {}).sort()).toEqual(NO_SESSION_COLUMNS);
      // Only the photo reached storage: no licence or insurance object.
      const objects = [...scenario.storage.objects];
      expect(objects.length).toBe(1);
      expect(objects[0].startsWith(`${USER_ID}/avatar.`)).toBe(true);
      for (const name of rpcNames()) expect(NO_SESSION_RPCS.has(name), `no-session call ran ${name}`).toBe(true);
      expect(rpcNames()).not.toContain("enforce_retained_ban");
      // The form's own data still lands: the referral is recorded.
      expect(rpcNames()).toContain("record_referral_signup");
    });

    it("a signed-in call with the same body takes every session-only field (the values above are live)", async () => {
      seedFreshSignup();
      scenario.authUser = { id: USER_ID, email: "new@test.com" };
      const fn = await load();
      const res = await fn.fetch(fn.request({ body: FIELD_VALUES, headers: { Authorization: "Bearer user-jwt" } }));
      expect(res.status).toBe(200);
      const cols = Object.keys(profileUpdate() ?? {});
      for (const c of [...NO_SESSION_COLUMNS, ...SESSION_ONLY_COLUMNS]) expect(cols, c).toContain(c);
      expect(rpcNames()).toContain("enforce_retained_ban");
      expect([...scenario.storage.objects].some((o) => o.includes("/credentials/license-"))).toBe(true);
    });

    it("one-shot: once a no-session completion is recorded, a second no-session call changes nothing", async () => {
      seedFreshSignup({ terms_accepted_at: "2026-10-17T08:00:00Z" });
      const fn = await load();
      const res = await fn.fetch(fn.request({ body: { ...FIELD_VALUES, bio: "", avatarBase64: BYTES } }));
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error?: string }).error).toBe("Profile already completed. Please log in.");
      expect(profileUpdate()).toBeUndefined();
      // No second consent record either (a re-sent call used to add a duplicate legal_acceptances row).
      expect(scenario.writes.filter((w) => w.table === "legal_acceptances")).toEqual([]);
      expect([...scenario.storage.objects]).toEqual([]);
      expect(rpcNames()).not.toContain("record_referral_signup");
    });

    it("Q1810 retry, first send never reached the server: the re-send completes (terms_accepted_at still NULL)", async () => {
      seedFreshSignup();
      const fn = await load();
      const res = await fn.fetch(fn.request({ body: FIELD_VALUES }));
      expect(res.status).toBe(200);
      // ...and that completion is what sets the one-shot marker.
      expect(profileUpdate()?.terms_accepted_at).toBeTruthy();
      // The double does record the consent row (so the one-shot case's "none" is not vacuous).
      expect(scenario.writes.filter((w) => w.table === "legal_acceptances")).toHaveLength(1);
    });

    it("Q1810 retry, first send succeeded but its answer was lost: the re-send is 'already finished', not an error", async () => {
      seedFreshSignup({ terms_accepted_at: "2026-10-17T08:00:00Z", bio: null });
      const fn = await load();
      const res = await fn.fetch(fn.request({ body: FIELD_VALUES }));
      expect(res.status).toBe(403);
      // The exact path Signup.tsx takes: FunctionsHttpError -> completeSignupErrorCopy -> isSignupAlreadyFinished.
      const copy = await completeSignupErrorCopy(new FunctionsHttpError(res));
      expect(isSignupAlreadyFinished(new Error(copy)), copy).toBe(true);
    });
  });

  describe("Q?signup-one-shot-atomic: the one-shot rule holds under a race (lh-authz-rls review of a02d0cd80, #1 and #3)", () => {
    /** The live row (see liveProfileRow): reads see writes, an UPDATE lands only when its WHERE matches. */
    function liveFreshSignup() {
      seedFreshSignup();
      return liveProfileRow({ bio: null, date_of_birth: null, terms_accepted_at: null, full_name: "Dana R", user_id: USER_ID });
    }

    /** Every storage upload, in order (the Set alone cannot show a second upload to the same key). */
    function recordUploads(): string[] {
      const uploads: string[] = [];
      const objects = scenario.storage.objects;
      const add = objects.add.bind(objects);
      objects.add = (key: string) => { uploads.push(key); return add(key); };
      return uploads;
    }

    it("two overlapping no-session calls that BOTH pass the read: exactly one completes, the other is 'already finished'", async () => {
      const row = liveFreshSignup();
      const uploads = recordUploads();
      const fn = await load();
      // A Q1810 re-send arriving while the first send still runs, or a racing
      // stranger holding the id: same account, overlapping in time.
      const settled = await Promise.allSettled([
        fn.fetch(fn.request({ body: { ...FIELD_VALUES, bio: "first" } })),
        fn.fetch(fn.request({ body: { ...FIELD_VALUES, bio: "second", avatarContentType: "image/jpeg", avatarExt: "jpg" } })),
      ]);
      const responses = settled.map((r) => {
        if (r.status !== "fulfilled") throw r.reason;
        return r.value;
      });
      const statuses = responses.map((r) => r.status).sort();
      expect(statuses, "exactly one completes").toEqual([200, 403]);
      // Both got past the read check (the read-then-write gap was really open,
      // so the read alone did not decide it): each one tried the claim.
      expect(claimUpdates()).toHaveLength(2);
      const loser = responses.find((r) => r.status === 403)!;
      expect(((await loser.json()) as { error?: string }).error).toBe("Profile already completed. Please log in.");
      // The loser wrote and uploaded nothing: one completion, one photo, one
      // consent record, one referral attempt.
      expect(scenario.writes.filter((w) => w.table === "profiles" && w.op === "update" && "bio" in ((w.payload ?? {}) as object))).toHaveLength(1);
      expect(uploads).toHaveLength(1);
      expect(scenario.writes.filter((w) => w.table === "legal_acceptances")).toHaveLength(1);
      expect(rpcNames().filter((n) => n === "record_referral_signup")).toHaveLength(1);
      // And the row holds the winner's completion, never released.
      expect(row.terms_accepted_at).toBeTruthy();
      expect(releaseUpdates()).toEqual([]);
    });

    it("a no-session call refused AFTER it took the claim hands it back, so the member's own retry completes", async () => {
      const row = liveFreshSignup();
      const fn = await load();
      const uploads = recordUploads();
      // No 18+ box: refused (403) after the claim.
      const refused = await fn.fetch(fn.request({ body: { ...FIELD_VALUES, ageAttested: false } }));
      expect(refused.status).toBe(403);
      // Refused BEFORE the photo upload (review note b): a stranger cannot
      // claim, park a public photo under the id, get refused and repeat.
      expect(uploads).toEqual([]);
      expect(claimUpdates()).toHaveLength(1);
      expect(releaseUpdates()).toHaveLength(1);
      expect(row.terms_accepted_at, "the claim was released").toBeNull();
      expect(completionUpdate()).toBeUndefined();
      // The member's retry is not locked out by the failed attempt.
      const retry = await fn.fetch(fn.request({ body: FIELD_VALUES }));
      expect(retry.status).toBe(200);
      expect(completionUpdate()).toBeDefined();
      expect(row.terms_accepted_at).toBeTruthy();
    });

    it("the release is keyed on its OWN stamp: a completion that landed but whose answer failed is never cleared", async () => {
      // Date only, advanced on every profiles write, so the claim's stamp and the
      // completion's consent time differ as they do on a real server.
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date());
        const row = liveFreshSignup();
        (scenario.writeOverrides ??= []).unshift({
          table: "profiles",
          op: "update",
          when: () => { vi.setSystemTime(Date.now() + 5); return false; },
        });
        // The completion UPDATE is applied to the row (live model) and THEN answers an
        // error: committed, answer lost.
        completionUpdateFails({ message: "connection reset after commit" });
        const fn = await load();
        const res = await fn.fetch(fn.request({ body: FIELD_VALUES }));
        expect(res.status).toBe(500);
        const completedAt = (completionUpdate()?.payload as Record<string, unknown>)?.terms_accepted_at;
        const claimedAt = (claimUpdates()[0]?.payload as Record<string, unknown>)?.terms_accepted_at;
        expect(completedAt).toBeTruthy();
        expect(completedAt, "the two stamps must differ or this proves nothing").not.toBe(claimedAt);
        // The release ran, matched nothing, and the recorded completion stands.
        expect(releaseUpdates()).toHaveLength(1);
        expect(row.terms_accepted_at).toBe(completedAt);
      } finally {
        vi.useRealTimers();
      }
    });

    it("a Bearer token that is not a member's (the anon key; getUser fails) is the no-session path: body cut, claim taken", async () => {
      seedFreshSignup();
      scenario.authUser = undefined;
      scenario.authError = { message: "invalid JWT: unable to parse or verify signature" };
      const fn = await load();
      const res = await fn.fetch(fn.request({ body: FIELD_VALUES, headers: { Authorization: "Bearer anon-key" } }));
      expect(res.status).toBe(200);
      expect(Object.keys(completionUpdate()?.payload ?? {}).sort()).toEqual(NO_SESSION_COLUMNS);
      expect(rpcNames()).not.toContain("enforce_retained_ban");
      expect(claimUpdates()).toHaveLength(1);
    });

    for (const rawBody of ["null", "\"userId\"", "[1,2]", "42"]) {
      it(`a no-session call whose body is not an object (${rawBody}) is a 401, not a 500, and writes nothing`, async () => {
        seedFreshSignup();
        const fn = await load();
        const res = await fn.fetch(fn.request({ rawBody }));
        expect(res.status).toBe(401);
        expect(scenario.writes).toEqual([]);
      });
    }
  });
});
